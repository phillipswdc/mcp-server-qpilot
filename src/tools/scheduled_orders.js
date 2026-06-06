/**
 * MCP tool registrations for Scheduled Orders.
 *
 * Reads do not require audit; mutations route through the audited helpers
 * in src/qpilot/scheduled_orders.js. The DELETE tool is intentionally
 * non-audited (per project rule — QPilot soft-deletes scheduled orders).
 */
import { z } from "zod";
import {
  getScheduledOrderById,
  searchScheduledOrders,
  getScheduledOrdersHistory,
  updateScheduledOrder,
  changeScheduledOrderStatus,
  snoozeScheduledOrder,
  deleteScheduledOrder,
} from "../qpilot/scheduled_orders.js";
import { maybeCacheResponse } from "../qpilot/_cache.js";
import { jsonText, errorText, statusOf, normalizeListResponse } from "./_shared.js";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerScheduledOrderTools(server) {
  server.tool(
    "get_scheduled_order",
    "Fetch a single scheduled order by id from QPilot.",
    {
      id: z.string().describe("Scheduled order id."),
    },
    async ({ id }) => {
      try {
        return jsonText(await getScheduledOrderById(id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "search_scheduled_orders",
    "Search scheduled orders using QPilot's lightweight v3 endpoint. Returns a trimmed payload — call get_scheduled_order for full detail. NOTE: QPilot has no dedicated customer_id filter — pass the customer id through `search`, or call get_customer / its scheduled-orders relations directly. Pass cache:true for bulk exploration: results are stored locally and only a small handle + sample come back.",
    {
      page: z.number().int().min(1).optional().default(1),
      page_size: z.number().int().min(1).max(200).optional().default(25),
      statuses: z
        .array(z.string())
        .optional()
        .describe("One or more status values (e.g. ['Active'] or ['Paused','Failed']). Multiple values combine with OR."),
      search: z
        .string()
        .optional()
        .describe("Free-text search across QPilot's default searchable fields."),
      order_by: z
        .string()
        .optional()
        .describe("Field to sort by. QPilot default is 'NextOccurrenceUtc'."),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. QPilot default is 'asc'."),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full result-set in result_cache and return a handle + sample. Use query_cache to drill in."),
    },
    async ({ page, page_size, statuses, search, order_by, order, cache }) => {
      try {
        const raw = await searchScheduledOrders({
          page,
          pageSize: page_size,
          statusNames: statuses,
          search,
          orderBy: order_by,
          order,
        });
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "search_scheduled_orders",
          sourceArgs: { page, page_size, statuses, search, order_by, order },
          objectType: "scheduled_orders",
        });
        return jsonText(out, { toolName: "search_scheduled_orders" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_scheduled_order_history",
    "Fetch QPilot's built-in change history for scheduled orders — distinct from list_recent_changes (which returns only what THIS server logged locally). NOTE: QPilot only supports date-range / pagination / sort filters here; there is no server-side filter for a single scheduled order id. To get one order's history, call with a date range plus cache:true, then query_cache with filter scheduledOrderId EQ <id>.",
    {
      start_date: z
        .string()
        .optional()
        .describe("ISO date — inclusive lower bound."),
      end_date: z
        .string()
        .optional()
        .describe("ISO date — inclusive upper bound."),
      page: z.number().int().min(1).optional().default(1),
      page_size: z.number().int().min(1).max(200).optional().default(25),
      order_by: z
        .string()
        .optional()
        .describe("Field to sort by. Defaults to 'Id' on the QPilot side."),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. Defaults to 'desc' on the QPilot side."),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full history result-set in result_cache and return a handle + sample."),
    },
    async ({ start_date, end_date, page, page_size, order_by, order, cache }) => {
      try {
        const raw = await getScheduledOrdersHistory({
          startDate: start_date,
          endDate: end_date,
          page,
          pageSize: page_size,
          orderBy: order_by,
          order,
        });
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "get_scheduled_order_history",
          sourceArgs: { start_date, end_date, page, page_size, order_by, order },
          objectType: "scheduled_orders_history",
        });
        return jsonText(out, { toolName: "get_scheduled_order_history" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "update_scheduled_order",
    "Update fields on a scheduled order. Pass only the keys you want changed in `properties` — the tool fetches the current order, merges your overrides on top, strips nested/computed fields, and PUTs the full entity (QPilot's PUT validates the whole body per RFC 2616). Captures pre/post state in the local audit log scoped to the keys you passed; rollback via rollback_change. NOT for status changes (use change_scheduled_order_status — generic PUT rejects status) or deletes (use delete_scheduled_order).",
    {
      id: z.string().describe("Scheduled order id."),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Fields to update. Pass ONLY the keys you want changed (e.g. {nextOccurrenceUtc, frequency, note}). The tool handles merging with current state — do not echo back the full GET response."),
    },
    async ({ id, properties }) => {
      try {
        const out = await updateScheduledOrder({ id, properties });
        return jsonText({
          audit_id: out.audit_id,
          changed_fields: out.changed_fields,
          result: out.result,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "change_scheduled_order_status",
    "Change a scheduled order's status. QPilot accepts ONLY 'Active' or 'Paused' on this endpoint — Failed/Completed/Deleted are derived states owned by QPilot's processing pipeline and will 400 (code 1001). Use delete_scheduled_order to soft-delete (transition to Deleted). Audited and rollback-capable — rollback restores the prior status.",
    {
      id: z.string().describe("Scheduled order id."),
      status: z
        .enum(["Active", "Paused"])
        .describe("'Active' or 'Paused' only. To delete, use delete_scheduled_order."),
    },
    async ({ id, status }) => {
      try {
        const out = await changeScheduledOrderStatus({ id, status });
        return jsonText({
          audit_id: out.audit_id,
          changed_fields: out.changed_fields,
          result: out.result,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "snooze_scheduled_order",
    "Snooze a scheduled order until a future UTC date. QPilot auto-reactivates the order when the snooze period expires. CONSTRAINTS (QPilot will 400 otherwise): snooze_until_utc must be in the future; the order status must be Active or Paused; the order must not be in its lock window. snooze_duration and snooze_duration_type are optional supplemental metadata pairing a numeric value with a unit token (commonly 'Day','Week','Month'); they do not replace snooze_until_utc. Audited and rollback-capable — rollback restores the prior snooze fields via the generic PUT path.",
    {
      id: z.string().describe("Scheduled order id."),
      snooze_until_utc: z
        .string()
        .describe("ISO UTC date-time, must be in the future. Example: '2026-07-01T00:00:00Z'."),
      snooze_duration: z
        .number()
        .int()
        .optional()
        .describe("Optional numeric duration; pairs with snooze_duration_type. Does NOT replace snooze_until_utc."),
      snooze_duration_type: z
        .string()
        .optional()
        .describe("Optional duration unit token (commonly 'Day', 'Week', 'Month'). Pairs with snooze_duration."),
    },
    async ({ id, snooze_until_utc, snooze_duration, snooze_duration_type }) => {
      try {
        const out = await snoozeScheduledOrder({
          id,
          snoozeUntilUtc: snooze_until_utc,
          snoozeDuration: snooze_duration,
          snoozeDurationType: snooze_duration_type,
        });
        return jsonText({
          audit_id: out.audit_id,
          changed_fields: out.changed_fields,
          result: out.result,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "delete_scheduled_order",
    "Delete a scheduled order. NOTE: QPilot soft-deletes — the order is recoverable from QPilot itself. This call is NOT recorded in the local audit log and CANNOT be rolled back via rollback_change.",
    {
      id: z.string().describe("Scheduled order id."),
      confirm: z
        .literal(true)
        .describe("Must be `true` to actually delete. Final safety check on top of client-side approval."),
    },
    async ({ id, confirm }) => {
      try {
        if (confirm !== true) {
          return errorText(
            new Error("delete_scheduled_order requires `confirm: true`"),
            "confirm-required"
          );
        }
        const result = await deleteScheduledOrder(id);
        return jsonText({ deleted: true, id, result });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
