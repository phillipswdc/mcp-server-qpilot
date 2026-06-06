/**
 * MCP tool registrations for Scheduled Order Items.
 *
 * Item deletes are real deletes in QPilot, so the delete tool is audited
 * and the rollback handler re-creates the item from captured old_values.
 */
import { z } from "zod";
import {
  getScheduledOrderItemById,
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
