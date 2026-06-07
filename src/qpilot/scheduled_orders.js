/**
 * Scheduled Orders domain module.
 *
 * Reads (no audit): getById, search (lightweight v3), getHistory.
 * Mutations:
 *   - update: full PUT — audited + rollback supported.
 *   - changeStatus: targeted status flip — audited + rollback supported.
 *   - deleteSoft: QPilot soft-deletes scheduled orders, recoverable from
 *     QPilot itself. Per project rule we skip the audit/rollback layer and
 *     just call the API.
 *
 * Both audited mutations record `operation: "update"` because they ultimately
 * change fields on the same record. The rollback handler dispatches by
 * `tool_name` so it can route a body-based revert vs. a status-path revert
 * to the right call shape.
 */
import { qpilotRequest, sitePath } from "./client.js";
import { withRetry } from "./retry.js";
import { auditedMutation, pickLastModifiedAt } from "./_audit.js";
import { registerRollbackHandler } from "./audit.js";
import { env } from "../config/env.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

const OBJECT_TYPE = "scheduled_orders";

/**
 * Properties captured on status-change audits. Keeps audit rows compact
 * while still letting rollback recover the prior status from old_values.
 */
const STATUS_AUDIT_KEYS = ["id", "status", "isActive"];

/**
 * Properties captured on snooze audits. Must be a superset of every key the
 * snooze body can write, because rollback reads `args.properties` and pulls
 * each prior value from `old_values`.
 */
const SNOOZE_AUDIT_KEYS = [
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
const NEXT_OCCURRENCE_AUDIT_KEYS = [
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
const FREQUENCY_AUDIT_KEYS = [
  "id",
  "frequency",
  "frequencyType",
  "status",
  "isActive",
];

/**
 * Fetch a single scheduled order by id.
 * @param {string|number} id
 * @returns {Promise<object>}
 */
export async function getScheduledOrderById(id) {
  return await withRetry(() =>
    qpilotRequest({ path: orderPath(id) })
  );
}

/**
 * Lightweight search of scheduled orders. Uses the v3 endpoint which returns
 * a trimmed payload suitable for list views.
 *
 * Parameter names match QPilot's v3 endpoint exactly — `statusNames` is an
 * ARRAY (multiple statuses combine with OR), `search` is the free-text key,
 * and there is no dedicated `customerId` filter (route customer lookups
 * through `search` or via /Customers/{id} for direct fetches).
 *
 * @param {object} [params]
 * @param {number} [params.page=1] 1-indexed page number
 * @param {number} [params.pageSize] Page size (capped at MAX_PAGE_LIMIT)
 * @param {string[]} [params.statusNames] Filter by one or more status values
 *   (e.g. ["Active"], ["Paused","Failed"]). Sent as repeated query keys.
 * @param {string} [params.search] Free-text search across QPilot's default
 *   searchable fields.
 * @param {string} [params.orderBy] Field to sort by (default "NextOccurrenceUtc")
 * @param {"asc"|"desc"} [params.order] Sort direction (default "asc")
 * @returns {Promise<object>}
 */
export async function searchScheduledOrders({
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
  statusNames,
  search,
  orderBy,
  order,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      // The v3 endpoint sits at /v3/Sites/{siteId}/ScheduledOrders rather
      // than under sitePath()'s /Sites/{siteId} prefix.
      path: `/v3/Sites/${encodeURIComponent(env.siteId)}/ScheduledOrders`,
      query: {
        page,
        pageSize: cappedSize,
        statusNames,
        search,
        orderBy,
        order,
      },
    })
  );
}

/**
 * Fetch the QPilot-recorded change history for scheduled orders. This is
 * QPilot's own activity log — distinct from this server's local audit_log.
 *
 * Per QPilot docs the endpoint accepts only date-range, pagination, and
 * order parameters — there is NO server-side filter for a single order id.
 * To get one order's history, fetch a date range with `cache: true` and
 * then `query_cache(filter: scheduledOrderId EQ <id>)`.
 *
 * Date coercion: a bare date like "2026-05-05" passed to QPilot is
 * interpreted as 00:00:00Z, so an `endDate` bare date excludes anything
 * later that same day. We coerce a bare-date `endDate` to the end of that
 * day (T23:59:59.999Z) so the docstring's "inclusive upper bound" promise
 * actually holds. `startDate` is already inclusive at 00:00:00 with a bare
 * date, so we leave it alone.
 *
 * @param {object} [params]
 * @param {string} [params.startDate] ISO date (inclusive lower bound)
 * @param {string} [params.endDate] ISO date (inclusive upper bound — see coercion above)
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize]
 * @param {string} [params.orderBy="Id"] Field to sort by
 * @param {"asc"|"desc"} [params.order="desc"]
 * @returns {Promise<object>}
 */
