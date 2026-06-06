/**
 * Schema DDL. Applied idempotently on every startup via CREATE TABLE IF NOT EXISTS.
 *
 * For columns added in later phases, use addColumnIfNotExists below — SQLite
 * has no ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info first.
 */

const DDL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    scope TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('create','update','delete')),
    old_values TEXT,
    new_values TEXT,
    changed_fields TEXT,
    args TEXT,
    success INTEGER NOT NULL CHECK (success IN (0,1)),
    error TEXT,
    last_modified_at INTEGER,
    rolled_back INTEGER NOT NULL DEFAULT 0 CHECK (rolled_back IN (0,1)),
    rolled_back_at INTEGER,
    rollback_audit_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_rolled_back ON audit_log(rolled_back);
  CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_log(scope);
  CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);

  CREATE TABLE IF NOT EXISTS result_cache (
    cache_id TEXT PRIMARY KEY,
    cache_type TEXT NOT NULL CHECK (cache_type IN ('result_set','response_overflow')),
    tool_name TEXT,
    source_args TEXT,
    object_type TEXT,
    payload TEXT NOT NULL,
    result_count INTEGER,
    byte_length INTEGER,
    preview TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    scope TEXT NOT NULL,
    session_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rc_expires ON result_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_rc_session ON result_cache(session_id);
  CREATE INDEX IF NOT EXISTS idx_rc_type ON result_cache(cache_type);
  CREATE INDEX IF NOT EXISTS idx_rc_scope ON result_cache(scope);
`;

/**
 * Apply schema DDL to a database handle.
 * @param {import("better-sqlite3").Database} database
 */
export function applySchema(database) {
  database.exec(DDL);
}

/**
 * Add a column to a table if it doesn't already exist. Reads PRAGMA table_info
 * to determine current columns. Useful for in-place schema upgrades on
 * databases created before the column was introduced.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} table
 * @param {string} column
 * @param {string} typeAndConstraints e.g. "TEXT", "INTEGER NOT NULL DEFAULT 0"
 */
export function addColumnIfNotExists(db, table, column, typeAndConstraints) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndConstraints}`);
}
