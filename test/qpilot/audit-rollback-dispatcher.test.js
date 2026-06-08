/**
 * Tests for the rollback dispatcher's preconditions in src/qpilot/audit.js.
 *
 * Focuses on the partial-state path: when a mutation's QPilot write succeeded
 * but the follow-up refetch failed, the audit row carries
 * success=1 + post_state_error="..." + new_values=null. Rollback must refuse
 * by default (drift detection has no baseline) and must proceed with
 * `force: true`.
 *
 * Uses a synthetic object_type with a stub handler so the test doesn't depend
 * on any QPilot HTTP path.
 */
import "../_helpers/test-env.js";
import { test, describe, beforeEach, before } from "node:test";
import { strict as assert } from "node:assert";

import {
  registerRollbackHandler,
  rollbackChange,
} from "../../src/qpilot/audit.js";
import { insertAudit } from "../../src/db/queries/audit.js";
import { resetTestDb } from "../_helpers/test-env.js";
import { env } from "../../src/config/env.js";

const TEST_TYPE = "test_dispatcher_partial_state";

/** State captured by the stub handler so tests can assert dispatch occurred. */
let lastDispatchedCtx = null;

before(() => {
  registerRollbackHandler(TEST_TYPE, "update", async (ctx) => {
    lastDispatchedCtx = ctx;
    return {
      original_audit_id: Number(ctx.original.id),
      rollback_audit_id: -1,
    };
  });
});

function insertPartialStateRow({ id = 1 } = {}) {
  return insertAudit({
    scope: env.scope,
    session_id: env.sessionId,
    tool_name: "fake_mutation",
    object_type: TEST_TYPE,
    object_id: String(id),
    operation: "update",
    old_values: { status: "Active", frequency: 7 },
    new_values: null,
    changed_fields: null,
    args: { id, properties: { frequency: 14 } },
    success: true,
    error: null,
    post_state_error: "refetch failed: 503 Service Unavailable",
    last_modified_at: null,
    rollback_audit_id: null,
  });
}

function insertCleanSuccessRow({ id = 1 } = {}) {
  return insertAudit({
    scope: env.scope,
    session_id: env.sessionId,
    tool_name: "fake_mutation",
    object_type: TEST_TYPE,
    object_id: String(id),
    operation: "update",
    old_values: { status: "Active", frequency: 7 },
    new_values: { status: "Active", frequency: 14 },
    changed_fields: ["frequency"],
    args: { id, properties: { frequency: 14 } },
    success: true,
    error: null,
    post_state_error: null,
    last_modified_at: null,
    rollback_audit_id: null,
  });
}

describe("rollbackChange precondition: partial-state row", () => {
  beforeEach(async () => {
    await resetTestDb();
    lastDispatchedCtx = null;
  });

  test("refuses to roll back a partial-state row without force", async () => {
    const auditId = insertPartialStateRow();
    await assert.rejects(
      rollbackChange(auditId),
      /no captured post-state.*Drift detection cannot run.*force: true/s
    );
    assert.equal(lastDispatchedCtx, null, "handler must not be invoked");
  });

  test("proceeds with force: true and dispatches to the handler", async () => {
    const auditId = insertPartialStateRow();
    const out = await rollbackChange(auditId, { force: true });
    assert.equal(out.original_audit_id, auditId);
    assert.ok(lastDispatchedCtx, "handler should have been invoked");
    assert.equal(lastDispatchedCtx.options.force, true);
    assert.equal(lastDispatchedCtx.original.post_state_error, "refetch failed: 503 Service Unavailable");
  });

  test("clean success row (post_state_error null) is not blocked", async () => {
    const auditId = insertCleanSuccessRow();
    const out = await rollbackChange(auditId);
    assert.equal(out.original_audit_id, auditId);
    assert.ok(lastDispatchedCtx);
  });

  test("error message names the original post-state error verbatim", async () => {
    const auditId = insertPartialStateRow();
    let err;
    try {
      await rollbackChange(auditId);
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /refetch failed: 503 Service Unavailable/);
  });
});
