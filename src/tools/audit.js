/**
 * MCP tool registrations for environment introspection, audit-log queries,
 * rollback, and audit-log pruning.
 *
 * These tools never call QPilot directly — they read/write only the local
 * SQLite audit log, except `rollback_change` which dispatches into the
 * registry of rollback handlers populated by mutation modules.
 */
import { z } from "zod";
import { qpilot } from "../qpilot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { SUPPORTED_OBJECT_TYPES } from "../config/constants.js";

/**
 * Register environment + audit MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerAuditTools(server) {
  server.tool(
    "get_environment",
    "Report the active QPilot site, base URL, and the local audit-database path. Use this whenever you're about to mutate data, to confirm which site you'd be writing to.",
    {},
    async () => {
      try {
        return jsonText(qpilot.environment());
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_recent_changes",
    "List recent rows from the audit log (most recent first). Lightweight summary — call get_change_detail for full old/new values. Filters can scope to a single object_type, a specific object_id, or hide rolled-back / failed rows.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .optional()
        .describe("Filter to a single QPilot object type."),
      object_id: z
        .string()
        .optional()
        .describe("Filter to a single object's audit history (QPilot internal ID)."),
      only_unrolled: z
        .boolean()
        .optional()
        .describe("If true, exclude rows that have already been rolled back."),
      only_successful: z
        .boolean()
        .optional()
        .describe("If true, exclude rows where the underlying API call failed."),
      session_id: z
        .string()
        .optional()
        .describe(
          "Filter to a single server-process session. Use the session_id returned by get_environment to scope to the current session."
        ),
      current_session_only: z
        .boolean()
        .optional()
        .describe(
          "Shorthand: if true, equivalent to passing the current session's session_id."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(25)
        .describe("Max rows to return (1-200). Defaults to 25."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of rows to skip — used for pagination."),
    },
    async (filters) => {
      try {
        const effectiveFilters = { ...filters };
        if (filters.current_session_only) {
          effectiveFilters.session_id = qpilot.environment().session_id;
        }
        delete effectiveFilters.current_session_only;
        const rows = qpilot.listRecentChanges(effectiveFilters);
        return jsonText({ count: rows.length, rows });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_change_detail",
    "Fetch the full detail of a single audit_log row, including parsed old_values, new_values, changed_fields, and the original tool args.",
    {
      audit_id: z
        .number()
        .int()
        .min(1)
        .describe("Audit row id (returned as `audit_id` from any mutation tool)."),
    },
    async ({ audit_id }) => {
      try {
        const row = qpilot.getChangeDetail(audit_id);
        if (!row) return plainText(`No audit row found with id: ${audit_id}`);
        return jsonText(row);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "rollback_change",
    "Reverse a previously-recorded mutation. Dispatches into the rollback handler registered for the original mutation's (object_type, operation). Refuses already-rolled-back rows, failed mutations, or rows from a different site than the current one. Mutation modules opt in by calling registerRollbackHandler.",
    {
      audit_id: z
        .number()
        .int()
        .min(1)
        .describe("ID of the audit_log row to reverse."),
      force: z
        .boolean()
        .optional()
        .describe(
          "Override drift detection (when the registered handler implements one)."
        ),
    },
    async ({ audit_id, force }) => {
      try {
        const out = await qpilot.rollbackChange(audit_id, {
          force: force === true,
        });
        return jsonText(out);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "prune_audit_log",
    "Permanently delete audit_log rows. Composable filters — by age, by specific session, or 'all sessions except current' — and at least one filter is required.",
    {
      older_than_days: z
        .number()
        .min(1)
        .optional()
        .describe(
          "Delete audit rows whose timestamp is older than this many days."
        ),
      session_id: z
        .string()
        .optional()
        .describe(
          "Delete only rows from this specific session. Mutually exclusive with except_current_session."
        ),
      except_current_session: z
        .boolean()
        .optional()
        .describe(
          "Shorthand: if true, delete all rows EXCEPT the current session's."
        ),
      confirm: z
        .literal(true)
        .describe(
          "Must be `true` to actually delete. Final safety check on top of the client's tool approval."
        ),
    },
    async ({ older_than_days, session_id, except_current_session, confirm }) => {
      try {
        if (confirm !== true) {
          return errorText(
            new Error("prune_audit_log requires `confirm: true` to actually delete rows"),
            "confirm-required"
          );
        }
        const except_session_id = except_current_session
          ? qpilot.environment().session_id
          : undefined;
        return jsonText(
          qpilot.pruneAuditLog({
            olderThanDays: older_than_days,
            session_id,
            except_session_id,
          })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
