/**
 * Pure helpers used by scheduled-order reads, mutations, and rollback:
 *
 *   - coerceEndOfDay: normalize a bare YYYY-MM-DD upper-bound date so
 *     QPilot's date-range queries treat the upper bound as inclusive.
 *   - matchTimestampPrecision: align a caller-supplied timestamp's
 *     fractional-second precision with the existing record's so QPilot's
 *     /NextOccurrenceUtc endpoint doesn't 400.
 *   - PUT_STRIP_KEYS + mergeForPut: prepare a full-entity PUT body by
 *     overlaying caller intent on the current entity and stripping nested
 *     relations and computed scalars that the generic PUT rejects.
 */

/**
 * Convert a bare-date string ("YYYY-MM-DD") to its end-of-day UTC instant
 * so date-range queries treat the upper bound as inclusive of the whole
 * day. Strings that already have a time component pass through unchanged;
 * non-strings and undefined pass through unchanged.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function coerceEndOfDay(value) {
  if (typeof value !== "string") return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T23:59:59.999Z`;
  return value;
}

/**
 * QPilot's dedicated PUT .../NextOccurrenceUtc endpoint rejects timestamps
 * whose fractional-second precision doesn't match the existing record's.
 * Existing records use millisecond precision (`.sssZ`), so a caller sending
 * `2030-01-01T00:00:00Z` gets a 400. We reformat the input to match the
 * existing record's precision before sending. Falls back to millisecond
 * precision if the existing value isn't a recognizable ISO string.
 */
export function matchTimestampPrecision(input, existing) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;

  let fractionalDigits = 3;
  if (typeof existing === "string") {
    const frac = existing.match(/\.(\d+)/);
    if (frac) fractionalDigits = frac[1].length;
    else if (/T\d{2}:\d{2}:\d{2}Z?$/.test(existing)) fractionalDigits = 0;
  }

  const iso = date.toISOString();
  if (fractionalDigits === 3) return iso;
  if (fractionalDigits === 0) return iso.replace(/\.\d+Z$/, "Z");
  const parts = iso.match(/^(.+)\.(\d+)Z$/);
  if (!parts) return iso;
  const base = parts[1];
  let f = parts[2];
  f = fractionalDigits < f.length
    ? f.slice(0, fractionalDigits)
    : f.padEnd(fractionalDigits, "0");
  return `${base}.${f}Z`;
}

/**
 * Fields returned by GET /ScheduledOrders/{id} that QPilot computes, manages,
 * or treats as relations. They must not be echoed back through the generic
 * PUT — either QPilot rejects them, or it tries to write them and produces
 * confusing side effects.
 */
export const PUT_STRIP_KEYS = new Set([
  // Nested relations and embedded objects
  "customer",
  "site",
  "scheduledOrderItems",
  "lastProcessingCycle",
  "shippingRateOptions",
  "shippingRateCalculationErrors",
  "couponsHistory",
  "validationResult",
  "dunning",
  "processingCycles",
  "eventLogs",
  // Server-computed or QPilot-owned scalars
  "lastProcessingCycleId",
  "lastOccurrenceUtc",
  "createdUtc",
  "updatedUtc",
  "lastEditableDate",
  "lastChangeToDeleted",
  "lifetimeValue",
  "stripeUrl",
  "displaySalePrice",
  "frequencyDisplayName",
  "scheduledOrderFailureReason",
  "processingErrorCode",
  "preProcessingValidationResultCode",
  "subtotal",
  "shippingTotal",
  "taxTotal",
  "total",
  "shippingRateName",
  "shippingRateId",
  "estimatedDeliveryDate",
  "locked",
  "bundleName",
  "originSubscriptionId",
  "siteId",
]);

export function mergeForPut(existing, properties) {
  const merged = { ...existing, ...properties };
  for (const k of PUT_STRIP_KEYS) delete merged[k];
  return merged;
}
