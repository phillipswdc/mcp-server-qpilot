/**
 * Tests for the processing-failure-code catalog and the response annotator.
 * No DB or HTTP involvement — pure functions.
 */
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";

import {
  PROCESSING_FAILURE_CODES,
  lookupProcessingFailureCode,
  annotateProcessingErrorCode,
} from "../../src/qpilot/processing_failure_codes.js";

describe("PROCESSING_FAILURE_CODES catalog", () => {
  test("contains all 11 known codes", () => {
    const expected = [99, 1000, 1001, 1002, 1003, 1004, 2000, 2001, 3000, 3001, 3002];
    const actual = Object.keys(PROCESSING_FAILURE_CODES).map(Number).sort((a, b) => a - b);
    assert.deepEqual(actual, expected);
  });

  test("each entry has code, name, meaning", () => {
    for (const entry of Object.values(PROCESSING_FAILURE_CODES)) {
      assert.equal(typeof entry.code, "number");
      assert.equal(typeof entry.name, "string");
      assert.ok(entry.name.length > 0);
      assert.equal(typeof entry.meaning, "string");
      assert.ok(entry.meaning.length > 0);
    }
  });

  test("entry keys match entry.code", () => {
    for (const [key, entry] of Object.entries(PROCESSING_FAILURE_CODES)) {
      assert.equal(Number(key), entry.code);
    }
  });
});

describe("lookupProcessingFailureCode", () => {
  test("resolves a known numeric code", () => {
    const entry = lookupProcessingFailureCode(2000);
    assert.equal(entry.name, "PaymentFailed");
  });

  test("resolves a numeric string", () => {
    const entry = lookupProcessingFailureCode("2000");
    assert.equal(entry.name, "PaymentFailed");
  });

  test("returns null for null", () => {
    assert.equal(lookupProcessingFailureCode(null), null);
  });

  test("returns null for undefined", () => {
    assert.equal(lookupProcessingFailureCode(undefined), null);
  });

  test("returns null for unknown code", () => {
    assert.equal(lookupProcessingFailureCode(9999), null);
  });

  test("returns null for non-numeric string", () => {
    assert.equal(lookupProcessingFailureCode("not-a-code"), null);
  });
});

describe("annotateProcessingErrorCode", () => {
  test("annotates a top-level processingErrorCode", () => {
    const out = annotateProcessingErrorCode({
      id: 1,
      status: "Failed",
      processingErrorCode: 2000,
    });
    assert.equal(out.processingErrorCode, 2000);
    assert.equal(out.processingErrorCodeName, "PaymentFailed");
    assert.match(out.processingErrorCodeMeaning, /did not process/);
  });

  test("does not annotate when processingErrorCode is null", () => {
    const out = annotateProcessingErrorCode({
      id: 1,
      processingErrorCode: null,
    });
    assert.equal(out.processingErrorCodeName, undefined);
    assert.equal(out.processingErrorCodeMeaning, undefined);
  });

  test("does not annotate when the code is unknown", () => {
    const out = annotateProcessingErrorCode({
      id: 1,
      processingErrorCode: 8675309,
    });
    assert.equal(out.processingErrorCode, 8675309);
    assert.equal(out.processingErrorCodeName, undefined);
  });

  test("recurses into nested objects (e.g. lastProcessingCycle)", () => {
    const out = annotateProcessingErrorCode({
      id: 1,
      lastProcessingCycle: {
        id: 99,
        processingErrorCode: 1004,
      },
    });
    assert.equal(out.lastProcessingCycle.processingErrorCodeName, "PaymentMethodNull");
  });

  test("walks arrays (e.g. list responses)", () => {
    const out = annotateProcessingErrorCode({
      results: [
        { id: 1, processingErrorCode: 2000 },
        { id: 2, processingErrorCode: 1001 },
        { id: 3, processingErrorCode: null },
      ],
      total: 3,
    });
    assert.equal(out.results[0].processingErrorCodeName, "PaymentFailed");
    assert.equal(out.results[1].processingErrorCodeName, "NoItemsToShip");
    assert.equal(out.results[2].processingErrorCodeName, undefined);
  });

  test("returns primitives unchanged", () => {
    assert.equal(annotateProcessingErrorCode(null), null);
    assert.equal(annotateProcessingErrorCode(undefined), undefined);
    assert.equal(annotateProcessingErrorCode("string"), "string");
    assert.equal(annotateProcessingErrorCode(42), 42);
  });

  test("does not mutate the input", () => {
    const input = {
      id: 1,
      processingErrorCode: 2000,
      nested: { processingErrorCode: 1001 },
    };
    const snapshot = JSON.stringify(input);
    annotateProcessingErrorCode(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  test("preserves unrelated fields", () => {
    const out = annotateProcessingErrorCode({
      id: 1,
      status: "Failed",
      customer: { id: 99, name: "Test" },
      lifetimeValue: 1000.5,
      processingErrorCode: 2000,
    });
    assert.equal(out.id, 1);
    assert.equal(out.status, "Failed");
    assert.deepEqual(out.customer, { id: 99, name: "Test" });
    assert.equal(out.lifetimeValue, 1000.5);
  });
});
