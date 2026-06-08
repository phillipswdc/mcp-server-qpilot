/**
 * MCP tool registrations for processing-cycle diagnostics. Three pure-GET
 * tools that pair with `retry_scheduled_order`:
 *
 *   list_scheduled_order_processing_cycles  → cycles for one SO
 *   get_processing_cycle                    → one cycle detail
 *   get_processing_cycle_logs               → diagnostic logs for one cycle
 *
 * All three are read-only and unaudited.
 */
import { z } from "zod";
import {
  listScheduledOrderProcessingCycles,
  getProcessingCycleById,
  getProcessingCycleLogs,
} from "../qpilot/processing_cycles.js";
import { maybeCacheResponse } from "../qpilot/_cache.js";
import { jsonText, errorText, statusOf, normalizeListResponse } from "./_shared.js";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerProcessingCycleTools(server) {
  server.tool(
    "list_scheduled_order_processing_cycles",
    "List QPilot processing cycles for one scheduled order via GET /ScheduledOrders/{id}/ProcessingCycles. Each cycle represents one attempt by QPilot's pipeline to process the order (fulfillment + payment-gateway call). Use this to investigate a Failed order before calling `retry_scheduled_order`. Status enum: Processing, Success, Failed, Retry, Void. Pass cache:true to stash the result-set for filtering via query_cache. NOTE: QPilot's docs do not specify the per-cycle response shape — first runs will discover it empirically.",
    {
      id: z.string().describe("Scheduled order id."),
      status: z
        .enum(["Processing", "Success", "Failed", "Retry", "Void"])
        .optional()
        .describe("Filter to a single cycle status. Omit for all."),
      order_by: z
        .string()
        .optional()
        .describe("Field to sort by. QPilot default is 'StartDateUtc'."),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. QPilot default is 'desc' (newest first)."),
      page: z.number().int().min(1).optional().default(1),
      page_size: z.number().int().min(1).max(200).optional().default(25),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full result-set locally for follow-up filtering."),
    },
    async ({ id, status, order_by, order, page, page_size, cache }) => {
      try {
        const raw = await listScheduledOrderProcessingCycles({
          id,
          status,
          orderBy: order_by,
          order,
          page,
          pageSize: page_size,
        });
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "list_scheduled_order_processing_cycles",
          sourceArgs: { id, status, order_by, order, page, page_size },
          objectType: "processing_cycles",
        });
        return jsonText(out, { toolName: "list_scheduled_order_processing_cycles" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_processing_cycle",
    "Fetch a single processing cycle by id via GET /ProcessingCycles/{id}. Cycle ids surface as `lastProcessingCycleId` on a scheduled order and in each row returned by `list_scheduled_order_processing_cycles`. NOTE: QPilot's docs do not specify the response shape — first runs will discover it empirically.",
    {
      cycle_id: z.string().describe("Processing cycle id (int64 as string)."),
    },
    async ({ cycle_id }) => {
      try {
        return jsonText(await getProcessingCycleById(cycle_id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_processing_cycle_logs",
    "Fetch QPilot's diagnostic processing logs for one cycle via GET /ProcessingCycles/{id}/ProcessingLogs. This is the raw record of what QPilot's pipeline did and why — the canonical place to look when a cycle ended in Failed status. NOTE: QPilot's docs do not specify the response shape; expect either a list of log entries or a free-form blob until first runs confirm.",
    {
      cycle_id: z.string().describe("Processing cycle id (int64 as string)."),
    },
    async ({ cycle_id }) => {
      try {
        return jsonText(await getProcessingCycleLogs(cycle_id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
