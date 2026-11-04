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
  listScheduledOrders,
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
import {
  maybeCacheResponse,
  newRollingCacheId,
  upsertRollingResultSet,
} from "../qpilot/_cache.js";
import { getCache } from "../db/queries/result_cache.js";
import { annotateProcessingErrorCode } from "../qpilot/processing_failure_codes.js";
import { jsonText, errorText, statusOf, normalizeListResponse } from "./_shared.js";

/**
 * Loose equality for resume-filter values. Arrays compare member-wise and
 * order-insensitively (statuses is the only array in RESUME_FILTER_KEYS);
 * everything else uses == so string/number coercion matches QPilot's wire shape.
 * Exported for tests — not part of the module's public API.
 */
export function sameFilterValue(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  return String(a) === String(b);
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerScheduledOrderTools(server) {
  server.tool(
    "get_scheduled_order",
    "Fetch a single scheduled order by id from QPilot. When the order has a processingErrorCode, the response is enriched with processingErrorCodeName and processingErrorCodeMeaning (resolved from QPilot's 11-code failure catalog — see docs/qpilot-error-codes.md).",
    {
      id: z.string().describe("Scheduled order id."),
    },
    async ({ id }) => {
      try {
        const so = await getScheduledOrderById(id);
        return jsonText(annotateProcessingErrorCode(so));
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
    "sync_all_scheduled_orders",
    "Time-boxed bulk-sync of scheduled orders. Uses the FULL-DETAIL /Sites/{siteId}/ScheduledOrders endpoint so each row is a complete ScheduledOrderDto — top-level customerId, nested customer, scheduledOrderItems with productId/quantity, etc. Persists per page into result_cache under one stable handle. If the run exceeds `max_seconds` it stops cleanly and returns `finished: false` with a `resume_cache_id` and `resume_from_page` — call the tool again with those two params to continue. When `finished: true`, the cache_id holds every matching row.",
    {
      statuses: z
        .array(z.string())
        .optional()
        .describe("Status filter (e.g. ['Active']). Omit for all statuses. Multiple values combine with OR."),
      customer_id: z
        .string()
        .optional()
        .describe("Filter to a single customer's scheduled orders (WP user id)."),
      search: z.string().optional().describe("Free-text search across QPilot's default searchable fields."),
      order_by: z.string().optional().describe("Sort field. QPilot default is 'NextOccurrenceUtc'."),
      order: z.enum(["asc", "desc"]).optional(),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(100)
        .describe("QPilot default is 100 for this endpoint; kept as our default. Max 200."),
      max_pages: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .default(1000)
        .describe("Absolute safety cap across ALL calls of a resumed run."),
      max_seconds: z
        .number()
        .min(5)
        .max(60)
        .optional()
        .default(25)
        .describe("Hard time budget per call. When exceeded the tool returns finished:false with a resume handle; call again with resume_cache_id + resume_from_page to continue."),
      resume_cache_id: z
        .string()
        .optional()
        .describe("Provided by a prior call's response when finished:false. Continues writing into the same cache row."),
      resume_from_page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Provided by a prior call's response when finished:false. First page to fetch on this call."),
    },
    async ({
      statuses,
      customer_id,
      search,
      order_by,
      order,
      page_size,
      max_pages,
      max_seconds,
      resume_cache_id,
      resume_from_page,
    }) => {
      const startedAt = Date.now();
      const deadline = startedAt + max_seconds * 1000;
      const cacheId = resume_cache_id ?? newRollingCacheId();

      // Filter args that must stay consistent across every call of a resumed
      // run — changing them mid-run would mix results into the same cache row.
      const RESUME_FILTER_KEYS = [
        "statuses",
        "customer_id",
        "search",
        "order_by",
        "order",
        "page_size",
      ];

      let all = [];
      if (resume_cache_id) {
        // Missing or expired checkpoint: refuse rather than silently starting
        // from the requested page with an empty array (prior pages would be
        // lost and the "finished" response would hide the gap).
        const prior = getCache(resume_cache_id);
        if (!prior) {
          return errorText(
            new Error(
              `Resume handle ${resume_cache_id} is missing or expired. Start a new run (omit resume_cache_id) to re-fetch from page 1.`
            ),
            "resume-unavailable"
          );
        }
        if (prior.payload) {
          try {
            const parsed = JSON.parse(prior.payload);
            if (Array.isArray(parsed)) all = parsed;
          } catch {
            // Corrupt row — treat as empty, tool call will overwrite it.
          }
        }

        // Hydrate the filter args from the cached source_args so a
        // "resume_cache_id + resume_from_page" call doesn't silently reset
        // filters to undefined and page_size to the schema default.
        const priorArgs = prior.source_args ?? {};
        const callerSupplied = {
          statuses,
          customer_id,
          search,
          order_by,
          order,
          page_size,
        };
        for (const k of RESUME_FILTER_KEYS) {
          const caller = callerSupplied[k];
          const stored = priorArgs[k];
          // Caller supplied a value AND it disagrees with the stored one:
          // refuse rather than silently producing mixed results.
          if (caller !== undefined && !sameFilterValue(caller, stored)) {
            return errorText(
              new Error(
                `Resume filter mismatch on \`${k}\`: stored=${JSON.stringify(
                  stored
                )}, caller=${JSON.stringify(
                  caller
                )}. Call again with only resume_cache_id and resume_from_page, or omit resume_cache_id to start a fresh run with these new filters.`
              ),
              "resume-filter-mismatch"
            );
          }
        }
        // Apply hydrated values back to the locals the loop reads.
        if (statuses === undefined) statuses = priorArgs.statuses;
        if (customer_id === undefined) customer_id = priorArgs.customer_id;
        if (search === undefined) search = priorArgs.search;
        if (order_by === undefined) order_by = priorArgs.order_by;
        if (order === undefined) order = priorArgs.order;
        if (priorArgs.page_size !== undefined) page_size = priorArgs.page_size;
      }

      const sourceArgs = { statuses, customer_id, search, order_by, order, page_size };

      // firstPage = first page number we will fetch on THIS call.
      // lastPageFetched = highest page we actually completed. Starts at
      // firstPage - 1 so "pages_fetched_this_call" is 0 before any fetch.
      const firstPage = resume_from_page ?? 1;
      let lastPageFetched = firstPage - 1;
      let lastBatchSize = 0;
      let lastHandle = null;
      let hitTimeBudget = false;
      let pageInFlight = firstPage; // for error reporting only
      // Populated from the first response we see (this call OR a prior call
      // that already stashed it — we re-derive it from page 1 either way).
      let totalCount = null;
      let totalPagesFromServer = null;
      try {
        for (let nextPage = firstPage; nextPage <= max_pages; nextPage++) {
          pageInFlight = nextPage;
          const raw = await listScheduledOrders({
            page: nextPage,
            pageSize: page_size,
            customerId: customer_id,
            statusNames: statuses,
            search,
            orderBy: order_by,
            order,
          });
          // Capture QPilot's counts from the envelope BEFORE normalize strips
          // most non-candidate keys. Response shape:
          // { items: [...], totalCount: N, totalPages: M }
          if (totalCount == null && raw && typeof raw === "object") {
            if (typeof raw.totalCount === "number") totalCount = raw.totalCount;
            if (typeof raw.totalPages === "number") totalPagesFromServer = raw.totalPages;
          }
          const normalized = normalizeListResponse(raw);
          const batch = normalized.results ?? [];
          all.push(...batch);
          lastBatchSize = batch.length;
          lastPageFetched = nextPage;
          lastHandle = upsertRollingResultSet({
            cacheId,
            toolName: "sync_all_scheduled_orders",
            sourceArgs,
            objectType: "scheduled_orders",
            results: all,
          });
          // Termination signals (whichever fires first):
          //   1. QPilot told us totalPages and we've reached it.
          //   2. This page came back short (< page_size) — last page.
          //   3. Time budget exhausted.
          //   4. Absolute max_pages cap (checked via for-loop bound).
          const reachedTotalPages =
            totalPagesFromServer != null && lastPageFetched >= totalPagesFromServer;
          if (reachedTotalPages) break;
          if (lastBatchSize < page_size) break;
          if (Date.now() >= deadline) {
            hitTimeBudget = true;
            break;
          }
        }
        const naturallyDone =
          (totalPagesFromServer != null && lastPageFetched >= totalPagesFromServer) ||
          lastBatchSize < page_size;
        const hitPageCap =
          !hitTimeBudget && !naturallyDone && lastPageFetched >= max_pages;
        // Only a natural exit counts as finished. Hitting the page cap or the
        // time budget leaves data behind — the response must keep the resume
        // handle populated so the caller can continue (with a larger
        // max_pages / another slice of time).
        const finished = naturallyDone;
        const pagesFetchedThisCall =
          lastPageFetched >= firstPage ? lastPageFetched - firstPage + 1 : 0;
        const pagesRemaining =
          finished || totalPagesFromServer == null
            ? null
            : Math.max(0, totalPagesFromServer - lastPageFetched);
        return jsonText(
          {
            cache_id: cacheId,
            cache_type: "result_set",
            object_type: "scheduled_orders",
            total: all.length,
            total_expected: totalCount,
            total_pages_expected: totalPagesFromServer,
            pages_fetched_this_call: pagesFetchedThisCall,
            last_page_fetched: lastPageFetched,
            pages_remaining: pagesRemaining,
            finished,
            hit_page_cap: hitPageCap,
            hit_time_budget: hitTimeBudget,
            elapsed_ms: Date.now() - startedAt,
            resume_cache_id: finished ? null : cacheId,
            resume_from_page: finished ? null : lastPageFetched + 1,
            expires_at_iso: new Date(lastHandle?.expires_at ?? Date.now()).toISOString(),
            byte_length: lastHandle?.byte_length ?? 0,
            sample: all.slice(0, 5),
            next_steps: finished
              ? "Use query_cache(cache_id) to filter/sort/paginate."
              : "Call sync_all_scheduled_orders again with resume_cache_id and resume_from_page to continue.",
          },
          { toolName: "sync_all_scheduled_orders" }
        );
      } catch (err) {
        // errorText() only renders err.message — assigning recovery metadata
        // onto an Error loses it silently. Build the content string so the
        // caller actually sees the partial cache id, the failed page, and
        // how to resume.
        const recovery = {
          partial_cache_id: cacheId,
          last_page_fetched: lastPageFetched,
          failed_on_page: pageInFlight,
          rows_captured: all.length,
          resume_hint:
            "The last successful page's snapshot is durable. Retry with resume_cache_id=<partial_cache_id> and resume_from_page=<failed_on_page> once the underlying issue is resolved.",
        };
        return {
          content: [
            {
              type: "text",
              text: `QPilot error (${statusOf(err) ?? "unknown"}): ${err?.message ?? String(err)}\n\n${JSON.stringify(recovery, null, 2)}`,
            },
          ],
          isError: true,
        };
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
    "Retry processing for a scheduled order via QPilot's dedicated POST .../Retry endpoint. ⚠️ HIGH-IMPACT: this triggers a real processing cycle, which almost certainly includes a payment-gateway call. Use only on orders that genuinely need a retry (typically status `Failed`). QPilot's docs page for this endpoint is sparse — preconditions, body shape, and error codes are NOT documented, so expect to learn empirically from QPilot's 4xx responses on first uses. NOT rollback-able: payment attempts cannot be reversed via the API. The audit row captures status / nextOccurrenceUtc / lastOccurrenceUtc / lastProcessingCycleId / failure-reason fields for forensic traceability, but `rollback_change` will refuse with a clear message. END-TO-END SMOKE TEST PENDING: this tool has not yet been validated against a real Failed order — first production use is the test. GATE: requires `confirm_payment_impact: true` to invoke; schema validation rejects calls without it so the tool can't be triggered by passing just an id.",
    {
      id: z.string().describe("Scheduled order id. Typically in status Failed (the canonical retryable case)."),
      confirm_payment_impact: z
        .literal(true)
        .describe(
          "Must be exactly `true`. Acknowledges that this call may trigger a real payment-gateway charge that cannot be undone by `rollback_change`. Required to prevent accidental invocation — supplying just an id is rejected at schema validation."
        ),
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
