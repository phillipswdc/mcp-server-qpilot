/**
 * Scheduled Order Items domain module.
 *
 * Reads (no audit): getById.
 * Mutations (audited + rollback):
 *   - update: PUT — rollback writes captured old_values back.
 *   - deleteItem: DELETE — this IS a real delete in QPilot (unlike scheduled
 *     orders), so the rollback handler re-creates the item from old_values
 *     via POST. The new id will differ from the original, so the rollback
 *     audit row records the new id and links back via rollback_audit_id.
 */
import { qpilotRequest, sitePath } from "./client.js";
import { withRetry } from "./retry.js";
import { auditedMutation, pickLastModifiedAt } from "./_audit.js";
import { registerRollbackHandler } from "./audit.js";

const OBJECT_TYPE = "scheduled_order_items";
const COLLECTION_PATH = "/ScheduledOrderItems";

/**
 * Fetch a single scheduled order item by id.
 * @param {string|number} id
 */
export async function getScheduledOrderItemById(id) {
  return await withRetry(() => qpilotRequest({ path: itemPath(id) }));
}

/**
 * Update a scheduled order item via PUT.
 *
 * @param {object} params
 * @param {string|number} params.id
 * @param {Record<string,unknown>} params.properties Body to merge
 */
export async function updateScheduledOrderItem({ id, properties }) {
  const path = itemPath(id);
  const filterKeys = Object.keys(properties);

  return await auditedMutation({
    toolName: "update_scheduled_order_item",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: { id, properties },
    fetchExisting: () => withRetry(() => qpilotRequest({ path })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({ path, method: "PUT", body: properties })
      );
      return await withRetry(() => qpilotRequest({ path }));
    },
    filterCapturedKeys: filterKeys,
  });
}

/**
 * Delete a scheduled order item. Real deletion — captured `old_values`
 * become the only path back, via the registered rollback handler.
 *
 * @param {string|number} id
 */
export async function deleteScheduledOrderItem(id) {
  return await auditedMutation({
    toolName: "delete_scheduled_order_item",
    objectType: OBJECT_TYPE,
    operation: "delete",
    args: { id },
    fetchExisting: () => withRetry(() => qpilotRequest({ path: itemPath(id) })),
    perform: async () => {
      await withRetry(() =>
        qpilotRequest({ path: itemPath(id), method: "DELETE" })
      );
      // No post-state to capture — the item is gone.
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Rollback handlers
// ---------------------------------------------------------------------------

/** PUT-body update rollback: revert only the keys the original update touched. */
async function rollbackItemUpdate({ original, options, auditedMutation, markRolledBack }) {
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

  const path = itemPath(id);

  if (!options?.force) {
    const current = await withRetry(() => qpilotRequest({ path }));

    const expectedLm = original.last_modified_at;
    const currentLm = pickLastModifiedAt(current);
    if (
      Number.isFinite(expectedLm) &&
      Number.isFinite(currentLm) &&
      expectedLm !== currentLm
    ) {
      throw new Error(
        `Drift detected on audit_id ${original.id}: item updatedUtc has advanced from ${new Date(expectedLm).toISOString()} (recorded) to ${new Date(currentLm).toISOString()} (live). Something modified the item after this mutation. Pass force: true to override.`
      );
    }

    const expected = original.new_values ?? {};
    const drift = [];
    for (const k of keysToRevert) {
      if (String(current?.[k] ?? "") !== String(expected[k] ?? "")) {
        drift.push({ field: k, expected: expected[k], current: current?.[k] });
      }
    }
    if (drift.length) {
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
  }

  const { audit_id, changed_fields } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "update",
    args: {
      rolled_back_audit_id: Number(original.id),
      properties: propsToWrite,
    },
    fetchExisting: () => withRetry(() => qpilotRequest({ path })),
    perform: async () => {
      await withRetry(() => qpilotRequest({ path, method: "PUT", body: propsToWrite }));
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

/**
 * Delete rollback: re-create the item from captured old_values via POST.
 *
 * The re-created item will get a NEW id (the original is gone). We strip
 * id-shaped fields from the recreate body so QPilot can mint a fresh one,
 * and record both ids on the rollback audit row for traceability.
 */
async function rollbackItemDelete({ original, options, auditedMutation, markRolledBack }) {
  const oldVals = original.old_values;
  if (!oldVals || typeof oldVals !== "object") {
    throw new Error(
      `Audit row ${original.id} has no captured old_values — cannot recreate the item`
    );
  }

  // Strip server-managed identity / timestamp fields so QPilot mints fresh ones.
  const recreateBody = stripServerManagedFields(oldVals);

  // Drift-style sanity check: confirm the original id really is gone before
  // we recreate. If something already exists at that id, the rollback would
  // create a duplicate. options.force skips this.
  if (!options?.force) {
    let stillThere = false;
    try {
      await withRetry(() => qpilotRequest({ path: itemPath(original.object_id) }));
      stillThere = true;
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      if (status !== 404) throw err;
    }
    if (stillThere) {
      throw new Error(
        `Item ${original.object_id} still exists (404 expected). Refusing to recreate to avoid duplicates. Pass force: true to recreate anyway.`
      );
    }
  }

  const { result, audit_id } = await auditedMutation({
    toolName: "rollback_change",
    objectType: OBJECT_TYPE,
    operation: "create",
    args: {
      rolled_back_audit_id: Number(original.id),
      original_object_id: original.object_id,
      properties: recreateBody,
    },
    fetchExisting: async () => null,
    perform: async () => {
      const created = await withRetry(() =>
        qpilotRequest({
          path: sitePath(COLLECTION_PATH),
          method: "POST",
          body: recreateBody,
        })
      );
      return created;
    },
    rollbackAuditId: Number(original.id),
  });

  markRolledBack(Number(original.id), audit_id);

  return {
    original_audit_id: Number(original.id),
    rollback_audit_id: audit_id,
    original_item_id: original.object_id,
    new_item_id: result?.id ?? null,
    note:
      "Re-created item received a new id from QPilot — the original id is permanently gone.",
  };
}

/**
 * Drop fields that QPilot manages itself so a recreate body doesn't conflict
 * with server-side identity/timestamps. List is conservative; unknown fields
 * pass through untouched.
 */
function stripServerManagedFields(obj) {
  const SERVER_MANAGED = new Set([
    "id",
    "Id",
    "scheduledOrderItemId",
    "createdAt",
    "createdDate",
    "modifiedAt",
    "modifiedDate",
    "lastModifiedAt",
    "lastModifiedDate",
    "updatedAt",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SERVER_MANAGED.has(k)) continue;
    out[k] = v;
  }
  return out;
}

registerRollbackHandler(OBJECT_TYPE, "update", rollbackItemUpdate);
registerRollbackHandler(OBJECT_TYPE, "delete", rollbackItemDelete);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function itemPath(id) {
  return sitePath(`${COLLECTION_PATH}/${encodeURIComponent(id)}`);
}
