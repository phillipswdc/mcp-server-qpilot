/**
 * Project-wide constants. Centralized so behavior changes (limits, retry
 * counts, supported types) happen in one place.
 */

/**
 * QPilot object types this server supports for audit + rollback. New
 * endpoints add their type here so audit-log queries and rollback handlers
 * can validate against a known set rather than accepting any string.
 */
export const SUPPORTED_OBJECT_TYPES = Object.freeze([
  "scheduled_orders",
  "scheduled_order_items",
  "customers",
]);

/** Default retry attempts for transient HTTP failures (429, 5xx). */
export const DEFAULT_RETRY_ATTEMPTS = 3;

/** Default page size for list/search tools. */
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 200;

/** Per-request HTTP timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Hard byte cap on a single MCP tool response. Responses over this trigger
 * auto-overflow caching: the full payload lands in result_cache and the
 * model gets back a small handle instead of the full body. This keeps the
 * model's context window from being clobbered by oversized reads.
 */
export const MAX_RESPONSE_BYTES = 30_000;

/**
 * Default TTL for result_cache rows. 1 hour. Tools can override per call,
 * but the default balances "long enough to actually use" against "short
 * enough that stale data dies on its own."
 */
export const RESULT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Number of leading characters captured as a `preview` on cached payloads.
 * Lets the model reason about what's in a cache without dereferencing.
 */
export const CACHE_PREVIEW_CHARS = 200;

/**
 * Default number of sample entities returned alongside a cache handle for
 * list-shaped responses. Small enough to stay cheap in context, large
 * enough that the model can see the result shape.
 */
export const CACHE_SAMPLE_SIZE = 3;
