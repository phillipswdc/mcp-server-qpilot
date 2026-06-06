/**
 * SQLite connection owner. Opens (or creates) a per-site database file —
 * `data/qpilot-site-<id>.db` — so audit logs stay cleanly separated when the
 * server is repointed at a different QPilot site.
 *
 * All other modules import `db` from here — there is exactly one Database
 * instance per process.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applySchema } from "./schema.js";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

/** Absolute path to the active site's SQLite file. */
export const dbPath = join(dataDir, `qpilot-${env.scope}.db`);

/** Singleton SQLite handle for the active site. */
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

applySchema(db);

/** @returns {number} Current unix epoch in milliseconds. */
export function nowMs() {
  return Date.now();
}
