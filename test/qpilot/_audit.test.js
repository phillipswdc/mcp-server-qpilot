/**
 * Integration tests for auditedMutation. Uses a real test SQLite DB
 * (data/qpilot-site-test.db) wiped between tests. No HTTP is involved —
 * tests pass mock fetchExisting/perform callbacks directly.
 */
import "../_helpers/test-env.js";
import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

import { auditedMutation, pickLastModifiedAt } from "../../src/qpilot/_audit.js";
import { getAuditById } from "../../src/db/queries/audit.js";
import { resetTestDb } from "../_helpers/test-env.js";

describe("auditedMutation success path", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  test("writes a success row and returns audit_id + result", async () => {
    const out = await auditedMutation({
      toolName: "update_scheduled_order",
      objectType: "scheduled_orders",
      operation: "update",
      args: { id: 1, properties: { frequency: 14 } },
      fetchExisting: async () => ({ id: 1, frequency: 7, status: "Active" }),
      perform: async () => ({ id: 1, frequency: 14, status: "Active" }),
    });
    assert.ok(Number.isInteger(out.audit_id));
    assert.deepEqual(out.result, { id: 1, frequency: 14, status: "Active" });
    const row = getAuditById(out.audit_id);
    assert.equal(row.success, true);
    assert.equal(row.error, null);
    assert.equal(row.tool_name, "update_scheduled_order");
    assert.equal(row.object_type, "scheduled_orders");
    assert.equal(row.object_id, "1");
    assert.equal(row.operation, "update");
  });

  test("computes changed_fields for update operations", async () => {
    const out = await auditedMutation({
      toolName: "update_scheduled_order",
      objectType: "scheduled_orders",
      operation: "update",
      args: { id: 1, properties: { frequency: 14 } },
      fetchExisting: async () => ({ id: 1, frequency: 7, status: "Active" }),
      perform: async () => ({ id: 1, frequency: 14, status: "Active" }),
    });
    assert.deepEqual(out.changed_fields, ["frequency"]);
    const row = getAuditById(out.audit_id);
    assert.deepEqual(row.changed_fields, ["frequency"]);
  });

  test("does not compute changed_fields for create operations", async () => {
    const out = await auditedMutation({
      toolName: "create_something",
      objectType: "scheduled_orders",
      operation: "create",
      args: { frequency: 7 },
      fetchExisting: async () => null,
      perform: async () => ({ id: 42, frequency: 7 }),
    });
    assert.equal(out.changed_fields, null);
    const row = getAuditById(out.audit_id);
    assert.equal(row.changed_fields, null);
    assert.equal(row.object_id, "42");
  });

  test("filterCapturedKeys narrows old_values and new_values to listed keys", async () => {
    const out = await auditedMutation({
      toolName: "update_scheduled_order",
      objectType: "scheduled_orders",
      operation: "update",
      args: { id: 1, properties: { frequency: 14 } },
      fetchExisting: async () => ({
        id: 1,
        frequency: 7,
        status: "Active",
        customer: { id: 99, name: "noise" },
        lifetimeValue: 9999,
      }),
      perform: async () => ({
        id: 1,
        frequency: 14,
        status: "Active",
        customer: { id: 99, name: "noise" },
        lifetimeValue: 10042,
      }),
      filterCapturedKeys: ["id", "frequency"],
    });
    const row = getAuditById(out.audit_id);
    assert.deepEqual(Object.keys(row.old_values).sort(), ["frequency", "id"]);
    assert.deepEqual(Object.keys(row.new_values).sort(), ["frequency", "id"]);
    assert.equal(row.old_values.frequency, 7);
    assert.equal(row.new_values.frequency, 14);
    // Even though lifetimeValue legitimately changed, filterCapturedKeys
    // scoped changed_fields to the intent.
    assert.deepEqual(row.changed_fields, ["frequency"]);
  });

  test("captures last_modified_at from updatedUtc on the post-state", async () => {
    const out = await auditedMutation({
      toolName: "update_scheduled_order",
      objectType: "scheduled_orders",
      operation: "update",
      args: { id: 1, properties: { frequency: 14 } },
      fetchExisting: async () => ({ id: 1, frequency: 7 }),
      perform: async () => ({
        id: 1,
        frequency: 14,
        updatedUtc: "2026-05-05T12:34:56.789Z",
      }),
    });
    const row = getAuditById(out.audit_id);
    const expectedMs = Date.parse("2026-05-05T12:34:56.789Z");
    assert.equal(row.last_modified_at, expectedMs);
  });

  test("propagates rollbackAuditId to the audit row", async () => {
    const out = await auditedMutation({
      toolName: "rollback_change",
      objectType: "scheduled_orders",
      operation: "update",
      args: { rolled_back_audit_id: 42, properties: { frequency: 7 } },
      fetchExisting: async () => ({ id: 1, frequency: 14 }),
      perform: async () => ({ id: 1, frequency: 7 }),
      rollbackAuditId: 42,
    });
    const row = getAuditById(out.audit_id);
    assert.equal(row.rollback_audit_id, 42);
  });

  test("extractObjectId override is used when provided", async () => {
    const out = await auditedMutation({
      toolName: "weird_tool",
      objectType: "scheduled_orders",
      operation: "update",
      args: { customId: "abc" },
      fetchExisting: async () => ({ frequency: 7 }),
      perform: async () => ({ frequency: 14 }),
      extractObjectId: () => "abc",
    });
    const row = getAuditById(out.audit_id);
    assert.equal(row.object_id, "abc");
  });
});

