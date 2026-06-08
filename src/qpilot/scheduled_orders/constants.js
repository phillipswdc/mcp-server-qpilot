/**
 * Scheduled-order domain constants — shared across reads, mutations,
 * and rollback handlers.
 */

export const OBJECT_TYPE = "scheduled_orders";

/**
 * Properties captured on status-change audits. Keeps audit rows compact
 * while still letting rollback recover the prior status from old_values.
 */
export const STATUS_AUDIT_KEYS = ["id", "status", "isActive"];

/**
 * Properties captured on snooze audits. Must be a superset of every key the
 * snooze body can write, because rollback reads `args.properties` and pulls
 * each prior value from `old_values`.
 */
export const SNOOZE_AUDIT_KEYS = [
  "id",
  "snoozeUntilUtc",
  "snoozeDuration",
  "snoozeDurationType",
  "status",
  "isActive",
];

/**
 * Properties captured on next-occurrence audits. Single writable key
 * (nextOccurrenceUtc) plus status/isActive for forensic context.
 */
export const NEXT_OCCURRENCE_AUDIT_KEYS = [
  "id",
  "nextOccurrenceUtc",
  "status",
  "isActive",
];

/**
 * Properties captured on frequency audits. Both writable keys plus
 * status/isActive for forensic context. Must include every key the
 * frequency body can write, because rollback reads `args.properties` and
 * pulls each prior value from `old_values`.
 */
export const FREQUENCY_AUDIT_KEYS = [
  "id",
  "frequency",
  "frequencyType",
  "status",
  "isActive",
];

/**
 * Properties captured on Retry audits. Retry triggers a processing cycle,
 * so we capture status + the cycle progress fields so the audit row tells
 * a complete forensic story about what the retry attempt did. There's no
 * "writable key" set here because Retry takes no body — the order changes
 * are side effects of the cycle.
 */
export const RETRY_AUDIT_KEYS = [
  "id",
  "status",
  "isActive",
  "nextOccurrenceUtc",
  "lastOccurrenceUtc",
  "lastProcessingCycleId",
  "scheduledOrderFailureReason",
  "processingErrorCode",
];

/**
 * Properties captured on payment-method-change audits. Single writable key
 * (paymentMethodId) plus status/isActive for forensic context. The
 * embedded `paymentMethod` object on the entity is QPilot-resolved from
 * the id, so we don't track it directly.
 */
export const PAYMENT_METHOD_AUDIT_KEYS = [
  "id",
  "paymentMethodId",
  "status",
  "isActive",
];
