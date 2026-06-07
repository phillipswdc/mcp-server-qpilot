/**
 * MCP tool registrations for Customers (read-only for now).
 */
import { z } from "zod";
import {
  getCustomerById,
  searchCustomers,
  getCustomerPaymentMethods,
  getCustomerScheduledOrders,
  getCustomerMetrics,
  getCustomerEventLogs,
} from "../qpilot/customers.js";
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

  server.tool(
    "get_customer_payment_methods",
    "Fetch all payment methods on file for a customer via GET /Customers/{id}/PaymentMethods. Returns a flat array — QPilot does not paginate. Each item includes id (int — use this as `payment_method_id` for change_scheduled_order_payment_method), status, type (e.g. 'Stripe'), expirationDate, lastFourDigits, isDefault, billing address, and gateway identifiers. Pass cache:true to stash the full result-set locally for filtering via query_cache.",
    {
      id: z.string().describe("Customer id (the string id from get_customer / customer.id on an SO)."),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full result-set in result_cache and return a handle + sample."),
    },
    async ({ id, cache }) => {
      try {
        const raw = await getCustomerPaymentMethods(id);
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "get_customer_payment_methods",
          sourceArgs: { id },
          objectType: "payment_methods",
        });
        return jsonText(out, { toolName: "get_customer_payment_methods" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_customer_scheduled_orders",
    "Fetch all scheduled orders belonging to a customer via GET /Customers/{id}/ScheduledOrders. Returns full SO entities (same shape as get_scheduled_order). Use this instead of search_scheduled_orders + customerId filter — that filter is unreliable on QPilot's v3 list endpoint. Optional `include_deleted` flips QPilot's default of excluding soft-deleted SOs. Pass cache:true for large result-sets.",
    {
      id: z.string().describe("Customer id."),
      include_deleted: z
        .boolean()
        .optional()
        .describe("When true, includes soft-deleted SOs (status: Deleted). Default: QPilot excludes them."),
      cache: z
        .boolean()
        .optional()
        .describe("If true, store the full result-set in result_cache and return a handle + sample."),
    },
    async ({ id, include_deleted, cache }) => {
      try {
        const raw = await getCustomerScheduledOrders({ id, includeDeleted: include_deleted });
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "get_customer_scheduled_orders",
          sourceArgs: { id, include_deleted },
          objectType: "scheduled_orders",
        });
        return jsonText(out, { toolName: "get_customer_scheduled_orders" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_customer_metrics",
    "Fetch QPilot's roll-up metrics for a customer via GET /Customers/{id}/Metrics. Single object response with active/paused/failed/deleted SO counts and values, lifetime value, last successful and last failed processing cycle dates, and event-log-derived summaries. Optional `exclude_event_logs_data` skips the event-log-sourced fields (faster on customers with many events). No cache flag — single object, always small.",
    {
      id: z.string().describe("Customer id."),
      exclude_event_logs_data: z
        .boolean()
        .optional()
        .describe("When true, QPilot omits the event-log-sourced fields from the response. Use for faster lookups on customers with hundreds of events."),
    },
    async ({ id, exclude_event_logs_data }) => {
      try {
        return jsonText(
          await getCustomerMetrics({ id, excludeEventLogsData: exclude_event_logs_data })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_customer_event_logs",
    "Fetch the customer's event log via GET /Customers/{id}/EventLogs. Returns a flat array of QPilot events with eventUtc, eventType, eventVerb, entityType, originator info, and descriptionFormatted. ⚠️ Active customers commonly have hundreds of events (customer 107 on site 1113 has 352) — strongly recommended to pass cache:true and use query_cache for filtering and pagination rather than dumping the full array into context.",
    {
      id: z.string().describe("Customer id."),
      cache: z
        .boolean()
        .optional()
        .describe("If true (RECOMMENDED for active customers), store the full result-set in result_cache and return a handle + sample."),
    },
    async ({ id, cache }) => {
      try {
        const raw = await getCustomerEventLogs(id);
        const normalized = normalizeListResponse(raw);
        const out = maybeCacheResponse(normalized, {
          useCache: cache === true,
          toolName: "get_customer_event_logs",
          sourceArgs: { id },
          objectType: "event_logs",
        });
        return jsonText(out, { toolName: "get_customer_event_logs" });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
