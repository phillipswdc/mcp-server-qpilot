/**
 * QPilot processing-failure code catalog. Eleven codes — bounded and stable.
 *
 * Surfaces as `processingErrorCode` on scheduled orders and inside
 * processing-cycle records. When a code is present, tool responses are
 * enriched with `processingErrorCodeName` and `processingErrorCodeMeaning`
 * so callers don't have to memorize the numeric values.
 *
 * When the failure code is 2000 (PaymentFailed), the actual root cause comes
 * from the payment gateway (Authorize.Net, Braintree, Stripe, etc.) — those
 * codes are not enumerated here. See docs/qpilot-error-codes.md for the
 * per-gateway reference.
 *
 * Source: https://docs.qpilot.cloud/docs/scheduled-order-failure-codes.md
 * (captured 2026-06-08; only updated when QPilot publishes a new code)
 */

/**
 * @typedef {object} ProcessingFailureCode
 * @property {number} code Numeric code as QPilot returns it.
 * @property {string} name PascalCase identifier from QPilot's docs.
 * @property {string} meaning One-line human explanation.
 */

/** @type {Record<number, ProcessingFailureCode>} */
export const PROCESSING_FAILURE_CODES = {
  99: {
    code: 99,
    name: "UnknownError",
    meaning: "An unknown error occurred during processing.",
  },
  1000: {
    code: 1000,
    name: "EmptyScheduledOrder",
    meaning: "No items were added to the scheduled order.",
  },
  1001: {
    code: 1001,
    name: "NoItemsToShip",
    meaning: "No items are available to process for the scheduled order.",
  },
  1002: {
    code: 1002,
    name: "ShippingRateNotFound",
    meaning: "One or more shipping rates could not be applied to the scheduled order.",
  },
  1003: {
    code: 1003,
    name: "PaymentIntegrationNotFound",
    meaning: "The payment integration referenced by the scheduled order could not be found.",
  },
  1004: {
    code: 1004,
    name: "PaymentMethodNull",
    meaning: "No payment method is selected for the scheduled order.",
  },
  2000: {
    code: 2000,
    name: "PaymentFailed",
    meaning: "The payment method did not process successfully. See the gateway-specific code for the root cause.",
  },
  2001: {
    code: 2001,
    name: "PaymentGatewayCommunicationFailed",
    meaning: "The payment gateway failed to respond, likely due to a temporary server error or timeout.",
  },
  3000: {
    code: 3000,
    name: "ClientOrderCreationFailure",
    meaning: "The client site did not respond successfully to QPilot's API request to create the order.",
  },
  3001: {
    code: 3001,
    name: "ClientOrderUpdateFailure",
    meaning: "The client site did not respond successfully to QPilot's API request to update the order.",
  },
  3002: {
    code: 3002,
    name: "ClientOrderCreationInvalidResponse",
    meaning: "The client site responded to QPilot's create-order request with an invalid order.",
  },
};

/**
 * Resolve a processing-failure code to its catalog entry. Returns null for
 * null/undefined inputs or codes not in the catalog.
 *
 * @param {number|string|null|undefined} code
 * @returns {ProcessingFailureCode|null}
 */
export function lookupProcessingFailureCode(code) {
  if (code === null || code === undefined) return null;
  const num = Number(code);
  if (!Number.isFinite(num)) return null;
  return PROCESSING_FAILURE_CODES[num] ?? null;
}

/**
 * Walk a value and, wherever a `processingErrorCode` field is present with a
 * known catalog entry, inject sibling `processingErrorCodeName` and
 * `processingErrorCodeMeaning` fields. Returns a new value; does not mutate
 * input. Pass-through for primitives, null, and undefined.
 *
 * The walker recurses into objects and arrays. It is intentionally tolerant
 * — unknown codes pass through silently (no annotation), and missing fields
 * are no-ops. Used on tool responses so callers don't have to memorize the
 * numeric codes.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function annotateProcessingErrorCode(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map(annotateProcessingErrorCode));
  }
  const out = {};
  let lookup = null;
  for (const [k, v] of Object.entries(value)) {
    out[k] =
      v !== null && typeof v === "object"
        ? annotateProcessingErrorCode(v)
        : v;
    if (k === "processingErrorCode") {
      lookup = lookupProcessingFailureCode(v);
    }
  }
  if (lookup) {
    out.processingErrorCodeName = lookup.name;
    out.processingErrorCodeMeaning = lookup.meaning;
  }
  return /** @type {T} */ (out);
}
