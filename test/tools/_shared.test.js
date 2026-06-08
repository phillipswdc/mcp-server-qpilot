/**
 * Tests for the pure surface of src/tools/_shared.js. The `jsonText` overflow
 * path writes to result_cache and is covered by audit-flow integration tests
 * that already touch the DB.
 */
import "../_helpers/test-env.js";
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";

import { normalizeListResponse, errorText, statusOf } from "../../src/tools/_shared.js";

describe("normalizeListResponse", () => {
  test("wraps a bare array into { results, total }", () => {
    const out = normalizeListResponse([{ id: 1 }, { id: 2 }]);
    assert.deepEqual(out, { results: [{ id: 1 }, { id: 2 }], total: 2 });
  });

  test("returns the empty-shape default for null/undefined/non-object", () => {
    assert.deepEqual(normalizeListResponse(null), { results: [], total: 0 });
    assert.deepEqual(normalizeListResponse(undefined), { results: [], total: 0 });
    assert.deepEqual(normalizeListResponse("not-an-object"), { results: [], total: 0 });
  });

  test("picks the first non-empty candidate array when several exist", () => {
    // QPilot's v3 shape: both `results` and `items` carry the same content,
    // but sometimes one is populated and others empty.
    const out = normalizeListResponse({
      results: [],
      items: [{ id: 7 }],
      total: 1,
    });
    assert.equal(out.total, 1);
    assert.deepEqual(out.results, [{ id: 7 }]);
    // Duplicate array keys must be dropped to avoid doubling payload size.
    assert.ok(!("items" in out));
  });

  test("prefers `results` over `items` when both are populated", () => {
    const out = normalizeListResponse({
      results: [{ id: 1 }],
      items: [{ id: 99 }],
    });
    assert.deepEqual(out.results, [{ id: 1 }]);
    assert.ok(!("items" in out));
  });

  test("recognizes scheduledOrderHistoryItems (history endpoint shape)", () => {
    const out = normalizeListResponse({
      scheduledOrderHistoryItems: [{ id: 1 }, { id: 2 }],
      totalCount: 2,
    });
    assert.equal(out.total, 2);
    assert.deepEqual(out.results, [{ id: 1 }, { id: 2 }]);
    assert.ok(!("scheduledOrderHistoryItems" in out));
  });

  test("retains non-candidate scalar keys from the source response", () => {
    const out = normalizeListResponse({
      results: [{ id: 1 }],
      page: 1,
      pageSize: 25,
    });
    assert.equal(out.page, 1);
    assert.equal(out.pageSize, 25);
  });

  test("drops all total-shaped duplicate keys when total can be derived", () => {
    const out = normalizeListResponse({
      results: [{ id: 1 }],
      totalCount: 1,
      totalItems: 1,
      count: 1,
    });
    assert.equal(out.total, 1);
    assert.ok(!("totalCount" in out));
    assert.ok(!("totalItems" in out));
    assert.ok(!("count" in out));
  });

  test("falls back to length when no total field is present", () => {
    const out = normalizeListResponse({ results: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    assert.equal(out.total, 3);
  });

  test("returns empty when no candidate key holds an array", () => {
    const out = normalizeListResponse({ results: "not-an-array", page: 1 });
    assert.deepEqual(out.results, []);
    assert.equal(out.total, 0);
    assert.equal(out.page, 1);
  });
});

describe("errorText", () => {
  test("renders an Error with status as MCP error content", () => {
    const out = errorText(new Error("bad payload"), 400);
    assert.equal(out.isError, true);
    assert.equal(out.content[0].type, "text");
    assert.match(out.content[0].text, /\(400\)/);
    assert.match(out.content[0].text, /bad payload/);
  });

  test("renders 'unknown' status when none provided", () => {
    const out = errorText(new Error("boom"));
    assert.match(out.content[0].text, /\(unknown\)/);
  });

  test("renders a non-Error thrown value as a string", () => {
    const out = errorText("string-thrown", 500);
    assert.match(out.content[0].text, /string-thrown/);
  });
});

describe("statusOf", () => {
  test("picks err.status first", () => {
    assert.equal(statusOf({ status: 404 }), 404);
  });

  test("falls back to err.response.status", () => {
    assert.equal(statusOf({ response: { status: 500 } }), 500);
  });

  test("returns undefined when no status-like field is present", () => {
    assert.equal(statusOf({}), undefined);
    assert.equal(statusOf(null), undefined);
  });
});
