/**
 * Rollback dispatcher and handlers for scheduled-order audit rows.
 *
 * All scheduled-order mutations are recorded as `operation: "update"`, so we
 * register a single handler for (scheduled_orders, update) and dispatch by
 * `tool_name`. The default path is body-based PUT rollback; status flips,
 * SafeActivate, and Retry have dedicated handlers because their original
 * write didn't go through the generic body PUT.
 *
 * Importing this module has the side effect of calling
 * `registerRollbackHandler(OBJECT_TYPE, "update", rollbackUpdate)` so the
 * dispatcher is wired at module-load time. The barrel imports this module
 * for that side effect.
 */
import { qpilotRequest } from "../client.js";
import { withRetry } from "../retry.js";
import { pickLastModifiedAt } from "../_audit.js";
import { registerRollbackHandler } from "../audit.js";
import { OBJECT_TYPE, STATUS_AUDIT_KEYS } from "./constants.js";
import { orderPath, statusPath } from "./paths.js";
import { mergeForPut } from "./helpers.js";

async function rollbackUpdate(ctx) {
  const tool = ctx.original.tool_name;
  if (tool === "change_scheduled_order_status") {
    return await rollbackStatusChange(ctx);
  }
  if (tool === "safe_activate_scheduled_order") {
    return await rollbackSafeActivate(ctx);
  }
  if (tool === "retry_scheduled_order") {
    return await rollbackRetry(ctx);
  }
  return await rollbackBodyUpdate(ctx);
}

/**
 * Rollback for `retry_scheduled_order`. Always refuses: a Retry triggers a
 * processing cycle that may have included a payment-gateway call, and
 * those side effects cannot be reversed by an API call. The audit row
 * still carries forensic intent and the captured field changes, but
 * rollback_change is not a valid response to "I shouldn't have retried."
 */
async function rollbackRetry({ original }) {
  throw new Error(
    `Audit row ${original.id} cannot be rolled back: retry_scheduled_order triggers a processing cycle (payment-gateway side effects). Once attempted, the cycle cannot be reversed via the API. Investigate the resulting state in the QPilot UI and remediate manually if needed.`
  );
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
    },
    capturePostState: () => withRetry(() => qpilotRequest({ path })),
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
    },
    capturePostState: () => withRetry(() => qpilotRequest({ path: getPath })),
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
        }
      : async () => {
          await withRetry(() =>
            qpilotRequest({ path: getPath, method: "DELETE" })
          );
        };

  const { audit_id } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { rolled_back_audit_id: Number(original.id), target_status: oldStatus },
    fetchExisting: () => withRetry(() => qpilotRequest({ path: getPath })),
    perform: performFn,
    capturePostState: () => withRetry(() => qpilotRequest({ path: getPath })),
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
 *
 * Exported for tests. Internal to rollback dispatch otherwise.
 */
export async function assertNoDrift({ original, options, keys, fetchCurrent }) {
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
