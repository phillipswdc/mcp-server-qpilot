/**
 * Focused tests for the small helpers added to src/tools/scheduled_orders.js
 * as part of the sync_all_scheduled_orders bug-fix pass. Handler-level
 * repros for the four bugs (resume loses filters; missing checkpoint
 * reports complete; error metadata stripped; page-cap collapses finished)
 * are exercised externally via the reviewer's mocked-HTTP suite — those
 * can be upstreamed when needed. This file keeps the module-local helper
 * honest.
 */
import "../_helpers/test-env.js";
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";

import { sameFilterValue } from "../../src/tools/scheduled_orders.js";

describe("sameFilterValue (resume-filter equality)", () => {
  test("scalars: strict equal", () => {
    assert.ok(sameFilterValue("abc", "abc"));
    assert.ok(sameFilterValue(100, 100));
    assert.ok(!sameFilterValue("abc", "def"));
  });

  test("scalars: coerces string/number so stored-as-string filters match caller-as-number", () => {
    // Stored args come back via JSON.parse on source_args; numbers survive
    // as numbers, strings as strings. If a caller re-passes "100" for
    // page_size and the stored value was 100, these should still match.
    assert.ok(sameFilterValue("100", 100));
    assert.ok(sameFilterValue(100, "100"));
  });

  test("nulls and undefined are treated as equivalent to each other", () => {
    assert.ok(sameFilterValue(null, null));
    assert.ok(sameFilterValue(undefined, undefined));
    assert.ok(sameFilterValue(null, undefined));
  });

  test("arrays: order-insensitive member match (statuses semantics)", () => {
    assert.ok(sameFilterValue(["Active", "Paused"], ["Paused", "Active"]));
    assert.ok(sameFilterValue(["Active"], ["Active"]));
  });

  test("arrays: length mismatch is not equal", () => {
    assert.ok(!sameFilterValue(["Active"], ["Active", "Paused"]));
    assert.ok(!sameFilterValue([], ["Active"]));
  });

  test("arrays: different members are not equal", () => {
    assert.ok(!sameFilterValue(["Active"], ["Paused"]));
  });

  test("array vs scalar is not equal", () => {
    assert.ok(!sameFilterValue(["Active"], "Active"));
  });
});
