/**
 * Scheduled Orders domain — barrel file.
 *
 * The implementation is split across the `scheduled_orders/` directory:
 *
 *   - constants.js   OBJECT_TYPE and per-mutation AUDIT_KEYS constants.
 *   - paths.js       URL builders for every scheduled-order endpoint.
 *   - helpers.js     Pure helpers (mergeForPut, matchTimestampPrecision,
 *                    coerceEndOfDay, PUT_STRIP_KEYS).
 *   - reads.js       Non-audited GETs (single, v3 search, history).
 *   - mutations.js   The 9 mutation functions (audited via auditedMutation;
 *                    delete is intentionally non-audited per project rule).
 *   - rollback.js    Dispatcher + handlers; importing it has the side
 *                    effect of registering the rollback handler.
 *
 * Consumers (src/tools/scheduled_orders.js and src/qpilot/index.js) import
 * from this file so internal layout can change without a ripple. Adding a
 * new mutation? Implement it in mutations.js, add the AUDIT_KEYS constant
 * to constants.js, wire any new rollback behavior in rollback.js, then
 * re-export the new function here.
 */

// Side-effect import: registers the rollback handler on module load.
import "./scheduled_orders/rollback.js";

export {
  getScheduledOrderById,
  searchScheduledOrders,
  getScheduledOrdersHistory,
} from "./scheduled_orders/reads.js";

export {
  updateScheduledOrder,
  changeScheduledOrderStatus,
  snoozeScheduledOrder,
  updateScheduledOrderNextOccurrence,
  updateScheduledOrderFrequency,
  safeActivateScheduledOrder,
  retryScheduledOrder,
  changeScheduledOrderPaymentMethod,
  deleteScheduledOrder,
} from "./scheduled_orders/mutations.js";
