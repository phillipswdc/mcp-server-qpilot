/**
 * Scheduled-order read endpoints. None of these mutate, so none route through
 * `auditedMutation`. The v3 search endpoint sits outside `sitePath()`'s
 * standard /Sites/{siteId} prefix and is wired here directly.
 */
import { qpilotRequest, sitePath } from "../client.js";
import { withRetry } from "../retry.js";
import { env } from "../../config/env.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../config/constants.js";
import { coerceEndOfDay } from "./helpers.js";
import { orderPath } from "./paths.js";

/**
 * Fetch a single scheduled order by id.
 * @param {string|number} id
 * @returns {Promise<object>}
 */
export async function getScheduledOrderById(id) {
  return await withRetry(() =>
    qpilotRequest({ path: orderPath(id) })
  );
}

/**
 * Lightweight search of scheduled orders. Uses the v3 endpoint which returns
 * a trimmed payload suitable for list views.
 *
 * Parameter names match QPilot's v3 endpoint exactly — `statusNames` is an
 * ARRAY (multiple statuses combine with OR), `search` is the free-text key,
 * and there is no dedicated `customerId` filter (route customer lookups
 * through `search` or via /Customers/{id} for direct fetches).
 *
 * @param {object} [params]
 * @param {number} [params.page=1] 1-indexed page number
 * @param {number} [params.pageSize] Page size (capped at MAX_PAGE_LIMIT)
 * @param {string[]} [params.statusNames] Filter by one or more status values
 *   (e.g. ["Active"], ["Paused","Failed"]). Sent as repeated query keys.
 * @param {string} [params.search] Free-text search across QPilot's default
 *   searchable fields.
 * @param {string} [params.orderBy] Field to sort by (default "NextOccurrenceUtc")
 * @param {"asc"|"desc"} [params.order] Sort direction (default "asc")
 * @returns {Promise<object>}
 */
export async function searchScheduledOrders({
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
  statusNames,
  search,
  orderBy,
  order,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      // The v3 endpoint sits at /v3/Sites/{siteId}/ScheduledOrders rather
      // than under sitePath()'s /Sites/{siteId} prefix.
      path: `/v3/Sites/${encodeURIComponent(env.siteId)}/ScheduledOrders`,
      query: {
        page,
        pageSize: cappedSize,
        statusNames,
        search,
        orderBy,
        order,
      },
    })
  );
}

/**
 * Fetch the QPilot-recorded change history for scheduled orders. This is
 * QPilot's own activity log — distinct from this server's local audit_log.
 *
 * Per QPilot docs the endpoint accepts only date-range, pagination, and
 * order parameters — there is NO server-side filter for a single order id.
 * To get one order's history, fetch a date range with `cache: true` and
 * then `query_cache(filter: scheduledOrderId EQ <id>)`.
 *
 * Date coercion: a bare date like "2026-05-05" passed to QPilot is
 * interpreted as 00:00:00Z, so an `endDate` bare date excludes anything
 * later that same day. We coerce a bare-date `endDate` to the end of that
 * day (T23:59:59.999Z) so the docstring's "inclusive upper bound" promise
 * actually holds. `startDate` is already inclusive at 00:00:00 with a bare
 * date, so we leave it alone.
 *
 * @param {object} [params]
 * @param {string} [params.startDate] ISO date (inclusive lower bound)
 * @param {string} [params.endDate] ISO date (inclusive upper bound — see coercion above)
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize]
 * @param {string} [params.orderBy="Id"] Field to sort by
 * @param {"asc"|"desc"} [params.order="desc"]
 * @returns {Promise<object>}
 */
export async function getScheduledOrdersHistory({
  startDate,
  endDate,
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
  orderBy,
  order,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/ScheduledOrdersHistory`),
      query: {
        startDate,
        endDate: coerceEndOfDay(endDate),
        page,
        pageSize: cappedSize,
        orderBy,
        order,
      },
    })
  );
}
