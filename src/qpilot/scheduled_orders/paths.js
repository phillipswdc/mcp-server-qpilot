/**
 * QPilot URL path builders for scheduled-order endpoints. All paths route
 * through `sitePath` so they pick up the current QPILOT_SITE_ID at call
 * time without each helper having to know about it.
 */
import { sitePath } from "../client.js";

export function orderPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}`);
}

export function statusPath(id, status) {
  return sitePath(
    `/ScheduledOrders/${encodeURIComponent(id)}/status/${encodeURIComponent(status)}`
  );
}

export function snoozePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/Snooze`);
}

export function nextOccurrencePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/NextOccurrenceUtc`);
}

export function frequencyPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/Frequency`);
}

export function safeActivatePath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/SafeActivate`);
}

export function retryPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/Retry`);
}

export function paymentMethodPath(id) {
  return sitePath(`/ScheduledOrders/${encodeURIComponent(id)}/PaymentMethod`);
}
