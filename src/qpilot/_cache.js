/**
 * Internal cache helpers for the two write paths into result_cache:
 *
 * 1. Opt-in result-set caching: tools accepting `cache: true` route through
 *    `cacheResultSet` so the model receives a handle + sample instead of the
 *    full list. Used by search/list tools where the caller knows in advance
 *    they want to filter locally without re-querying QPilot.
 *
 * 2. Auto-overflow caching: when ANY tool's response exceeds
 *    MAX_RESPONSE_BYTES, `stashOverflow` stores the full payload and returns
 *    a compact handle so the model never sees the bulk in its context.
 *    Triggered automatically from jsonText() in tools/_shared.js.
 *
 * Audit storage NEVER routes through caching — audit_log captures full
 * values for forensics and rollback fidelity.
 */
import {
  insertCache,
  newCacheId,
  pruneExpired,
} from "../db/queries/result_cache.js";
import {
  RESULT_CACHE_TTL_MS,
  CACHE_PREVIEW_CHARS,
  CACHE_SAMPLE_SIZE,
} from "../config/constants.js";
import { env } from "../config/env.js";

/**
 * Cache a complete search/list result-set and return a handle the model can
 * query later via query_cache.
 *
 * @param {object} params
 * @param {string} params.toolName
 * @param {object} params.sourceArgs Original tool arguments — handy when
 *   debugging or reproducing a query later.
 * @param {string} params.objectType e.g. "scheduled_orders", "customers"
 * @param {object[]} params.results Array of items to cache
 * @param {number} [params.ttlMs]
 * @returns {{ cache_id: string, expires_at: number, byte_length: number }}
 */
export function cacheResultSet({
  toolName,
  sourceArgs,
  objectType,
  results,
  ttlMs = RESULT_CACHE_TTL_MS,
}) {
  const payload = JSON.stringify(results);
  const byteLength = Buffer.byteLength(payload, "utf8");
  const cacheId = newCacheId(payload);
  const expiresAt = Date.now() + ttlMs;

  // Sweep expired rows BEFORE the insert so the table stays bounded.
  pruneExpired();

  insertCache({
    cache_id: cacheId,
    cache_type: "result_set",
    tool_name: toolName,
    source_args: sourceArgs,
    object_type: objectType,
    payload,
    result_count: results.length,
    byte_length: byteLength,
    preview: null,
    expires_at: expiresAt,
    scope: env.scope,
    session_id: env.sessionId,
  });

  return { cache_id: cacheId, expires_at: expiresAt, byte_length: byteLength };
}

/**
 * Wrap a search/list response with optional caching. When `useCache` is true,
 * the full results array is stored under a cache_id and the returned shape
 * gives the model a handle + a small sample instead of the full payload.
 *
 * When `useCache` is false (the default), passes the response through.
 *
 * @param {{ total?: number, count?: number, results: object[], [key: string]: unknown }} response
 * @param {object} ctx
 * @param {boolean} ctx.useCache
 * @param {string} ctx.toolName
 * @param {object} ctx.sourceArgs
 * @param {string} ctx.objectType
 * @param {number} [ctx.sampleSize]
 */
export function maybeCacheResponse(response, ctx) {
  if (!ctx.useCache) return response;
  const sampleSize = ctx.sampleSize ?? CACHE_SAMPLE_SIZE;
  const results = response.results ?? [];
  const handle = cacheResultSet({
    toolName: ctx.toolName,
    sourceArgs: ctx.sourceArgs,
    objectType: ctx.objectType,
    results,
  });
  return {
    cache_id: handle.cache_id,
    cache_type: "result_set",
    object_type: ctx.objectType,
    total: response.total ?? results.length,
    count: results.length,
    expires_at_iso: new Date(handle.expires_at).toISOString(),
    byte_length: handle.byte_length,
    sample: results.slice(0, sampleSize),
    available_fields: collectFieldKeys(results),
    next_steps:
      "Use query_cache(cache_id) to filter/sort/paginate against the cached set without re-fetching from QPilot.",
  };
}

/**
 * Stash an oversized response payload as a `response_overflow` cache row and
 * return a compact handle. Called from jsonText() when a serialized response
 * would exceed MAX_RESPONSE_BYTES — instead of erroring, we cache and let
 * the model dereference what it needs.
 *
 * @param {string} payload Already-stringified JSON
 * @param {object} ctx
 * @param {string} [ctx.toolName] Owning tool name (for forensics)
 * @returns {{
 *   cache_id: string,
 *   cache_type: 'response_overflow',
 *   byte_length: number,
 *   expires_at_iso: string,
 *   preview: string,
 *   top_level_keys: string[]|null,
 *   array_length: number|null,
 *   next_steps: string
 * }}
 */
export function stashOverflow(payload, ctx = {}) {
  const byteLength = Buffer.byteLength(payload, "utf8");
  const cacheId = newCacheId(payload);
  const expiresAt = Date.now() + RESULT_CACHE_TTL_MS;
  const preview =
    payload.slice(0, CACHE_PREVIEW_CHARS) +
    (payload.length > CACHE_PREVIEW_CHARS ? "…" : "");

  // Best-effort shape inspection so the model knows what's inside without
  // dereferencing. Failures are non-fatal — fall back to "unknown shape".
  let topLevelKeys = null;
  let arrayLength = null;
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      arrayLength = parsed.length;
    } else if (parsed && typeof parsed === "object") {
      topLevelKeys = Object.keys(parsed).slice(0, 50);
      if (Array.isArray(parsed.results)) arrayLength = parsed.results.length;
    }
  } catch {
    // payload is JSON by construction (jsonText stringified it), but defensive.
  }

  pruneExpired();

  insertCache({
    cache_id: cacheId,
    cache_type: "response_overflow",
    tool_name: ctx.toolName ?? null,
    source_args: null,
    object_type: null,
    payload,
    result_count: arrayLength,
    byte_length: byteLength,
    preview,
    expires_at: expiresAt,
    scope: env.scope,
    session_id: env.sessionId,
  });

  return {
    cache_id: cacheId,
    cache_type: "response_overflow",
    byte_length: byteLength,
    expires_at_iso: new Date(expiresAt).toISOString(),
    preview,
    top_level_keys: topLevelKeys,
    array_length: arrayLength,
    next_steps:
      "Response was too large to return inline. Use get_cached_value(cache_id) to retrieve the full payload, or query_cache(cache_id, ...) if it contains a results array.",
  };
}

/**
 * Collect the distinct top-level field names across an array of cached items
 * so the model knows what's queryable via query_cache.
 */
function collectFieldKeys(items) {
  const set = new Set();
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item)) set.add(k);
    }
  }
  return [...set].sort();
}