describe("auditedMutation failure path", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  test("writes a failure row when perform throws", async () => {
    const boom = new Error("QPilot 400: validation failed");
    let thrown;
    try {
      await auditedMutation({
        toolName: "update_scheduled_order",
        objectType: "scheduled_orders",
        operation: "update",
        args: { id: 1, properties: { frequency: 14 } },
        fetchExisting: async () => ({ id: 1, frequency: 7 }),
        perform: async () => {
          throw boom;
        },
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, "expected the failed mutation to re-throw");
    assert.ok(thrown.audit_id, "expected audit_id attached to the thrown error");
    const row = getAuditById(thrown.audit_id);
    assert.equal(row.success, false);
    assert.equal(row.error, "QPilot 400: validation failed");
    assert.equal(row.new_values, null);
  });

  test("re-throws the same error instance with audit_id attached", async () => {
    const boom = new Error("specific");
    let thrown;
    try {
      await auditedMutation({
        toolName: "any",
        objectType: "scheduled_orders",
        operation: "update",
        args: {},
        fetchExisting: async () => null,
        perform: async () => {
          throw boom;
        },
      });
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown, boom);
    assert.ok(Number.isInteger(thrown.audit_id));
  });

  test("captures old_values even on failure (forensic completeness)", async () => {
    let thrown;
    try {
      await auditedMutation({
        toolName: "update_scheduled_order",
        objectType: "scheduled_orders",
        operation: "update",
        args: { id: 1, properties: { frequency: 14 } },
        fetchExisting: async () => ({ id: 1, frequency: 7, status: "Active" }),
        perform: async () => {
          throw new Error("upstream rejected");
        },
        filterCapturedKeys: ["id", "frequency"],
      });
    } catch (err) {
      thrown = err;
    }
    const row = getAuditById(thrown.audit_id);
    assert.equal(row.old_values.frequency, 7);
    assert.equal(row.new_values, null);
  });

  test("survives fetchExisting throwing a non-404 error", async () => {
    const boom = new Error("transport failure");
    boom.status = 500;
    let thrown;
    try {
      await auditedMutation({
        toolName: "update_scheduled_order",
        objectType: "scheduled_orders",
        operation: "update",
        args: { id: 1, properties: {} },
        fetchExisting: async () => {
          throw boom;
        },
        perform: async () => ({ id: 1 }),
      });
    } catch (err) {
      thrown = err;
    }
    // Non-404 fetchExisting errors bubble out; no audit row should be written.
    assert.equal(thrown, boom);
    assert.equal(thrown.audit_id, undefined);
  });

  test("treats a 404 fetchExisting as null old_values (create-from-missing case)", async () => {
    const notFound = new Error("not found");
    notFound.status = 404;
    const out = await auditedMutation({
      toolName: "creates_if_missing",
      objectType: "scheduled_orders",
      operation: "create",
      args: {},
      fetchExisting: async () => {
        throw notFound;
      },
      perform: async () => ({ id: 7 }),
    });
    const row = getAuditById(out.audit_id);
    assert.equal(row.old_values, null);
    assert.equal(row.success, true);
  });
});

describe("auditedMutation post-state capture failure", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  test("write OK + capturePostState throws: success=1, post_state_error captured, new_values=null", async () => {
    const postBoom = new Error("refetch 503");
    let thrown;
    try {
      await auditedMutation({
        toolName: "update_scheduled_order",
        objectType: "scheduled_orders",
        operation: "update",
        args: { id: 1, properties: { frequency: 14 } },
        fetchExisting: async () => ({ id: 1, frequency: 7, status: "Active" }),
        perform: async () => {
          /* write OK; returns nothing — capturePostState owns post-state */
        },
        capturePostState: async () => {
          throw postBoom;
        },
        filterCapturedKeys: ["id", "frequency"],
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, "expected the post-state failure to throw to the caller");
    assert.equal(thrown, postBoom, "same error instance is re-thrown");
    assert.equal(thrown.post_state_capture, true);
    assert.ok(Number.isInteger(thrown.audit_id));
    const row = getAuditById(thrown.audit_id);
    assert.equal(row.success, true);
    assert.equal(row.error, null);
    assert.equal(row.post_state_error, "refetch 503");
    assert.equal(row.new_values, null);
    assert.equal(row.changed_fields, null);
    // old_values is still captured — that's what makes force-rollback viable.
    assert.equal(row.old_values.frequency, 7);
  });

  test("write OK + capturePostState OK: success=1, post_state_error=null, new_values populated", async () => {
    const out = await auditedMutation({
      toolName: "update_scheduled_order",
      objectType: "scheduled_orders",
      operation: "update",
      args: { id: 1, properties: { frequency: 14 } },
      fetchExisting: async () => ({ id: 1, frequency: 7, status: "Active" }),
      perform: async () => {
        /* write OK */
      },
      capturePostState: async () => ({ id: 1, frequency: 14, status: "Active" }),
    });
    const row = getAuditById(out.audit_id);
    assert.equal(row.success, true);
    assert.equal(row.error, null);
    assert.equal(row.post_state_error, null);
    assert.equal(row.new_values.frequency, 14);
  });

  test("write fails: capturePostState is not invoked even if provided", async () => {
    let postCalled = false;
    let thrown;
    try {
      await auditedMutation({
        toolName: "update_scheduled_order",
        objectType: "scheduled_orders",
        operation: "update",
        args: { id: 1, properties: { frequency: 14 } },
        fetchExisting: async () => ({ id: 1, frequency: 7 }),
        perform: async () => {
          throw new Error("write 400");
        },
        capturePostState: async () => {
          postCalled = true;
          return {};
        },
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown);
    assert.equal(postCalled, false);
    const row = getAuditById(thrown.audit_id);
    assert.equal(row.success, false);
    assert.equal(row.error, "write 400");
    assert.equal(row.post_state_error, null);
  });

  test("back-compat: no capturePostState means perform's return value is the new state", async () => {
    const out = await auditedMutation({
      toolName: "create_item",
      objectType: "scheduled_order_items",
      operation: "create",
      args: {},
      fetchExisting: async () => null,
      perform: async () => ({ id: 7, sku: "ABC" }),
    });
    const row = getAuditById(out.audit_id);
    assert.equal(row.success, true);
    assert.equal(row.post_state_error, null);
    assert.equal(row.new_values.id, 7);
    assert.equal(row.new_values.sku, "ABC");
  });
});

describe("pickLastModifiedAt", () => {
  test("prefers updatedUtc when present", () => {
    const ms = pickLastModifiedAt({
      updatedUtc: "2026-05-05T12:34:56.789Z",
      lastModifiedAt: "2025-01-01T00:00:00Z",
    });
    assert.equal(ms, Date.parse("2026-05-05T12:34:56.789Z"));
  });

  test("falls back to lastModifiedAt, then updatedAt, etc.", () => {
    assert.equal(
      pickLastModifiedAt({ lastModifiedAt: "2026-05-05T00:00:00Z" }),
      Date.parse("2026-05-05T00:00:00Z")
    );
    assert.equal(
      pickLastModifiedAt({ updatedAt: "2026-05-05T00:00:00Z" }),
      Date.parse("2026-05-05T00:00:00Z")
    );
  });

  test("returns null for objects without any recognized timestamp", () => {
    assert.equal(pickLastModifiedAt({ id: 1 }), null);
    assert.equal(pickLastModifiedAt(null), null);
    assert.equal(pickLastModifiedAt(undefined), null);
  });

  test("returns null when the candidate is unparseable", () => {
    assert.equal(pickLastModifiedAt({ updatedUtc: "garbage" }), null);
  });
});
