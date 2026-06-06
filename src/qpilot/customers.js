/**
 * Customers domain module — read-only for now.
 *
 * Mutations land later; for now we just expose the two reads the Python
 * version had: get-by-id and search.
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
