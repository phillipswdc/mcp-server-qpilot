/**
 * Prepared statements and helpers for the `result_cache` table.
 *
 * Two cache shapes share the table:
 *   - `result_set`: full search/list results stored under a cache_id, with
 *     a sample + handle returned to the model so the bulk data never enters
 *     the model's context unless explicitly queried via query_cache.
 *   - `response_overflow`: a generic blob stashed when any tool's response
 *     would exceed MAX_RESPONSE_BYTES. Returned to the model as a small
 *     summary handle instead of erroring out.
 */
import { db, nowMs } from "../index.js";
import { randomUUID, createHash } from "node:crypto";

// INSERT OR REPLACE because cache_ids are content-addressed (SHA-256 prefix
// of the payload). When the same content is cached again, we want to refresh
// the TTL on the existing row rather than crash on PRIMARY KEY collision.
const INSERT = db.prepare(`
  INSERT OR REPLACE INTO result_cache
    (cache_id, cache_type, tool_name, source_args, object_type, payload,
     result_count, byte_length, preview, created_at, expires_at, scope, session_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const SELECT_BY_ID = db.prepare(`SELECT * FROM result_cache WHERE cache_id = ?`);

const SELECT_ACTIVE = db.prepare(`
  SELECT cache_id, cache_type, tool_name, object_type, result_count,
         byte_length, created_at, expires_at, scope, session_id
  FROM result_cache
  WHERE expires_at > @now
    AND (@scope IS NULL OR scope = @scope)
    AND (@session_id IS NULL OR session_id = @session_id)
    AND (@cache_type IS NULL OR cache_type = @cache_type)
  ORDER BY created_at DESC
  LIMIT @limit
`);

const DELETE_BY_ID = db.prepare(`DELETE FROM result_cache WHERE cache_id = ?`);
const DELETE_EXPIRED = db.prepare(`DELETE FROM result_cache WHERE expires_at <= ?`);

/**
 * Generate a content-addressed cache_id. Same content → same id, so identical
 * cached payloads naturally deduplicate. Falls back to UUID if hashing fails.
 *
 * @param {string} payload Already-stringified JSON
 * @returns {string} 16-char hex prefix or UUID
 */
export function newCacheId(payload) {
  try {
    const hash = createHash("sha256").update(payload).digest("hex");
    return `rc_${hash.slice(0, 16)}`;
  } catch {
    return `rc_${randomUUID()}`;
  }
}

/**
 * @typedef {object} CacheRowInput
 * @property {string} cache_id
 * @property {"result_set"|"response_overflow"} cache_type
 * @property {string|null} tool_name
 * @property {object|null} source_args
 * @property {string|null} object_type
 * @property {unknown} payload Already-serialized JSON OR a value to stringify
 * @property {number|null} result_count
 * @property {number|null} byte_length
 * @property {string|null} preview
 * @property {number} expires_at Unix-ms
 * @property {string} scope
 * @property {string|null} session_id
 */

/**
 * Insert a cache row.
 * @param {CacheRowInput} row
 */
export function insertCache(row) {
  const payloadStr =
    typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
  INSERT.run(
    row.cache_id,
    row.cache_type,
    row.tool_name ?? null,
    row.source_args ? JSON.stringify(row.source_args) : null,
    row.object_type ?? null,
    payloadStr,
    row.result_count ?? null,
    row.byte_length ?? Buffer.byteLength(payloadStr, "utf8"),
    row.preview ?? null,
    nowMs(),
    row.expires_at,
    row.scope,
    row.session_id ?? null
  );
}

/**
 * Read a cache row by id. Returns null if missing OR expired.
 * @param {string} cacheId
 * @returns {object|null}
 */
export function getCache(cacheId) {
  const row = SELECT_BY_ID.get(cacheId);
  if (!row) return null;
  if (row.expires_at <= nowMs()) return null;
  return {
    ...row,
    source_args: row.source_args ? JSON.parse(row.source_args) : null,
  };
}

/**
 * List active (non-expired) cache rows with optional filters.
 * @param {{ scope?: string|null, session_id?: string|null, cache_type?: string|null, limit?: number }} [filters]
 */
export function listActiveCaches(filters = {}) {
  const {
    scope = null,
    session_id = null,
    cache_type = null,
    limit = 100,
  } = filters;
  return SELECT_ACTIVE.all({
    now: nowMs(),
    scope,
    session_id,
    cache_type,
    limit,
  });
}

/**
 * Manually delete a cache row by id.
 * @param {string} cacheId
 * @returns {boolean} True if a row was deleted.
 */
export function deleteCache(cacheId) {
  const info = DELETE_BY_ID.run(cacheId);
  return info.changes > 0;
}

/**
 * Sweep expired rows. Called opportunistically on cache writes so the table
 * doesn't grow unbounded; no separate background job needed.
 *
 * @returns {number} rows deleted
 */
export function pruneExpired() {
  const info = DELETE_EXPIRED.run(nowMs());
  return info.changes;
}
