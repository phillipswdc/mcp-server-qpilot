/**
 * Audit wrapper for QPilot mutations.
 *
 * Every create/update/delete-style mutation flows through `auditedMutation`
 * so that:
 *   1. Existing state is captured before the change (old_values).
 *   2. The mutation runs, even if it fails.
 *   3. The new state (or null for deletes) is captured after success.
 *   4. Changed fields are diffed for updates.
 *   5. An audit_log row is inserted with success/error context.
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
 * @property {() => Promise<object|null>} perform Executes the mutation; resolves
 *   to the new state of the entity (or null for hard deletes that have no
 *   post-state).
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
  filterCapturedKeys = null,
  extractObjectId,
  extractLastModifiedAt,
  rollbackAuditId = null,
}) {
  const fullOld = await safeFetch(fetchExisting);

  let result = null;
  let error = null;
  let success = false;

  try {
    result = await perform();
    success = true;
  } catch (err) {
    error = err;
  }

  const fullNew = success ? result : null;

  const old_values = applyKeyFilter(fullOld, filterCapturedKeys);
  const new_values = applyKeyFilter(fullNew, filterCapturedKeys);

  const changed_fields =
    operation === "update" && old_values && new_values
      ? diffProperties(old_values, new_values)
      : null;

  const objectId =
    (extractObjectId ? extractObjectId(result ?? fullOld) : null) ??
    pickId(result) ??
    pickId(fullOld);

  const lastModifiedAt = extractLastModifiedAt
    ? extractLastModifiedAt(result)
    : pickLastModifiedAt(result);

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
    success,
    error: error ? String(error?.message ?? error) : null,
    last_modified_at: lastModifiedAt ?? null,
    rollback_audit_id: rollbackAuditId,
  });

  if (!success) {
    throw Object.assign(error ?? new Error("QPilot mutation failed"), {
      audit_id,
    });
  }

  return { result, audit_id, changed_fields };
}

function pickId(obj) {
  if (!obj || typeof obj !== "object") return null;
  const candidate = obj.id ?? obj.Id ?? obj.scheduledOrderId ?? obj.customerId;
  return candidate != null ? String(candidate) : null;
}

function pickLastModifiedAt(obj) {
  if (!obj || typeof obj !== "object") return null;
  const candidates = [
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
