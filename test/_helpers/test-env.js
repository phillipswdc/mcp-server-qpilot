/**
 * Shared test bootstrap. Importing this module sets the QPILOT_* env vars
 * to test values BEFORE anything else loads `../config/env.js` (which
 * throws on missing required vars at import time).
 *
 * Tests that touch the SQLite layer should call `resetTestDb()` in a
 * `beforeEach` hook so each test starts from an empty audit_log /
 * result_cache state. The DB file lives at
 * `data/qpilot-site-test.db` and is wiped between tests, not between
 * runs — that's intentional: keeping the file lets tests share schema
 * application cost and lets a failed run leave the file behind for
 * post-mortem inspection.
 *
 * Importing this file does NOT touch the database. Tests opt in by
 * importing the db singleton and calling `resetTestDb`.
 */

// Set required QPilot env vars to deterministic test values BEFORE the
// real env.js validator runs. dotenv is not loaded in tests — we don't
// want a missing or wrong real .env to leak into the test suite.
process.env.QPILOT_BASE_URL = "https://qpilot.test";
process.env.QPILOT_SITE_ID = "test";
process.env.QPILOT_AUTH_TOKEN = "test-token-not-real";

/**
 * Clear all rows from audit_log and result_cache so each test starts
 * clean. Call from a `beforeEach` hook in suites that touch the DB.
 *
 * @returns {Promise<void>}
 */
export async function resetTestDb() {
  const { db } = await import("../../src/db/index.js");
  db.exec("DELETE FROM audit_log; DELETE FROM result_cache;");
}
