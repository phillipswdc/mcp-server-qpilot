/**
 * Public cache-domain methods: query a cached result_set, summarize, list,
 * expire, and dereference cached payloads (both result_set and overflow).
 *
 * Filters/sorts run in-memory after parsing the cached JSON once. The cache
 * size is bounded by TTL + the hard MAX_RESPONSE_BYTES cap on stored
 * payloads, so re-parsing per query stays cheap.
 */
import { db } from "../db/index.js";
import {
  getCache,
  listActiveCaches,
  deleteCache,
} from "../db/queries/result_cache.js";

/**
 * Dereference any cached payload by id. Returns the parsed payload plus
 * metadata. Works for both `result_set` and `response_overflow` rows.
 *
 * @param {string} cacheId
 */
export function getCachedValue(cacheId) {
  const row = getCache(cacheId);
  if (!row) return null;
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return {
    cache_id: cacheId,
    cache_type: row.cache_type,
    tool_name: row.tool_name,
    object_type: row.object_type,
    result_count: row.result_count,
    byte_length: row.byte_length,
    created_at_iso: new Date(row.created_at).toISOString(),
    expires_at_iso: new Date(row.expires_at).toISOString(),
    source_args: row.source_args,
    payload,
  };
}

/**
 * Summarize a cached result_set — counts, field frequency. Useful before a
 * full query_cache to know what's inside without dereferencing the bulk.
 *
 * @param {string} cacheId
 */
export function cacheSummary(cacheId) {
  const row = getCache(cacheId);
  if (!row) throw new Error(`Cache ${cacheId} not found or expired`);
  if (row.cache_type !== "result_set") {
    throw new Error(
      `cache_summary only applies to result_set caches (got "${row.cache_type}"). Use get_cached_value for response_overflow.`
    );
  }

  // SQLite JSON1 lets us count keys without rehydrating the array into Node.
  const fieldFrequency = db
    .prepare(
      `
      SELECT key, COUNT(*) as count
      FROM result_cache, json_tree(result_cache.payload, '$')
      WHERE cache_id = ? AND parent IS NOT NULL AND type != 'object' AND type != 'array'
      GROUP BY key
      ORDER BY count DESC
      LIMIT 50
    `
    )
    .all(cacheId);

  return {
    cache_id: cacheId,
    cache_type: row.cache_type,
    object_type: row.object_type,
    result_count: row.result_count,
    byte_length: row.byte_length,
    created_at_iso: new Date(row.created_at).toISOString(),
    expires_at_iso: new Date(row.expires_at).toISOString(),
    source_args: row.source_args,
    field_frequency: fieldFrequency,
  };
}

/**
 * Query a cached result_set with optional filters, sort, and pagination.
 * Filters operate on top-level fields of each item (QPilot returns flat
 * objects — no `properties` sub-dict).
 *
 * @param {string} cacheId
 * @param {object} [options]
 * @param {Array<{field: string, operator: string, value?: unknown, values?: unknown[], highValue?: unknown}>} [options.filters]
 * @param {Array<{field: string, direction?: 'ASC'|'DESC'}>} [options.sorts]
 * @param {string[]} [options.fields] Project to these fields per result
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 */
export function queryCache(cacheId, options = {}) {
  const row = getCache(cacheId);
  if (!row) throw new Error(`Cache ${cacheId} not found or expired`);
  if (row.cache_type !== "result_set") {
    throw new Error(
      `query_cache only applies to result_set caches (got "${row.cache_type}"). Use get_cached_value for response_overflow.`
    );
  }

  /** @type {object[]} */
  const all = JSON.parse(row.payload);

  let filtered = all;
  if (options.filters?.length) {
    filtered = filtered.filter((item) =>
      options.filters.every((f) => evaluateFilter(item, f))
    );
  }

  if (options.sorts?.length) {
    filtered = [...filtered].sort((a, b) => compareItems(a, b, options.sorts));
  }

  const total = filtered.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  const page = filtered.slice(offset, offset + limit);

  const projected = options.fields?.length
    ? page.map((item) => projectFields(item, options.fields))
    : page;

  return {
    cache_id: cacheId,
    total,
    count: projected.length,
    offset,
    limit,
    next_offset: offset + projected.length < total ? offset + projected.length : null,
    results: projected,
  };
}

/**
 * List active (non-expired) caches.
 * @param {{ scope?: string, session_id?: string, cache_type?: string, current_session_only?: boolean, limit?: number }} [filters]
 */
export function listCaches(filters = {}) {
  return listActiveCaches(filters);
}

/**
 * Manually delete a cache row.
 * @param {string} cacheId
 */
export function expireCache(cacheId) {
  return deleteCache(cacheId);
}

// ---------------------------------------------------------------------------
// Internal filter / sort helpers
// ---------------------------------------------------------------------------

function evaluateFilter(item, filter) {
  const v = item?.[filter.field];
  switch (filter.operator) {
    case "EQ":
      return String(v ?? "") === String(filter.value ?? "");
    case "NEQ":
      return String(v ?? "") !== String(filter.value ?? "");
    case "LT":
      return numeric(v) < numeric(filter.value);
    case "LTE":
      return numeric(v) <= numeric(filter.value);
    case "GT":
      return numeric(v) > numeric(filter.value);
    case "GTE":
      return numeric(v) >= numeric(filter.value);
    case "BETWEEN":
      return (
        numeric(v) >= numeric(filter.value) &&
        numeric(v) <= numeric(filter.highValue)
      );
    case "IN":
      return (filter.values ?? []).map(String).includes(String(v ?? ""));
    case "NOT_IN":
      return !(filter.values ?? []).map(String).includes(String(v ?? ""));
    case "HAS":
      return v !== null && v !== undefined && v !== "";
    case "NOT_HAS":
      return v === null || v === undefined || v === "";
    case "CONTAINS":
      return String(v ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    case "NOT_CONTAINS":
      return !String(v ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    default:
      throw new Error(`Unsupported filter operator in query_cache: ${filter.operator}`);
  }
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function compareItems(a, b, sorts) {
  for (const s of sorts) {
    const av = a?.[s.field] ?? null;
    const bv = b?.[s.field] ?? null;
    let cmp;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else cmp = String(av).localeCompare(String(bv));
    if (s.direction === "DESC") cmp = -cmp;
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function projectFields(item, fields) {
  const out = {};
  for (const k of fields) {
    if (k in item) out[k] = item[k];
  }
  return out;
}
