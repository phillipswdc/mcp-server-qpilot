/**
 * Pure-helper tests for src/qpilot/scheduled_orders/helpers.js.
 * No env, no DB — these functions take inputs and return outputs.
 */
import "../../_helpers/test-env.js";
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";

import {
  coerceEndOfDay,
  matchTimestampPrecision,
  mergeForPut,
  PUT_STRIP_KEYS,
} from "../../../src/qpilot/scheduled_orders/helpers.js";

describe("coerceEndOfDay", () => {
  test("expands a bare YYYY-MM-DD to end-of-day UTC", () => {
    assert.equal(coerceEndOfDay("2026-05-05"), "2026-05-05T23:59:59.999Z");
  });

  test("leaves an ISO datetime string unchanged", () => {
    const v = "2026-05-05T12:00:00Z";
    assert.equal(coerceEndOfDay(v), v);
  });

  test("leaves a fractional-second datetime unchanged", () => {
    const v = "2026-05-05T12:00:00.123Z";
    assert.equal(coerceEndOfDay(v), v);
  });

  test("passes through non-strings unchanged", () => {
    assert.equal(coerceEndOfDay(undefined), undefined);
    assert.equal(coerceEndOfDay(null), null);
    assert.deepEqual(coerceEndOfDay(123), 123);
  });

  test("does not coerce an almost-but-not-quite date", () => {
    // Trailing junk should not match the bare-date pattern.
    assert.equal(coerceEndOfDay("2026-05-05X"), "2026-05-05X");
    // Year missing leading digits also should not match.
    assert.equal(coerceEndOfDay("226-05-05"), "226-05-05");
  });
});

describe("matchTimestampPrecision", () => {
  test("returns millisecond-precision ISO when existing has millis", () => {
    const out = matchTimestampPrecision(
      "2030-01-01T00:00:00Z",
      "2026-05-05T12:34:56.789Z"
    );
    assert.equal(out, "2030-01-01T00:00:00.000Z");
  });

  test("strips fractional seconds when existing has none", () => {
    const out = matchTimestampPrecision(
      "2030-01-01T00:00:00.123Z",
      "2026-05-05T12:34:56Z"
    );
    assert.equal(out, "2030-01-01T00:00:00Z");
  });

  test("pads to existing precision when existing has more digits than millis", () => {
    const out = matchTimestampPrecision(
      "2030-01-01T00:00:00.5Z",
      "2026-05-05T12:34:56.123456Z"
    );
    // toISOString gives .500Z, we then pad to 6 digits.
    assert.equal(out, "2030-01-01T00:00:00.500000Z");
  });

  test("truncates when existing has fewer fractional digits than parsed millis", () => {
    const out = matchTimestampPrecision(
      "2030-01-01T00:00:00.567Z",
      "2026-05-05T12:34:56.12Z"
    );
    assert.equal(out, "2030-01-01T00:00:00.56Z");
  });

  test("falls back to millisecond precision when existing is unparseable", () => {
    const out = matchTimestampPrecision("2030-01-01T00:00:00Z", "garbage");
    assert.equal(out, "2030-01-01T00:00:00.000Z");
  });

  test("falls back to millisecond precision when existing is null/undefined", () => {
    assert.equal(
      matchTimestampPrecision("2030-01-01T00:00:00Z", null),
      "2030-01-01T00:00:00.000Z"
    );
    assert.equal(
      matchTimestampPrecision("2030-01-01T00:00:00Z", undefined),
      "2030-01-01T00:00:00.000Z"
    );
  });

  test("returns input unchanged when input is unparseable", () => {
    assert.equal(matchTimestampPrecision("not-a-date", "2026-05-05T12:34:56.789Z"), "not-a-date");
  });
});

describe("PUT_STRIP_KEYS", () => {
  test("is a non-empty Set", () => {
    assert.ok(PUT_STRIP_KEYS instanceof Set);
    assert.ok(PUT_STRIP_KEYS.size > 0);
  });

  test("includes the documented embedded relations", () => {
    for (const k of ["customer", "site", "scheduledOrderItems", "lastProcessingCycle"]) {
      assert.ok(PUT_STRIP_KEYS.has(k), `expected PUT_STRIP_KEYS to include ${k}`);
    }
  });

  test("includes server-computed scalars", () => {
    for (const k of ["createdUtc", "updatedUtc", "lifetimeValue", "total", "stripeUrl"]) {
      assert.ok(PUT_STRIP_KEYS.has(k), `expected PUT_STRIP_KEYS to include ${k}`);
    }
  });
});

describe("mergeForPut", () => {
  test("overlays properties on existing", () => {
    const out = mergeForPut(
      { frequency: 7, frequencyType: "Days", customerId: 42 },
      { frequency: 14 }
    );
    assert.equal(out.frequency, 14);
    assert.equal(out.frequencyType, "Days");
    assert.equal(out.customerId, 42);
  });

  test("strips every PUT_STRIP_KEYS member from the merged body", () => {
    const out = mergeForPut(
      {
        id: 1,
        customer: { id: 7 },
        site: { id: 1113 },
        scheduledOrderItems: [],
        updatedUtc: "2026-05-05T12:34:56.789Z",
        createdUtc: "2026-01-01T00:00:00Z",
        lifetimeValue: 999,
        frequency: 7,
      },
      { frequency: 14 }
    );
    for (const k of PUT_STRIP_KEYS) {
      assert.ok(!(k in out), `expected stripped key ${k} to be absent`);
    }
    // Caller intent and non-stripped scalars survive.
    assert.equal(out.frequency, 14);
    assert.equal(out.id, 1);
  });

  test("does not mutate either argument", () => {
    const existing = { frequency: 7, customer: { id: 7 } };
    const properties = { frequency: 14 };
    const existingSnapshot = JSON.stringify(existing);
    const propertiesSnapshot = JSON.stringify(properties);
    mergeForPut(existing, properties);
    assert.equal(JSON.stringify(existing), existingSnapshot);
    assert.equal(JSON.stringify(properties), propertiesSnapshot);
  });
});
