/**
 * Tests for assertNoDrift — the precondition guard that rollback handlers
 * use to refuse rolling back when something else has touched the entity
 * since the original mutation.
 *
 * assertNoDrift is exported from rollback.js for testability. The function
 * has no side effects beyond throwing.
 */
import "../../_helpers/test-env.js";
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";

import { assertNoDrift } from "../../../src/qpilot/scheduled_orders/rollback.js";

const T_RECORDED = Date.parse("2026-05-05T12:00:00.000Z");
const T_LATER = Date.parse("2026-05-05T12:00:05.000Z");

describe("assertNoDrift — no-drift case", () => {
  test("returns silently when no tracked field has changed", async () => {
    await assertNoDrift({
      original: {
        id: 1,
        last_modified_at: T_RECORDED,
        new_values: { status: "Active" },
      },
      options: {},
      keys: ["status"],
      fetchCurrent: async () => ({
        status: "Active",
        updatedUtc: new Date(T_RECORDED).toISOString(),
      }),
    });
  });

  test("returns silently when last_modified_at is missing (older audit row)", async () => {
    // Old audits pre-dating the updatedUtc capture won't have last_modified_at.
    // Drift check should still pass on field-level comparison when fields match.
    await assertNoDrift({
      original: {
        id: 1,
        last_modified_at: null,
        new_values: { status: "Active" },
      },
      options: {},
      keys: ["status"],
      fetchCurrent: async () => ({ status: "Active" }),
    });
  });
});

describe("assertNoDrift — timestamp drift", () => {
  test("throws when updatedUtc has advanced past the recorded value", async () => {
    await assert.rejects(
      assertNoDrift({
        original: {
          id: 1,
          last_modified_at: T_RECORDED,
          new_values: { status: "Active" },
        },
        options: {},
        keys: ["status"],
        fetchCurrent: async () => ({
          status: "Active",
          updatedUtc: new Date(T_LATER).toISOString(),
        }),
      }),
      /Drift detected on audit_id 1.*updatedUtc has advanced/s
    );
  });

  test("error message names the audit_id, recorded ISO, and current ISO", async () => {
    let err;
    try {
      await assertNoDrift({
        original: {
          id: 99,
          last_modified_at: T_RECORDED,
          new_values: {},
        },
        options: {},
        keys: [],
        fetchCurrent: async () => ({
          updatedUtc: new Date(T_LATER).toISOString(),
        }),
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /audit_id 99/);
    assert.match(err.message, /2026-05-05T12:00:00\.000Z.*recorded/);
    assert.match(err.message, /2026-05-05T12:00:05\.000Z.*live/);
    assert.match(err.message, /force: true/);
  });
});

describe("assertNoDrift — field-level drift", () => {
  test("throws when a tracked field has diverged from new_values", async () => {
    await assert.rejects(
      assertNoDrift({
        original: {
          id: 1,
          last_modified_at: null,
          new_values: { status: "Active" },
        },
        options: {},
        keys: ["status"],
        fetchCurrent: async () => ({ status: "Paused" }),
      }),
      /Drift detected on audit_id 1.*status.*expected "Active".*current "Paused"/s
    );
  });

  test("ignores fields not listed in keys (scoped check)", async () => {
    // frequency drifted but we're not tracking it on this rollback.
    await assertNoDrift({
      original: {
        id: 1,
        last_modified_at: null,
        new_values: { status: "Active", frequency: 7 },
      },
      options: {},
      keys: ["status"],
      fetchCurrent: async () => ({ status: "Active", frequency: 99 }),
    });
  });

  test("reports every drifted field in one error", async () => {
    let err;
    try {
      await assertNoDrift({
        original: {
          id: 1,
          last_modified_at: null,
          new_values: { status: "Active", frequency: 7 },
        },
        options: {},
        keys: ["status", "frequency"],
        fetchCurrent: async () => ({ status: "Paused", frequency: 99 }),
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /status.*expected "Active".*current "Paused"/);
    assert.match(err.message, /frequency.*expected 7.*current 99/);
  });
});

describe("assertNoDrift — force option", () => {
  test("force: true skips the check entirely (even with timestamp drift)", async () => {
    await assertNoDrift({
      original: {
        id: 1,
        last_modified_at: T_RECORDED,
        new_values: { status: "Active" },
      },
      options: { force: true },
      keys: ["status"],
      fetchCurrent: async () => ({
        status: "Paused",
        updatedUtc: new Date(T_LATER).toISOString(),
      }),
    });
  });

  test("force: true does not call fetchCurrent", async () => {
    let fetched = false;
    await assertNoDrift({
      original: { id: 1, last_modified_at: null, new_values: {} },
      options: { force: true },
      keys: [],
      fetchCurrent: async () => {
        fetched = true;
        return {};
      },
    });
    assert.equal(fetched, false);
  });
});
