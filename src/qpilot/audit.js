/**
 * Public audit-domain methods: list/inspect/prune audit rows, plus a
 * registry-driven rollback dispatcher.
 *
 * Why a registry instead of a single `rollbackChange` like HubSpot's: QPilot
 * doesn't have a uniform "update(id, properties)" surface — endpoints differ
 * shape per resource (scheduled orders, scheduled order items, customers,
 * etc.). Each domain module registers a handler for its (object_type,
 * operation) pair. Rollback dispatches into that registry; missing handlers
 * produce a clear "not yet supported" error rather than silently breaking.
 */
import { auditedMutation } from "./_audit.js";
import {
  getAuditById,
  listRecentAudits,
  markRolledBack,
  pruneAudit,
} from "../db/queries/audit.js";
import { env } from "../config/env.js";

/**
 * @typedef {object} RollbackContext
 * @property {object} original Audit row of the original mutation
 * @property {{ force?: boolean }} options Caller options
 * @property {typeof auditedMutation} auditedMutation Use to record the rollback
 * @property {typeof markRolledBack} markRolledBack Call after a successful rollback
 */

/**
 * @typedef {(ctx: RollbackContext) => Promise<{
 *   original_audit_id: number,
 *   rollback_audit_id: number,
 *   [key: string]: unknown
 * }>} RollbackHandler
 */

/** @type {Map<string, RollbackHandler>} */
const rollbackHandlers = new Map();

const handlerKey = (objectType, operation) => `${objectType}:${operation}`;

/**
 * Register a rollback handler for a specific (object_type, operation).
 * Domain modules call this at module load to opt their mutations into rollback.
 *
 * @param {string} objectType
 * @param {"create"|"update"|"delete"} operation
 * @param {RollbackHandler} handler
 */
export function registerRollbackHandler(objectType, operation, handler) {
  const key = handlerKey(objectType, operation);
  if (rollbackHandlers.has(key)) {
    throw new Error(`Rollback handler already registered for ${key}`);
  }
  rollbackHandlers.set(key, handler);
}

/**
 * Reverse a previously-recorded mutation. Dispatches into the registered
 * handler for the audit row's (object_type, operation). Common preconditions
 * (already rolled back, failed mutation, scope mismatch) are checked here so
 * handlers can focus on the actual reversal.
 *
 * @param {number|string} originalAuditId
 * @param {{ force?: boolean }} [options]
 */
export async function rollbackChange(originalAuditId, options = {}) {
  const original = getAuditById(originalAuditId);
  if (!original) throw new Error(`Audit row ${originalAuditId} not found`);
  if (!original.success)
    throw new Error(
      `Audit row ${originalAuditId} recorded a failed mutation; nothing to roll back`
    );
  if (original.rolled_back)
    throw new Error(
      `Audit row ${originalAuditId} is already rolled back (rollback audit id: ${original.rollback_audit_id})`
    );
  if (original.scope !== env.scope)
    throw new Error(
      `Audit row ${originalAuditId} was recorded in scope "${original.scope}", but current scope is "${env.scope}". Repoint QPILOT_SITE_ID to roll it back.`
    );
  // Partial-state row: the QPilot write succeeded but the follow-up GET that
  // would have captured new_values failed. We have old_values + args, which is
  // enough to attempt a rollback, but drift detection has no baseline. Refuse
  // unless the caller acknowledges the gap with force: true.
  if (original.post_state_error && !options?.force)
    throw new Error(
      `Audit row ${originalAuditId} has no captured post-state (the QPilot write succeeded but the follow-up refetch failed: ${original.post_state_error}). Drift detection cannot run for this row. Pass force: true to roll back using old_values without drift checks.`
    );

  const key = handlerKey(original.object_type, original.operation);
  const handler = rollbackHandlers.get(key);
  if (!handler) {
    throw new Error(
      `Rollback is not supported for ${original.object_type} ${original.operation}. ` +
        `(No handler registered. Add one via registerRollbackHandler when implementing the matching mutation tool.)`
    );
  }

  return await handler({
    original,
    options,
    auditedMutation,
    markRolledBack,
  });
}

/**
 * List recent audit rows with optional filters.
 *
 * @param {{ object_type?: string, object_id?: string, only_unrolled?: boolean, only_successful?: boolean, session_id?: string, limit?: number, offset?: number }} [filters]
 */
export function listRecentChanges(filters = {}) {
  return listRecentAudits(filters);
}

/**
 * Get the full detail of a single audit row.
 *
 * @param {number|string} auditId
 */
export function getChangeDetail(auditId) {
  return getAuditById(auditId);
}

/**
 * Permanently delete audit rows. Composable filters: by age, by session, or
 * "everything except current session." At least one filter must be set.
 *
 * @param {object} options
 * @param {number} [options.olderThanDays]
 * @param {string} [options.session_id]
 * @param {string} [options.except_session_id]
 */
export function pruneAuditLog({
  olderThanDays = null,
  session_id = null,
  except_session_id = null,
} = {}) {
  if (
    olderThanDays === null &&
    session_id === null &&
    except_session_id === null
  ) {
    throw new Error(
      "prune_audit_log requires at least one filter: older_than_days, session_id, or except_session_id"
    );
  }
  if (olderThanDays !== null && (!Number.isFinite(olderThanDays) || olderThanDays <= 0)) {
    throw new Error("older_than_days must be a positive number");
  }

  const cutoffMs =
    olderThanDays !== null
      ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      : null;
  const counts = pruneAudit({ cutoffMs, session_id, except_session_id });
  return {
    ...counts,
    ...(cutoffMs !== null ? { cutoff_iso: new Date(cutoffMs).toISOString() } : {}),
    ...(session_id !== null ? { session_id } : {}),
    ...(except_session_id !== null ? { except_session_id } : {}),
  };
}