export async function getScheduledOrdersHistory({
  startDate,
  endDate,
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
  orderBy,
  order,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/ScheduledOrdersHistory`),
      query: {
        startDate,
        endDate: coerceEndOfDay(endDate),
        page,
        pageSize: cappedSize,
        orderBy,
        order,
      },
    })
  );
}

/**
 * Convert a bare-date string ("YYYY-MM-DD") to its end-of-day UTC instant
 * so date-range queries treat the upper bound as inclusive of the whole
 * day. Strings that already have a time component pass through unchanged;
 * non-strings and undefined pass through unchanged.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function coerceEndOfDay(value) {
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
function matchTimestampPrecision(input, existing) {
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
 * Fields returned by GET /ScheduledOrders/{id} that QPilot computes, manages,
 * or treats as relations. They must not be echoed back through the generic
 * PUT — either QPilot rejects them, or it tries to write them and produces
 * confusing side effects.
 */
const PUT_STRIP_KEYS = new Set([
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

function mergeForPut(existing, properties) {
  const merged = { ...existing, ...properties };
  for (const k of PUT_STRIP_KEYS) delete merged[k];
  return merged;
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

// ---------------------------------------------------------------------------
// Rollback dispatcher
// ---------------------------------------------------------------------------

/**
 * All scheduled-order mutations are recorded as `operation: "update"`, so we
 * register a single handler for (scheduled_orders, update) and dispatch by
 * `tool_name`. Default path is body-based PUT rollback (snooze, next-
 * occurrence, frequency, and update_scheduled_order all funnel here).
 */
async function rollbackUpdate(ctx) {
  const tool = ctx.original.tool_name;
  if (tool === "change_scheduled_order_status") {
    return await rollbackStatusChange(ctx);
  }
  if (tool === "safe_activate_scheduled_order") {
    return await rollbackSafeActivate(ctx);
  }
  return await rollbackBodyUpdate(ctx);
}

async function rollbackBodyUpdate({ original, options, auditedMutation, markRolledBack }) {
  const id = original.object_id;
  const oldVals = original.old_values ?? {};
  const intent = original.args?.properties ?? {};
  const keysToRevert = Object.keys(intent);
  if (!keysToRevert.length) {
    throw new Error(
      `Audit row ${original.id} has no recorded args.properties — cannot determine what to revert`
    );
  }

  const propsToWrite = {};
  for (const k of keysToRevert) propsToWrite[k] = oldVals[k] ?? null;

  const path = orderPath(id);
  // Fetch once and reuse — drift check, audit pre-state capture, and merge
  // body all want the same current snapshot. The generic PUT needs a full
  // entity body for the same reason updateScheduledOrder does.
  const current = await withRetry(() => qpilotRequest({ path }));
  await assertNoDrift({
    original,
    options,
    keys: keysToRevert,
    fetchCurrent: async () => current,
  });
  const body = mergeForPut(current, propsToWrite);

  const { audit_id, changed_fields } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: {
      rolled_back_audit_id: Number(original.id),
      properties: propsToWrite,
    },
    fetchExisting: async () => current,
    perform: async () => {
      await withRetry(() => qpilotRequest({ path, method: "PUT", body }));
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: keysToRevert,
    rollbackAuditId: Number(original.id),
  });

  markRolledBack(Number(original.id), audit_id);
  return {
    original_audit_id: Number(original.id),
    rollback_audit_id: audit_id,
    changed_fields,
  };
}

async function rollbackStatusChange({ original, options, auditedMutation, markRolledBack }) {
  const id = original.object_id;
  const oldStatus = original.old_values?.status;
  if (!oldStatus) {
    throw new Error(
      `Audit row ${original.id} has no captured old_values.status — cannot determine target status`
    );
  }

  const getPath = orderPath(id);
  const setPath = statusPath(id, oldStatus);

  await assertNoDrift({
    original,
    options,
    keys: ["status"],
    fetchCurrent: () => qpilotRequest({ path: getPath }),
  });

  const { audit_id } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: {
      rolled_back_audit_id: Number(original.id),
      status: oldStatus,
    },
    fetchExisting: () => withRetry(() => qpilotRequest({ path: getPath })),
    perform: async () => {
      await withRetry(() => qpilotRequest({ path: setPath, method: "PUT" }));
      return await withRetry(() => qpilotRequest({ path: getPath }));
    },
    filterCapturedKeys: STATUS_AUDIT_KEYS,
    rollbackAuditId: Number(original.id),
  });

  markRolledBack(Number(original.id), audit_id);
  return {
    original_audit_id: Number(original.id),
    rollback_audit_id: audit_id,
    reverted_status: oldStatus,
  };
}

/**
 * Rollback for `safe_activate_scheduled_order`. SafeActivate transitions an
 * order to Active (or Paused, depending on QPilot's internal logic), so the
 * inverse depends on what the prior status was. We dispatch by old_values:
 *
 *   - "Paused" → PUT .../status/Paused (mirrors rollbackStatusChange)
 *   - "Deleted" → DELETE (re-soft-delete via the same path the delete tool uses)
 *   - "Active" → refuse: the original SafeActivate didn't change status, so
 *     there is nothing to revert
 *   - anything else (notably "Failed"): refuse with a clear message — QPilot's
 *     status endpoint only accepts Active/Paused, so Failed isn't reachable
 *     via the API. Operator has to manually intervene in the QPilot UI.
 */
async function rollbackSafeActivate({ original, options, auditedMutation, markRolledBack }) {
  const id = original.object_id;
  const oldStatus = original.old_values?.status;
  if (!oldStatus) {
    throw new Error(
      `Audit row ${original.id} has no captured old_values.status — cannot determine SafeActivate rollback target`
    );
  }
  if (oldStatus === "Active") {
    throw new Error(
      `Audit row ${original.id}: original status was already "Active" before SafeActivate — nothing to roll back.`
    );
  }
  if (oldStatus !== "Paused" && oldStatus !== "Deleted") {
    throw new Error(
      `Rolling back SafeActivate when the original status was "${oldStatus}" is not supported via the API — QPilot's status endpoint only accepts Active or Paused, and there is no path back to ${oldStatus}. Restore manually in the QPilot UI.`
    );
  }

  const getPath = orderPath(id);

  await assertNoDrift({
    original,
    options,
    keys: ["status"],
    fetchCurrent: () => qpilotRequest({ path: getPath }),
  });

  const performFn =
    oldStatus === "Paused"
      ? async () => {
          await withRetry(() =>
            qpilotRequest({ path: statusPath(id, "Paused"), method: "PUT" })
          );
          return await withRetry(() => qpilotRequest({ path: getPath }));
        }
      : async () => {
          await withRetry(() =>
            qpilotRequest({ path: getPath, method: "DELETE" })
          );
          return await withRetry(() => qpilotRequest({ path: getPath }));
        };

  const { audit_id } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { rolled_back_audit_id: Number(original.id), target_status: oldStatus },
    fetchExisting: () => withRetry(() => qpilotRequest({ path: getPath })),
    perform: performFn,
    filterCapturedKeys: STATUS_AUDIT_KEYS,
    rollbackAuditId: Number(original.id),
  });

  markRolledBack(Number(original.id), audit_id);
  return {
    original_audit_id: Number(original.id),
    rollback_audit_id: audit_id,
    reverted_status: oldStatus,
  };
}

