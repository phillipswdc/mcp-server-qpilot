/**
 * MCP tool registrations for the result cache: dereference, query, summarize,
 * list active caches, and manually expire.
 *
 * These tools never call QPilot — they read/write only the local SQLite
 * `result_cache` table.
 */
import { z } from "zod";
import { qpilot } from "../qpilot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";

const FILTER_OPERATORS = [
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "HAS",
  "NOT_HAS",
  "CONTAINS",
  "NOT_CONTAINS",
];

const filterSchema = z.object({
  field: z.string().describe("Top-level field name on each cached item."),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  highValue: z.union([z.string(), z.number()]).optional(),
  values: z.array(z.union([z.string(), z.number()])).optional(),
});

const sortSchema = z.object({
  field: z.string(),
  direction: z.enum(["ASC", "DESC"]).optional(),
});

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerCacheTools(server) {
  server.tool(
    "get_cached_value",
    "Retrieve the full payload of a cached result. Returns `{cache_type, payload}` only — no metadata envelope (use cache_summary for metadata). Bypasses this server's response-size guard, so retrieving large payloads won't re-cache themselves. NOTE: even though the server returns the full payload, the MCP host may still struggle with very large tool responses. PREFER `query_cache` with a `limit` for any result_set cache where byte_length is large, and reserve `get_cached_value` for small caches or post-mortem retrieval.",
    {
      cache_id: z.string().describe("Cache id from a prior tool response."),
    },
    async ({ cache_id }) => {
      try {
        const row = qpilot.getCachedValue(cache_id);
        if (!row) return plainText(`No cache row found (or expired) for: ${cache_id}`);
        // Strip metadata envelope — caller wants the data, not bookkeeping.
        // skipOverflow:true prevents the recursive cache-an-overflow-of-an-overflow loop.
        return jsonText(
          { cache_type: row.cache_type, payload: row.payload },
          { toolName: "get_cached_value", skipOverflow: true }
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "query_cache",
    "Filter, sort, and paginate a cached result_set without re-querying QPilot. Filters operate on top-level fields of each cached item.",
    {
      cache_id: z.string().describe("Cache id of a result_set."),
      filters: z
        .array(filterSchema)
        .optional()
        .describe("AND-combined filters on top-level fields."),
      sorts: z.array(sortSchema).optional(),
      fields: z
        .array(z.string())
        .optional()
        .describe("Project to these fields per result. Omit to return whole items."),
      limit: z.number().int().min(1).max(200).optional().default(10),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ cache_id, filters, sorts, fields, limit, offset }) => {
      try {
        return jsonText(
          qpilot.queryCache(cache_id, { filters, sorts, fields, limit, offset }),
          { toolName: "query_cache" }
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "cache_summary",
    "Summarize a cached result_set: count, byte size, and field frequency across items. Use to discover what's queryable before calling query_cache.",
    {
      cache_id: z.string(),
    },
    async ({ cache_id }) => {
      try {
        return jsonText(qpilot.cacheSummary(cache_id), {
          toolName: "cache_summary",
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_caches",
    "List active (non-expired) cache rows.",
    {
      cache_type: z
        .enum(["result_set", "response_overflow"])
        .optional()
        .describe("Filter by cache shape."),
      current_session_only: z
        .boolean()
        .optional()
        .describe("If true, only show caches written by this server-process session."),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async ({ cache_type, current_session_only, limit }) => {
      try {
        const filters = { cache_type, limit };
        if (current_session_only) {
          filters.session_id = qpilot.environment().session_id;
        }
        const rows = qpilot.listCaches(filters);
        return jsonText({ count: rows.length, rows }, { toolName: "list_caches" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "expire_cache",
    "Manually delete a cache row before its TTL expires.",
    {
      cache_id: z.string(),
    },
    async ({ cache_id }) => {
      try {
        const removed = qpilot.expireCache(cache_id);
        return jsonText({ cache_id, removed }, { toolName: "expire_cache" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
