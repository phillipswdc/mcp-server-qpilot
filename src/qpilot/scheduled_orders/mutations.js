/**
 * Scheduled-order mutations. Every audited mutation here follows the same
 * shape: fetch the entity (so old_values has something to capture and the
 * caller can see drift), perform the QPilot write, re-fetch to capture
 * new_values. `auditedMutation` wraps the whole thing and emits one
 * audit_log row per attempt (including failures).
 *
 * `deleteScheduledOrder` is intentionally NOT audited — QPilot soft-deletes
 * scheduled orders, recovery is via the QPilot UI, and the audit/rollback
 * layer would not add value for a flag-flip the operator can undo upstream.
 */
import { qpilotRequest } from "../client.js";
import { withRetry } from "../retry.js";
import { auditedMutation } from "../_audit.js";
import {
  OBJECT_TYPE,
  STATUS_AUDIT_KEYS,
  SNOOZE_AUDIT_KEYS,
  NEXT_OCCURRENCE_AUDIT_KEYS,
  FREQUENCY_AUDIT_KEYS,
  RETRY_AUDIT_KEYS,
  PAYMENT_METHOD_AUDIT_KEYS,
} from "./constants.js";
import {
  orderPath,
  statusPath,
  snoozePath,
  nextOccurrencePath,
  frequencyPath,
  safeActivatePath,
  retryPath,
  paymentMethodPath,
} from "./paths.js";
import { mergeForPut, matchTimestampPrecision } from "./helpers.js";

/**
 * Update a scheduled order via PUT. QPilot's generic PUT validates the body
 * as a full entity (frequency, customerId, utcOffset, etc. are all required),
 * so a partial body 400s on fields the user never touched. We fetch the
 * current entity once, merge the caller's intent over it, strip nested/
 * computed keys that can't safely round-trip, and PUT the result. The audit
 * log still captures only the keys the caller actually set.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {Record<string,unknown>} params.properties Fields to write
 */
export async function updateScheduledOrder({ id, properties }) {
  const path = orderPath(id);
  const filterKeys = Object.keys(properties);

  const existing = await withRetry(() => qpilotRequest({ path }));
  const body = mergeForPut(existing, properties);

  return await auditedMutation({
    toolName: "update_scheduled_order",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: async () => existing,
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({ path, method: "PUT", body })
      );
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: filterKeys,
  });
}

/**
 * Change a scheduled order's status. Status is a path segment (not a body
 * field), so we capture order state, PUT to the status route, then re-fetch.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {string} params.status New status (e.g. "Active", "Paused")
 */
export async function changeScheduledOrderStatus({ id, status }) {
  return await auditedMutation({
    toolName: "change_scheduled_order_status",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, status },
    fetchExisting: () => withRetry(() => qpilotRequest({ path: orderPath(id) })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({ path: statusPath(id, status), method: "PUT" })
      );
      return await withRetry(() => qpilotRequest({ path: orderPath(id) }));
    },
    filterCapturedKeys: STATUS_AUDIT_KEYS,
  });
}

/**
 * Snooze a scheduled order until a future date. Hits QPilot's dedicated
 * /Snooze endpoint rather than routing through the generic merge-body PUT,
 * so the wire payload is just the snooze fields.
 *
 * Audit shape uses `args.properties` so the existing body-PUT rollback path
 * can restore the prior snooze fields without a dedicated handler. Rollback
 * goes back through the generic PUT (mergeForPut), which is fine for clearing
 * snoozes back to null but assumes QPilot's generic PUT doesn't re-validate
 * the future-date rule for retro restorations — confirm at runtime.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {string} params.snoozeUntilUtc ISO date-time, must be in the future
 * @param {number} [params.snoozeDuration] Optional supplemental duration value
 * @param {string} [params.snoozeDurationType] Optional duration unit token
 */
