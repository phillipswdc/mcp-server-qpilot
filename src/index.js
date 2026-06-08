#!/usr/bin/env node
/**
 * QPilot MCP server entrypoint.
 *
 * Boot order is intentional:
 *   1. Load .env via absolute path (Claude Desktop spawns this from an
 *      arbitrary cwd, so we cannot rely on dotenv's default lookup).
 *   2. Dynamically import tool modules — they pull in config/env.js, which
 *      throws at import time if required env vars are missing. Static imports
 *      would run before step 1.
 *   3. Construct the MCP server, register tools, connect stdio transport.
 *
 * Stdout is reserved for MCP JSON-RPC traffic. All status messages, logs,
 * and library output must be routed to stderr or suppressed (see the dotenv
 * `quiet: true` flag).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env"), quiet: true });

const { registerAuditTools } = await import("./tools/audit.js");
const { registerCacheTools } = await import("./tools/cache.js");
const { registerScheduledOrderTools } = await import("./tools/scheduled_orders.js");
const { registerScheduledOrderItemTools } = await import("./tools/scheduled_order_items.js");
const { registerCustomerTools } = await import("./tools/customers.js");
const { registerProcessingCycleTools } = await import("./tools/processing_cycles.js");

const server = new McpServer({
  name: "qpilot",
  version: "0.1.0",
});

registerAuditTools(server);
registerCacheTools(server);
registerScheduledOrderTools(server);
registerScheduledOrderItemTools(server);
registerCustomerTools(server);
registerProcessingCycleTools(server);

await server.connect(new StdioServerTransport());

console.error("qpilot-mcp server running on stdio");
