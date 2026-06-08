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
  updateScheduledOrderNextOccurrence,
  updateScheduledOrderFrequency,
  safeActivateScheduledOrder,
  retryScheduledOrder,
  changeScheduledOrderPaymentMethod,
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
    "Snooze a scheduled order until a future UTC date. QPilot auto-reactivates the order when the snooze period expires. REQUIRES the Snooze feature to be enabled at the SITE level — sites without it return HTTP 400 code 1010 ('Snooze feature is not enabled for this site') regardless of the order's state. Verified disabled on site 1113. Per-order CONSTRAINTS (QPilot will 400 otherwise): snooze_until_utc must be in the future; the order status must be Active or Paused; the order must not be in its lock window. snooze_duration and snooze_duration_type are optional supplemental metadata pairing a numeric value with a unit token (commonly 'Day','Week','Month'); they do not replace snooze_until_utc. Audited and rollback-capable — rollback restores the prior snooze fields via the generic PUT path.",
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
    "update_scheduled_order_next_occurrence",
    "Set a scheduled order's next-occurrence date via QPilot's dedicated PUT .../NextOccurrenceUtc endpoint. Surgical single-field update — avoids the full merge-body PUT used by update_scheduled_order. CONSTRAINTS (QPilot will 400 otherwise): next_occurrence_utc must be in the future; the order status must NOT be Processing or Deleted (Active, Paused, Failed are all accepted); the order must not be in its lock window. Timestamp precision is auto-normalized to match the existing record's fractional-second precision (QPilot's endpoint is strict about this). Audited and rollback-capable — rollback restores the prior nextOccurrenceUtc via the generic PUT path (the dedicated endpoint can't write past-dated values).",
    {
      id: z.string().describe("Scheduled order id."),
      next_occurrence_utc: z
        .string()
        .describe("ISO UTC date-time. Must be in the future. Any ISO precision accepted — the server reformats to match the existing record's precision before sending. Example: '2026-07-01T14:00:00.000Z'."),
    },
    async ({ id, next_occurrence_utc }) => {
      try {
        const out = await updateScheduledOrderNextOccurrence({
          id,
          nextOccurrenceUtc: next_occurrence_utc,
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
    "update_scheduled_order_frequency",
    "Change a scheduled order's recurrence frequency via QPilot's dedicated PUT .../Frequency endpoint. Surgical single-purpose update — avoids the full merge-body PUT used by update_scheduled_order. Accepts `frequency` (integer 1-365) and/or `frequency_type` (Days, Weeks, Months, DayOfTheWeek, DayOfTheMonth); at least one is required. QPilot's endpoint requires both in the body, so any omitted field is filled from the existing record before sending. CONSTRAINTS (QPilot will 400 otherwise): the order status must NOT be Processing or Deleted; the order must not be in its lock window. Audited and rollback-capable — rollback restores only the field(s) the caller actually set, via the generic PUT path.",
    {
      id: z.string().describe("Scheduled order id."),
      frequency: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Recurrence interval count. Integer 1-365. Omit to keep current value (frequency_type must then be provided)."),
      frequency_type: z
        .enum(["Days", "Weeks", "Months", "DayOfTheWeek", "DayOfTheMonth"])
        .optional()
        .describe("Recurrence unit. Omit to keep current value (frequency must then be provided)."),
    },
    async ({ id, frequency, frequency_type }) => {
      try {
        const out = await updateScheduledOrderFrequency({
          id,
          frequency,
          frequencyType: frequency_type,
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
    "safe_activate_scheduled_order",
    "Reactivate a scheduled order via QPilot's dedicated PUT .../SafeActivate endpoint. Distinct from change_scheduled_order_status because that route only accepts Active/Paused transitions — Failed and Snoozed orders need this path to get back to Active, and soft-deleted orders need this path with allow_deleted=true to be restored. QPilot runs its own safety checks (lock window etc.) before flipping status. CONSTRAINTS (QPilot will 400 otherwise): the order status MUST be Failed, Paused, or Snoozed (Active orders are refused with code 1001 'Can only activate Scheduled Orders with statuses $Failed, $Paused or $Snoozed'); if status is Deleted, allow_deleted must be true (Deleted is then also accepted); the order must NOT be in Processing or its lock window. Audited and rollback-capable for Paused→Active (revert via status endpoint) and Deleted→Active (revert via DELETE) transitions. Failed→Active rollback is refused with a clear message — QPilot's status endpoint won't accept Failed as a target, so restore manually in the QPilot UI if needed.",
    {
      id: z.string().describe("Scheduled order id."),
      allow_deleted: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, allow reviving an order currently in Deleted (soft-deleted) status. Default false — the endpoint 400s on Deleted orders without this flag."),
    },
    async ({ id, allow_deleted }) => {
      try {
        const out = await safeActivateScheduledOrder({
          id,
          allowDeleted: allow_deleted,
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
    "retry_scheduled_order",
    "Retry processing for a scheduled order via QPilot's dedicated POST .../Retry endpoint. ⚠️ HIGH-IMPACT: this triggers a real processing cycle, which almost certainly includes a payment-gateway call. Use only on orders that genuinely need a retry (typically status `Failed`). QPilot's docs page for this endpoint is sparse — preconditions, body shape, and error codes are NOT documented, so expect to learn empirically from QPilot's 4xx responses on first uses. NOT rollback-able: payment attempts cannot be reversed via the API. The audit row captures status / nextOccurrenceUtc / lastOccurrenceUtc / lastProcessingCycleId / failure-reason fields for forensic traceability, but `rollback_change` will refuse with a clear message. END-TO-END SMOKE TEST PENDING: this tool has not yet been validated against a real Failed order — first production use is the test.",
    {
      id: z.string().describe("Scheduled order id. Typically in status Failed (the canonical retryable case)."),
    },
    async ({ id }) => {
      try {
        const out = await retryScheduledOrder({ id });
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
    "change_scheduled_order_payment_method",
    "Change which payment method backs a scheduled order via QPilot's dedicated PATCH .../PaymentMethod endpoint. Caller supplies the target QPilot int64 paymentMethodId; the embedded paymentMethod object on the SO is QPilot-resolved from the id. CONSTRAINTS (QPilot will 400 otherwise): the payment method must already exist on the site (error: 'Payment method does not exist'); the order status must NOT be Processing or Deleted; the order must not be in its lock window. To discover valid `payment_method_id` values for the order's customer, call `get_customer_payment_methods` first (each item's `id` is the int to pass here). Audited and rollback-able via the generic PUT path; rollback restores the prior paymentMethodId.",
    {
      id: z.string().describe("Scheduled order id."),
      payment_method_id: z
        .number()
        .int()
        .describe("QPilot's int64 payment method id to assign. Must already exist on the site."),
    },
    async ({ id, payment_method_id }) => {
      try {
        const out = await changeScheduledOrderPaymentMethod({
          id,
          paymentMethodId: payment_method_id,
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
