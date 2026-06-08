/**
 * Processing-cycle reads. Pure GETs — no audit, no rollback.
 *
 * QPilot's processing-cycle endpoints expose the diagnostic history that
 * pairs with `retry_scheduled_order`: before retrying blind, look at what
 * QPilot's pipeline actually said the last time. Three reads, chaining
 * from order → cycles list → cycle detail → cycle logs.
 *
 * Doc note: as of 2026-06-08 QPilot's reference pages document the path
 * params and (for the per-SO list) query params, but the response shapes
 * are blank — "Click Try It! to see the response." First live calls
 * record the actual shapes in commit messages and project memory.
 */
import { qpilotRequest, sitePath } from "./client.js";
import { withRetry } from "./retry.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * List processing cycles for one scheduled order.
 *
 * Endpoint: GET /Sites/{siteId}/ScheduledOrders/{scheduledOrderId}/ProcessingCycles
 *
 * @param {object} params
 * @param {string|number} params.id Scheduled order id
 * @param {("Processing"|"Success"|"Failed"|"Retry"|"Void")} [params.status]
 *   Filter to a single cycle status. Omit for all statuses.
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize] Capped at MAX_PAGE_LIMIT
 * @param {string} [params.orderBy] QPilot default is "StartDateUtc"
 * @param {"asc"|"desc"} [params.order] QPilot default is "desc"
 * @returns {Promise<object>}
 */
export async function listScheduledOrderProcessingCycles({
  id,
  status,
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
  orderBy,
  order,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(
        `/ScheduledOrders/${encodeURIComponent(id)}/ProcessingCycles`
      ),
      query: {
        status,
        page,
        pageSize: cappedSize,
        orderBy,
        order,
      },
    })
  );
}

/**
 * Fetch one processing cycle by id.
 *
 * Endpoint: GET /Sites/{siteId}/ProcessingCycles/{processingCycleId}
 *
 * Cycle ids surface as `lastProcessingCycleId` on a scheduled order and in
 * each row of the per-SO cycles list.
 *
 * @param {string|number} cycleId
 */
export async function getProcessingCycleById(cycleId) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/ProcessingCycles/${encodeURIComponent(cycleId)}`),
    })
  );
}

/**
 * Fetch the diagnostic processing logs for one cycle.
 *
 * Endpoint: GET /Sites/{siteId}/ProcessingCycles/{processingCycleId}/ProcessingLogs
 *
 * Response shape is undocumented — assume a list or a free-form blob until
 * runtime probing tells us otherwise.
 *
 * @param {string|number} cycleId
 */
export async function getProcessingCycleLogs(cycleId) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(
        `/ProcessingCycles/${encodeURIComponent(cycleId)}/ProcessingLogs`
      ),
    })
  );
}