/**
 * Compare current state to what the audit row recorded as `new_values` and
 * abort if any tracked key has drifted. `options.force` skips the check.
 */
async function assertNoDrift({ original, options, keys, fetchCurrent }) {
  if (options?.force) return;
  const current = await withRetry(fetchCurrent);

  // Coarse pre-check: QPilot's `updatedUtc` is the closest thing it exposes
  // to an ETag. If it has advanced since our mutation recorded
  // `last_modified_at`, something on the entity changed — even on a field
  // we don't track in `filterCapturedKeys`. We catch that here before the
  // narrow field-level comparison so side-band UI edits don't slip through.
  // Skipped when either timestamp is missing (older audits won't have one).
  const expectedLm = original.last_modified_at;
  const currentLm = pickLastModifiedAt(current);
  if (
    Number.isFinite(expectedLm) &&
    Number.isFinite(currentLm) &&
    expectedLm !== currentLm
  ) {
    throw new Error(
      `Drift detected on audit_id ${original.id}: entity updatedUtc has advanced from ${new Date(expectedLm).toISOString()} (recorded) to ${new Date(currentLm).toISOString()} (live). Something modified the entity after this mutation. Pass force: true to override.`
    );
  }

  const expected = original.new_values ?? {};
  const drift = [];
  for (const k of keys) {
    if (String(current?.[k] ?? "") !== String(expected[k] ?? "")) {
      drift.push({ field: k, expected: expected[k], current: current?.[k] });
    }
  }
  if (!drift.length) return;
  const lines = drift
    .map(
      (d) =>
        `  - ${d.field}: expected ${JSON.stringify(d.expected)}, current ${JSON.stringify(d.current)}`
    )
    .join("\n");
  throw new Error(
    `Drift detected on audit_id ${original.id}:\n${lines}\nPass force: true to override.`
  );
}

registerRollbackHandler(OBJECT_TYPE, "update", rollbackUpdate);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function orderPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}`);
}

function statusPath(id, status) {
  return sitePath(
    `/ScheduledOrders/${encodeURIComponent(id)}/status/${encodeURIComponent(status)}`
  );
}

function snoozePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/Snooze`);
}

function nextOccurrencePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/NextOccurrenceUtc`);
}

function frequencyPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/Frequency`);
}

function safeActivatePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/SafeActivate`);
}
