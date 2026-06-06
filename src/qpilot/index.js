/**
 * Public namespace for QPilot domain operations. Tools should import from
 * here, not from individual files — keeps tool code stable when internal
 * layout changes.
 */
import {
  rollbackChange,
  listRecentChanges,
  getChangeDetail,
  pruneAuditLog,
  registerRollbackHandler,
} from "./audit.js";
import {
  getCachedValue,
  queryCache,
  cacheSummary,
  listCaches,
  expireCache,
} from "./cache.js";
import {
  getScheduledOrderById,
  searchScheduledOrders,
  getScheduledOrdersHistory,
  updateScheduledOrder,
  changeScheduledOrderStatus,
  deleteScheduledOrder,
} from "./scheduled_orders.js";
import {
  getScheduledOrderItemById,
  updateScheduledOrderItem,
  deleteScheduledOrderItem,
} from "./scheduled_order_items.js";
import { getCustomerById, searchCustomers } from "./customers.js";
import { env } from "../config/env.js";
import { dbPath } from "../db/index.js";

/** Public domain API consumed by MCP tool handlers. */
export const qpilot = {
  environment: () => ({
    base_url: env.baseUrl,
    site_id: env.siteId,
    scope: env.scope,
    db_path: dbPath,
    session_id: env.sessionId,
    started_at_iso: new Date(env.startedAt).toISOString(),
  }),

  // Audit + rollback
  rollbackChange,
  listRecentChanges,
  getChangeDetail,
  pruneAuditLog,
  registerRollbackHandler,

  // Result cache
  getCachedValue,
  queryCache,
  cacheSummary,
  listCaches,
  expireCache,

  // Scheduled orders
  getScheduledOrderById,
  searchScheduledOrders,
  getScheduledOrdersHistory,
  updateScheduledOrder,
  changeScheduledOrderStatus,
  deleteScheduledOrder,

  // Scheduled order items
  getScheduledOrderItemById,
  updateScheduledOrderItem,
  deleteScheduledOrderItem,

  // Customers
  getCustomerById,
  searchCustomers,
};
