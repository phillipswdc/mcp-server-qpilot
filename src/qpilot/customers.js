/**
 * Customers domain module — read-only for now.
 *
 * Reads: get-by-id, search, plus the four customer-scoped drill-down reads
 * (scheduled orders, payment methods, metrics, event logs).
 *
 * Mutations land later.
 */
import { qpilotRequest, sitePath } from "./client.js";
import { withRetry } from "./retry.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Fetch a single customer by id.
 * @param {string|number} id
 */
export async function getCustomerById(id) {
  return await withRetry(() =>
    qpilotRequest({ path: sitePath(`/Customers/${encodeURIComponent(id)}`) })
  );
}

/**
 * Search customers. The collection endpoint is the stand-in for "search" —
 * it accepts query filters and returns paginated results.
 *
 * Parameter names match QPilot's endpoint exactly. There is no dedicated
 * `email` or `externalId` filter; both must be routed through `search` (or
 * via `metadataKey` / `metadataValue` for metadata-stored values like the
 * external commerce-platform customer id).
 *
 * @param {object} [params]
 * @param {string} [params.search] Free-text search across QPilot's default fields
 * @param {string[]} [params.metadataKey] Metadata keys to filter on (parallel arrays)
 * @param {string[]} [params.metadataValue] Matching values for metadataKey
 * @param {string} [params.orderBy] Field to sort by (default "Id")
 * @param {"asc"|"desc"} [params.order] Sort direction (default "asc")
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize]
 */
export async function searchCustomers({
  search,
  metadataKey,
  metadataValue,
  orderBy,
  order,
  page = 1,
  pageSize = DEFAULT_PAGE_LIMIT,
} = {}) {
  const cappedSize = Math.min(pageSize, MAX_PAGE_LIMIT);
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/Customers`),
      query: {
        search,
        metadataKey,
        metadataValue,
        orderBy,
        order,
        page,
        pageSize: cappedSize,
      },
    })
  );
}

/**
 * Fetch all payment methods on file for a customer. Returns a flat array
 * — QPilot does not paginate this endpoint. Each item carries id, status,
 * type (e.g. "Stripe"), expirationDate, lastFourDigits, isDefault, billing
 * address fields, and gateway identifiers.
 *
 * @param {string|number} id
 */
export async function getCustomerPaymentMethods(id) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/Customers/${encodeURIComponent(id)}/PaymentMethods`),
    })
  );
}

/**
 * Fetch all scheduled orders belonging to a customer. Returns a flat array
 * of full SO entities (same shape as get_scheduled_order). Optional
 * `includeDeleted` flips QPilot's default of excluding soft-deleted orders.
 *
 * @param {object} params
 * @param {string|number} params.id Customer id
 * @param {boolean} [params.includeDeleted] When true, includes
 *   soft-deleted SOs (status: Deleted). Defaults to QPilot's default
 *   (excluded).
 */
export async function getCustomerScheduledOrders({ id, includeDeleted } = {}) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/Customers/${encodeURIComponent(id)}/ScheduledOrders`),
      query: includeDeleted ? { includeDeleted: true } : undefined,
    })
  );
}

/**
 * Fetch QPilot's roll-up metrics for a customer: active/paused/failed/
 * deleted SO counts and values, lifetime value, last successful and last
 * failed processing cycle dates, etc. Returns a single object (not an
 * array). Optional `excludeEventLogsData` skips the event-log-derived
 * fields if you only need the counts (faster on customers with many events).
 *
 * @param {object} params
 * @param {string|number} params.id Customer id
 * @param {boolean} [params.excludeEventLogsData] Default false. When true,
 *   QPilot omits the event-log-sourced fields from the response.
 */
export async function getCustomerMetrics({ id, excludeEventLogsData } = {}) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/Customers/${encodeURIComponent(id)}/Metrics`),
      query: excludeEventLogsData ? { excludeEventLogsData: true } : undefined,
    })
  );
}

/**
 * Fetch the customer's event log. Returns a flat array of QPilot events
 * (entityType, eventType, eventVerb, descriptionFormatted, originator info,
 * etc.). Active customers can have hundreds of events — the SO 208022
 * customer (id=107) has 352 — so callers should expect large responses
 * and use the cache flag at the tool layer.
 *
 * @param {string|number} id Customer id
 */
export async function getCustomerEventLogs(id) {
  return await withRetry(() =>
    qpilotRequest({
      path: sitePath(`/Customers/${encodeURIComponent(id)}/EventLogs`),
    })
  );
}
