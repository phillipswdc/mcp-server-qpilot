/**
 * Audit wrapper for QPilot mutations.
 *
 * Every create/update/delete-style mutation flows through `auditedMutation`
 * so that:
 *   1. Existing state is captured before the change (old_values).
 *   2. The write runs, even if it fails.
 *   3. The new state (or null for deletes) is captured after the write.
 *   4. Changed fields are diffed for updates.
 *   5. An audit_log row is inserted with success/error context.
 *
 * Write and post-state capture are tracked separately. QPilot writes can
 * succeed while the follow-up GET that captures new_values fails (5xx,
 * timeout, etc.). Conflating them would mark a real mutation as failed and
 * lock out rollback. Callers split the two phases via `perform` (the write)
 * and `capturePostState` (the refetch). `success` reflects the write only;
 * `post_state_error` records a refetch failure independently.
 *
 * Tools never call this directly — domain modules wrap their mutations with it.
 */
import { env } from "../config/env.js";
import { insertAudit } from "../db/queries/audit.js";

/**
 * @typedef {object} AuditedMutationParams
 * @property {string} toolName e.g. "delete_scheduled_order"
 * @property {string} objectType e.g. "scheduled_orders"
 * @property {"create"|"update"|"delete"} operation
 * @property {object} args Original tool args (forensic record)
 * @property {() => Promise<object|null>} fetchExisting Returns the entity's
 *   current state (or null for a fresh create). Called once before `perform`.
 * @property {() => Promise<object|null>} perform Executes the write. When
 *   `capturePostState` is also provided, `perform`'s return value is ignored
 *   and the new state comes from `capturePostState`. Otherwise the return
 *   value is treated as the new state (back-compat shape — for writes whose
 *   response body is the entity, e.g. POST creates).
 * @property {() => Promise<object|null>} [capturePostState] Optional refetch
 *   callback invoked only when `perform` resolves. A throw here records the
 *   row as success=1 with `post_state_error` set and new_values=null. The
 *   caller still sees the throw (forensic visibility); rollback of the row
 *   remains possible but requires `force: true` because drift detection has
 *   no baseline to compare against.
 * @property {string[]} [filterCapturedKeys] When provided, the stored
 *   old_values and new_values are filtered to only these keys. Keeps audit
 *   rows lean — captures explicit intent without noisy auto-included fields.
 * @property {(result: object|null) => string|null} [extractObjectId] Override
 *   how the resulting object_id is derived. Default tries result.id, then
 *   the existing snapshot's id.
 * @property {(result: object|null) => number|null} [extractLastModifiedAt]
 *   Override how the drift-detection timestamp is derived. Default tries a
 *   handful of common shapes.
 * @property {number|null} [rollbackAuditId=null] If this mutation IS itself
 *   a rollback, the audit_id of the original change being reversed.
 */

/**
 * Execute a QPilot mutation with full audit capture.
 *
 * @param {AuditedMutationParams} params
 * @returns {Promise<{ result: object|null, audit_id: number, changed_fields: string[]|null }>}
 */
export async function auditedMutation({
  toolName,
  objectType,
  operation,
  args,
  fetchExisting,
  perform,
  capturePostState,
  filterCapturedKeys = null,
  extractObjectId,
  extractLastModifiedAt,
  rollbackAuditId = null,
}) {
  const fullOld = await safeFetch(fetchExisting);

  // Phase 1: the write. If this throws, the mutation did not land in QPilot.
  let writeResult = null;
  let writeError = null;
  let writeSuccess = false;
  try {
    writeResult = await perform();
    writeSuccess = true;
  } catch (err) {
    writeError = err;
  }

  // Phase 2: post-state capture. Only invoked when the write succeeded.
  // A throw here means QPilot has the mutation but we couldn't snapshot
  // the result — recorded distinctly via post_state_error so the row
  // stays rollback-eligible (with force).
  let postState = writeResult;
  let postStateError = null;
  if (writeSuccess && capturePostState) {
    try {
      postState = await capturePostState();
    } catch (err) {
      postStateError = err;
      postState = null;
    }
  }

  const fullNew = writeSuccess ? postState : null;

  const old_values = applyKeyFilter(fullOld, filterCapturedKeys);
  const new_values = applyKeyFilter(fullNew, filterCapturedKeys);

  const changed_fields =
    operation === "update" && old_values && new_values
      ? diffProperties(old_values, new_values)
      : null;

  const objectId =
    (extractObjectId ? extractObjectId(postState ?? fullOld) : null) ??
    pickId(postState) ??
    pickId(fullOld);

  const lastModifiedAt = extractLastModifiedAt
    ? extractLastModifiedAt(postState)
    : pickLastModifiedAt(postState);

  const audit_id = insertAudit({
    scope: env.scope,
    session_id: env.sessionId,
    tool_name: toolName,
    object_type: objectType,
    object_id: objectId,
    operation,
    old_values,
    new_values,
    changed_fields,
    args,
    success: writeSuccess,
    error: writeError ? String(writeError?.message ?? writeError) : null,
    post_state_error: postStateError
      ? String(postStateError?.message ?? postStateError)
      : null,
    last_modified_at: lastModifiedAt ?? null,
    rollback_audit_id: rollbackAuditId,
  });

  if (!writeSuccess) {
    throw Object.assign(writeError ?? new Error("QPilot mutation failed"), {
      audit_id,
    });
  }
  if (postStateError) {
    throw Object.assign(postStateError, {
      audit_id,
      post_state_capture: true,
    });
  }

  return { result: postState, audit_id, changed_fields };
}

function pickId(obj) {
  if (!obj || typeof obj !== "object") return null;
  const candidate = obj.id ?? obj.Id ?? obj.scheduledOrderId ?? obj.customerId;
  return candidate != null ? String(candidate) : null;
}

export function pickLastModifiedAt(obj) {
  if (!obj || typeof obj !== "object") return null;
  // `updatedUtc` is QPilot's actual field name on scheduled orders and items;
  // the others are kept as fallbacks for entities we haven't surveyed yet.
  const candidates = [
    obj.updatedUtc,
    obj.lastModifiedAt,
    obj.updatedAt,
    obj.modifiedAt,
    obj.LastModifiedDate,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const t = typeof c === "string" ? Date.parse(c) : Number(c);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Filter an object's top-level keys to the listed set.
 * @param {object|null|undefined} shape
 * @param {string[]|null} keys
 */
function applyKeyFilter(shape, keys) {
  if (!shape || !keys || !Array.isArray(keys)) return shape;
  const filtered = {};
  for (const k of keys) {
    if (k in shape) filtered[k] = shape[k];
  }
  return filtered;
}

/**
 * Compute the list of field names that differ between two snapshots.
 * Compares with `!==` after String coercion so SDK-style stringy values
 * don't produce false positives against numbers.
 *
 * @param {Record<string,unknown>} oldVals
 * @param {Record<string,unknown>} newVals
 * @returns {string[]}
 */
function diffProperties(oldVals, newVals) {
  const keys = new Set([...Object.keys(oldVals), ...Object.keys(newVals)]);
  const changed = [];
  for (const k of keys) {
    if (String(oldVals[k] ?? "") !== String(newVals[k] ?? "")) changed.push(k);
  }
  return changed;
}

async function safeFetch(fn) {
  if (!fn) return null;
  try {
    return await fn();
  } catch (err) {
    const status = err?.status ?? err?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}