export async function snoozeScheduledOrder({
  id,
  snoozeUntilUtc,
  snoozeDuration,
  snoozeDurationType,
}) {
  const properties = { snoozeUntilUtc };
  if (snoozeDuration !== undefined) properties.snoozeDuration = snoozeDuration;
  if (snoozeDurationType !== undefined)
    properties.snoozeDurationType = snoozeDurationType;

  return await auditedMutation({
    toolName: "snooze_scheduled_order",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: () =>
      withRetry(() => qpilotRequest({ path: orderPath(id) })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: snoozePath(id),
          method: "PUT",
          body: properties,
        })
      );
      return await withRetry(() => qpilotRequest({ path: orderPath(id) }));
    },
    filterCapturedKeys: SNOOZE_AUDIT_KEYS,
  });
}

/**
 * Set the next-occurrence date on a scheduled order via QPilot's dedicated
 * /NextOccurrenceUtc endpoint. Avoids the merge-body PUT round-trip used by
 * updateScheduledOrder for a single-field change.
 *
 * Audit shape mirrors snoozeScheduledOrder — `args.properties` reuses the
 * existing body-PUT rollback path. Rollback writes the prior
 * nextOccurrenceUtc back via the generic PUT (mergeForPut), which is the
 * only route that can write past-dated values (QPilot's dedicated endpoint
 * enforces a future-date rule and would reject a retro-restoration).
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {string} params.nextOccurrenceUtc ISO date-time, must be in the future
 */
export async function updateScheduledOrderNextOccurrence({
  id,
  nextOccurrenceUtc,
}) {
  const path = orderPath(id);
  const existing = await withRetry(() => qpilotRequest({ path }));
  const normalized = matchTimestampPrecision(
    nextOccurrenceUtc,
    existing?.nextOccurrenceUtc
  );
  const properties = { nextOccurrenceUtc: normalized };

  return await auditedMutation({
    toolName: "update_scheduled_order_next_occurrence",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: async () => existing,
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: nextOccurrencePath(id),
          method: "PUT",
          body: properties,
        })
      );
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: NEXT_OCCURRENCE_AUDIT_KEYS,
  });
}

/**
 * Change a scheduled order's recurrence frequency via QPilot's dedicated
 * /Frequency endpoint. QPilot requires `frequencyType` in the body; we
 * accept either or both fields and fill the omitted one from the existing
 * record so callers only need to specify what they're changing. Rollback
 * is scoped to the keys the caller actually set (rollbackBodyUpdate reads
 * `args.properties`), so changing only the number won't revert the type.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {number} [params.frequency] Integer 1-365 (QPilot range)
 * @param {string} [params.frequencyType] One of Days, Weeks, Months,
 *   DayOfTheWeek, DayOfTheMonth
 */
export async function updateScheduledOrderFrequency({
  id,
  frequency,
  frequencyType,
}) {
  if (frequency === undefined && frequencyType === undefined) {
    throw new Error(
      "update_scheduled_order_frequency requires at least one of `frequency` or `frequency_type`"
    );
  }

  const path = orderPath(id);
  const existing = await withRetry(() => qpilotRequest({ path }));

  const properties = {};
  if (frequency !== undefined) properties.frequency = frequency;
  if (frequencyType !== undefined) properties.frequencyType = frequencyType;

  const body = {
    frequency: frequency ?? existing?.frequency,
    frequencyType: frequencyType ?? existing?.frequencyType,
  };

  return await auditedMutation({
    toolName: "update_scheduled_order_frequency",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: async () => existing,
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: frequencyPath(id),
          method: "PUT",
          body,
        })
      );
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: FREQUENCY_AUDIT_KEYS,
  });
}

/**
 * "Safely" reactivate a scheduled order via QPilot's dedicated /SafeActivate
 * endpoint. Distinct from `change_scheduled_order_status` because that route
 * only accepts Active/Paused transitions — Failed orders need this path to
 * get back to Active, and soft-deleted orders need this path with
 * allowDeleted=true. QPilot runs its own safety checks (lock window etc.)
 * before flipping status.
 *
 * Audit captures status/isActive via STATUS_AUDIT_KEYS so the rollback
 * dispatcher can route based on prior status. Rollback support:
 *   - prior Paused → revert via status endpoint
 *   - prior Deleted → re-soft-delete via DELETE
 *   - prior Active → "nothing to roll back" (state didn't change)
 *   - prior Failed (or anything else) → refused; the API has no path back
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {boolean} [params.allowDeleted=false] When true, also accepts
 *   orders currently in Deleted (soft-deleted) status. Default behavior
 *   400s on Deleted orders.
 */
