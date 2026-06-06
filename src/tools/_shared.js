/**
 * Shared response helpers for MCP tool handlers. Tools should produce a
 * uniform output shape so callers don't need per-tool error parsing.
 */
import { MAX_RESPONSE_BYTES } from "../config/constants.js";
import { stashOverflow } from "../qpilot/_cache.js";

/**
 * Wrap a JSON-serializable object as an MCP text-content response.
 *
 * Size guard with auto-overflow caching: if the serialized response exceeds
 * MAX_RESPONSE_BYTES, the full payload is stashed in `result_cache` as a
 * `response_overflow` row and a compact handle (cache_id + preview + shape
 * hints) is returned instead. This protects the model's context window
 * without losing the data — `get_cached_value(cache_id)` retrieves the full
 * payload when it's actually needed.
 *
 * `skipOverflow: true` disables the size guard entirely. Use it when the
 * response IS a cache retrieval (otherwise retrieving an oversized cached
 * payload would re-stash it under a new id — an unbounded loop).
 *
 * @param {unknown} obj
 * @param {object} [opts]
 * @param {string} [opts.toolName] Owning tool name; recorded on overflow rows for forensics
 * @param {boolean} [opts.skipOverflow] If true, bypass the size guard and return raw
 * @returns {{ content: Array<{type: 'text', text: string}>, isError?: boolean }}
 */
export function jsonText(obj, opts = {}) {
  const text = JSON.stringify(obj, null, 2);
  if (opts.skipOverflow) {
    return { content: [{ type: "text", text }] };
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_RESPONSE_BYTES) {
    const handle = stashOverflow(text, { toolName: opts.toolName });
    return {
      content: [{ type: "text", text: JSON.stringify(handle, null, 2) }],
    };
  }
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap a plain string as an MCP text-content response (non-error).
 * @param {string} text
 */
export function plainText(text) {
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap an error as an MCP error response.
 *
 * @param {unknown} err
 * @param {number|string} [status]
 */
export function errorText(err, status) {
  return {
    content: [
      {
        type: "text",
        text: `QPilot error (${status ?? "unknown"}): ${err?.message ?? String(err)}`,
      },
    ],
    isError: true,
  };
}

/** Extract a status-like field from a QPilot error, if present. */
export function statusOf(err) {
  return err?.status ?? err?.response?.status;
}

/**
 * QPilot v3 list endpoints return responses with multiple array keys for the
 * same content — typically `results` AND `items` (or for history,
 * `scheduledOrderHistoryItems`). Sometimes one is populated and the others
 * empty. We pick the first NON-EMPTY array we recognize so callers don't
 * silently get back `[]` from a populated response, AND we drop the other
 * candidate array keys from the output so the response isn't duplicated
 * (the duplication ~doubled the payload size on history calls).
 *
 * @param {unknown} raw QPilot response body
 * @returns {{ results: object[], total: number, [key: string]: unknown }}
 */
export function normalizeListResponse(raw) {
  if (Array.isArray(raw)) return { results: raw, total: raw.length };
  if (!raw || typeof raw !== "object") return { results: [], total: 0 };

  const candidateKeys = [
    "results",
    "items",
    "data",
    "scheduledOrderHistoryItems",
    "scheduledOrders",
    "customers",
  ];
  const arrays = candidateKeys
    .map((k) => ({ key: k, value: raw[k] }))
    .filter((c) => Array.isArray(c.value));
  // Prefer the first non-empty array; fall back to the first array we found.
  const picked =
    arrays.find((c) => c.value.length > 0) ?? arrays[0] ?? { value: [] };

  const total =
    raw.total ??
    raw.totalCount ??
    raw.totalItems ??
    raw.count ??
    picked.value.length;

  // Build output WITHOUT the duplicate array keys — the same content under
  // multiple names just bloats the payload (visible at large page sizes).
  const out = { results: picked.value, total };
  for (const [k, v] of Object.entries(raw)) {
    if (candidateKeys.includes(k)) continue;
    if (k === "total" || k === "totalCount" || k === "totalItems" || k === "count") continue;
    out[k] = v;
  }
  return out;
}
