/**
 * MCP tool registrations for Scheduled Order Items.
 *
 * Item deletes are real deletes in QPilot, so the delete tool is audited
 * and the rollback handler re-creates the item from captured old_values.
 */
import { z } from "zod";
import {
  getScheduledOrderItemById,
  addScheduledOrderItem,
  updateScheduledOrderItem,
  deleteScheduledOrderItem,
} from "../qpilot/scheduled_order_items.js";
import { jsonText, errorText, statusOf } from "./_shared.js";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerScheduledOrderItemTools(server) {
  server.tool(
    "get_scheduled_order_item",
    "Fetch a single scheduled order item by id.",
    {
      id: z.string().describe("Scheduled order item id."),
    },
    async ({ id }) => {
      try {
        return jsonText(await getScheduledOrderItemById(id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "add_scheduled_order_item",
    "Add a single item to an existing scheduled order via POST /Sites/{siteId}/ScheduledOrderItems. QPilot's wire shape is a batch envelope ({ scheduledOrderId, scheduledOrderItems: [...] }); this tool wraps one item for you so the audit row stays clean (one (object_type, object_id) pair). For multiple items in one SO, call this tool once per item or supply them at SO creation via create_scheduled_order's `items`. Required: `scheduled_order_id`, `product_id`, `quantity`. Audited and rollback-capable: `rollback_change` DELETEs the newly-created item (real delete — same as delete_scheduled_order_item). CONSTRAINTS the docs do not enumerate but you may hit live: productId must be known to QPilot; SO status/lock-window may block additions on Processing/Deleted orders. END-TO-END SMOKE TEST PENDING — needs a safe test SO + productId on site 1113.",
    {
      scheduled_order_id: z
        .number()
        .int()
        .describe("QPilot's int64 scheduled order id (the numeric `id` on an SO entity)."),
      product_id: z.string().min(1).describe("QPilot product id. Must be known to QPilot."),
      quantity: z.number().int().min(1).describe("Quantity to order each cycle."),
      price: z.number().optional().describe("Optional per-unit price override."),
      sale_price: z.number().optional().describe("Optional per-unit sale price override."),
      original_sale_price: z
        .number()
        .optional()
        .describe("Optional per-unit original-sale-price override."),
      cycles: z
        .number()
        .int()
        .optional()
        .describe("Optional per-item cycle cap (independent of SO-level cycles)."),
      min_cycles: z.number().int().optional().describe("Optional minimum-cycles value."),
      max_cycles: z.number().int().optional().describe("Optional maximum-cycles value."),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional metadata object attached to the line item."),
    },
    async ({
      scheduled_order_id,
      product_id,
      quantity,
      price,
      sale_price,
      original_sale_price,
      cycles,
      min_cycles,
      max_cycles,
      metadata,
    }) => {
      try {
        const item = {
          productId: product_id,
          quantity,
          ...(price !== undefined ? { price } : {}),
          ...(sale_price !== undefined ? { salePrice: sale_price } : {}),
          ...(original_sale_price !== undefined ? { originalSalePrice: original_sale_price } : {}),
          ...(cycles !== undefined ? { cycles } : {}),
          ...(min_cycles !== undefined ? { minCycles: min_cycles } : {}),
          ...(max_cycles !== undefined ? { maxCycles: max_cycles } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        };
        const out = await addScheduledOrderItem({
          scheduledOrderId: scheduled_order_id,
          item,
        });
        return jsonText({
          audit_id: out.audit_id,
          scheduled_order_item_id: out.result?.id ?? null,
          result: out.result,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "update_scheduled_order_item",
    "Update fields on a scheduled order item. Audited; rollback supported.",
    {
      id: z.string().describe("Scheduled order item id."),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Fields to update. Only the provided keys are written and tracked."),
    },
    async ({ id, properties }) => {
      try {
        const out = await updateScheduledOrderItem({ id, properties });
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
    "delete_scheduled_order_item",
    "Delete a scheduled order item. This IS a real delete in QPilot; the captured old_values are the only path back. Rollback re-creates the item via POST — the recreated item will receive a NEW id from QPilot.",
    {
      id: z.string().describe("Scheduled order item id."),
      confirm: z
        .literal(true)
        .describe("Must be `true` to actually delete. Item deletion is irreversible from QPilot's UI."),
    },
    async ({ id, confirm }) => {
      try {
        if (confirm !== true) {
          return errorText(
            new Error("delete_scheduled_order_item requires `confirm: true`"),
            "confirm-required"
          );
        }
        const out = await deleteScheduledOrderItem(id);
        return jsonText({
          deleted: true,
          id,
          audit_id: out.audit_id,
          rollback_supported: true,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
