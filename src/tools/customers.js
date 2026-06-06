/**
 * MCP tool registrations for Customers (read-only for now).
 */
import { z } from "zod";
import { getCustomerById, searchCustomers } from "../qpilot/customers.js";
import { maybeCacheResponse } from "../qpilot/_cache.js";
import { jsonText, errorText, statusOf, normalizeListResponse } from "./_shared.js";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerCustomerTools(server) {
  server.tool(
    "get_customer",
    "Fetch a single customer by id.",
    {
      id: z.string().describe("Customer id."),
    },
    async ({ id }) => {
      try {
        return jsonText(await getCustomerById(id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "search_customers",
    "Search customers via QPilot's customer collection endpoint. NOTE: QPilot has no dedicated email or external-id filter — pass those through `search` (free text) or as a `metadata_key`/`metadata_value` pair if the value is stored in customer metadata. Pass cache:true to stash the full result-set locally for filtering via query_cache.",
    {
      search: z
        .string()
        .optional()
        .describe("Free-text search across QPilot's default customer fields. Pass an email here to find by email."),
      metadata_key: z
        .array(z.string())
        .optional()
        .describe("Metadata field names to filter by. Parallel array with metadata_value."),
      metadata_value: z
        .array(z.string())
        .optional()
        .describe("Values to match against metadata_key. Position-aligned with metadata_key."),
      order_by: z
        .string()
        .optional()
        .describe("Field to sort by. QPilot default is 'Id'."),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. QPilot default is 'asc'."),
      page: z.number().int().min(1).optional().default(1),
      page_size: z.number().int().min(1).max(200).optional().default(25),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full result-set in result_cache and return a handle + sample."),
    },
    async ({ search, metadata_key, metadata_value, order_by, order, page, page_size, cache }) => {
      try {
        const raw = await searchCustomers({
          search,
          metadataKey: metadata_key,
          metadataValue: metadata_value,
          orderBy: order_by,
          order,
          page,
          pageSize: page_size,
        });
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "search_customers",
          sourceArgs: { search, metadata_key, metadata_value, order_by, order, page, page_size },
          objectType: "customers",
        });
        return jsonText(out, { toolName: "search_customers" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
