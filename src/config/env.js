/**
 * Environment resolution. Reads QPILOT_BASE_URL, QPILOT_SITE_ID, and
 * QPILOT_AUTH_TOKEN from process.env (loaded from .env in src/index.js
 * before this module runs).
 *
 * No defaults. The server hard-fails on startup if any required value is
 * missing, so misconfiguration surfaces immediately rather than as a
 * confusing 401 on the first API call.
 *
 * Also generates a session_id (UUID) at startup — one per process — used to
 * tag audit_log rows so users can scope queries and pruning to "what this
 * server instance did" rather than the entire history.
 */
import { randomUUID } from "node:crypto";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Set it in .env.`);
  }
  return value;
}

const baseUrl = required("QPILOT_BASE_URL").replace(/\/+$/, "");
const siteId = required("QPILOT_SITE_ID");
const authToken = required("QPILOT_AUTH_TOKEN");

/** Active QPilot environment for this process. Frozen at startup. */
export const env = Object.freeze({
  baseUrl,
  siteId,
  authToken,
  /**
   * Audit-log scope label. Site id is the analogue of HubSpot's
   * sandbox/production split — switching sites uses a different DB file,
   * so audit history doesn't bleed across tenants.
   */
  scope: `site-${siteId}`,
  /**
   * UUID generated once per server process. Stamped onto every audit_log row
   * so downstream queries (and pruning) can scope to "this session's work."
   * Persists across MCP tool calls within the same Claude Desktop launch.
   */
  sessionId: randomUUID(),
  /** Unix-ms when this process booted; useful for session-relative timing. */
  startedAt: Date.now(),
});

export const authHeader = `Basic ${authToken}`;