export async function safeActivateScheduledOrder({ id, allowDeleted = false }) {
  return await auditedMutation({
    toolName: "safe_activate_scheduled_order",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, allowDeleted },
    fetchExisting: () =>
      withRetry(() => qpilotRequest({ path: orderPath(id) })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: safeActivatePath(id),
          method: "PUT",
          query: allowDeleted ? { allowDeleted: true } : undefined,
        })
      );
      return await withRetry(() => qpilotRequest({ path: orderPath(id) }));
    },
    filterCapturedKeys: STATUS_AUDIT_KEYS,
  });
}

/**
 * Retry processing for a scheduled order via QPilot's dedicated /Retry
 * endpoint. CAUTION: this triggers a real processing cycle attempt, which
 * almost certainly means a payment-gateway call. Failed payments can leave
 * the order in a different failure state than before; successful payments
 * cannot be unwound by rollback.
 *
 * QPilot's docs page for this endpoint is essentially empty (no body
 * spec, no preconditions, no documented errors). Treating it as a no-body
 * POST until live testing surfaces a different shape.
 *
 * TODO(2026-06-07): no end-to-end smoke test yet — needs a SO in Failed
 * status on a test site. Verify response shape, preconditions, and which
 * fields actually change before relying on this in production. Tracked
 * in the `retry-smoke-test-pending` memory entry.
 *
 * Rollback dispatcher routes `retry_scheduled_order` to rollbackRetry,
 * which refuses every time — payment attempts can't be reversed via the
 * API.
 *
 * @param {object} params
 * @param {string|number} params.id
 */
export async function retryScheduledOrder({ id }) {
  return await auditedMutation({
    toolName: "retry_scheduled_order",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id },
    fetchExisting: () =>
      withRetry(() => qpilotRequest({ path: orderPath(id) })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: retryPath(id),
          method: "POST",
        })
      );
      return await withRetry(() => qpilotRequest({ path: orderPath(id) }));
    },
    filterCapturedKeys: RETRY_AUDIT_KEYS,
  });
}

/**
 * Change which payment method backs a scheduled order via QPilot's dedicated
 * PATCH .../PaymentMethod endpoint. The target payment method must already
 * exist on the site (QPilot 400s with "Payment method does not exist"
 * otherwise). QPilot's docs don't explicitly require the payment method to
 * belong to the SO's customer, but that's the operational expectation —
 * verify behavior empirically the first time you cross-link.
 *
 * Rollback routes through the default `rollbackBodyUpdate` (generic PUT)
 * because `paymentMethodId` is not in PUT_STRIP_KEYS — the generic PUT can
 * write the prior scalar back. No dedicated handler needed.
 *
 * TODO(2026-06-07): no end-to-end smoke test yet — needs a second valid
 * paymentMethodId on site 1113 to swap SO 208022 between. Verify the
 * happy-path PATCH, the rollback via generic PUT, and confirm whether
 * QPilot enforces customer-ownership of the payment method. Tracked in
 * the `payment_method_smoke_test_pending` memory entry.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {number} params.paymentMethodId QPilot's numeric payment method id
 *   (int64). Discover via the `get_customer_payment_methods` tool (the
 *   `id` field on each returned payment method) or via
 *   /Sites/{siteId}/PaymentMethods directly.
 */
export async function changeScheduledOrderPaymentMethod({ id, paymentMethodId }) {
  const path = orderPath(id);
  const existing = await withRetry(() => qpilotRequest({ path }));
  const properties = { paymentMethodId };

  return await auditedMutation({
    toolName: "change_scheduled_order_payment_method",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: async () => existing,
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({
          path: paymentMethodPath(id),
          method: "PATCH",
          body: properties,
        })
      );
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: PAYMENT_METHOD_AUDIT_KEYS,
  });
}

/**
 * Delete a scheduled order. QPilot soft-deletes (recoverable from the QPilot
 * UI) so we skip the audit/rollback layer entirely.
 *
 * @param {string|number} id
 */
export async function deleteScheduledOrder(id) {
  return await withRetry(() =>
    qpilotRequest({ path: orderPath(id), method: "DELETE" })
  );
}
