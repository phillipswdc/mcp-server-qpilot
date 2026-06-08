# MCP Tool Quality Rules

These rules govern how tools are added to and modified in this MCP server. They are grounded in patterns the existing 31 tools already follow — not invented best practice.

## Tool Naming

Tools follow `<verb>_<entity>[_<scope>]`. Verbs in current use:

- **Reads:** `get_*` for single entities and roll-up endpoints; `search_*` for v3 list/search endpoints; `list_*` for cache/audit collection helpers.
- **Mutations:** named by the QPilot endpoint's action verb when one exists — `snooze_*`, `safe_activate_*`, `retry_*`, `delete_*`. Use `update_*` only for generic full-body PUTs. Use `change_*` when QPilot's endpoint name is `change-` or when "change" is the clearest English (e.g. `change_scheduled_order_status`, `change_scheduled_order_payment_method`).
- **Drill-downs:** `get_<owner>_<plural-collection>` — see `get_customer_payment_methods`, `get_customer_scheduled_orders`, `get_customer_event_logs`.

Use snake_case for tool names and argument names — never camelCase. Map to camelCase only inside the domain-module call.

## Tool Descriptions Are LLM Documentation

The description string in `server.tool(name, description, schema, handler)` is the primary surface the model uses to decide whether and how to call the tool. Treat it as documentation, not a one-liner. Every mutation description must include, in approximately this order:

1. **What QPilot route it hits.** Name the endpoint: "via QPilot's dedicated PUT `.../SafeActivate` endpoint."
2. **Why this tool exists vs. a generic alternative.** If a targeted endpoint avoids a footgun of the generic path, say so (e.g. `change_scheduled_order_status` exists because generic PUT rejects status changes).
3. **CONSTRAINTS that produce 4xx.** Anything QPilot will reject — status preconditions, lock-window rules, format requirements, missing site feature flags. Use the literal keyword `CONSTRAINTS` so it is grep-able and visually parseable in the model's context. See `safe_activate_scheduled_order` for the canonical shape.
4. **Audit and rollback story.** State explicitly: `Audited and rollback-able`, `Audited but NOT rollback-able (reason)`, or `Not audited (reason)`. Never leave the rollback story implicit — the model needs to know whether to suggest `rollback_change` to the user.
5. **High-impact warnings.** Prefix with `⚠️` for: real payment-gateway side effects, mass operations, responses that commonly return hundreds of items. See `retry_scheduled_order` and `get_customer_event_logs`.
6. **Smoke-test status when pending.** Use the literal phrase `END-TO-END SMOKE TEST PENDING` when the tool has shipped without live validation. See *Smoke-Test Marking* below.

Read descriptions are shorter but must still name the route and (for list endpoints) explain when to pass `cache: true`.

## Zod Schema `.describe()` Discipline

Every field on every schema must have `.describe()`. The text is part of the LLM contract — un-described fields silently degrade tool usability because the model has to guess intent from the name alone.

Specific shapes that have been established:

- **Id fields**: name the source. "Customer id (the string `id` from `get_customer` / `customer.id` on an SO)" — `id` vs `customerId` confusion is documented in project memory as a real footgun.
- **Optional flags with default behavior**: state what QPilot does when the flag is unset. "Default false — the endpoint 400s on Deleted orders without this flag."
- **Booleans that wrap a QPilot query param**: name the upstream parameter so reviewers see the mirror. See the API-mirror carve-out in [`code-quality.md`](code-quality.md).
- **`cache: z.boolean().optional()`**: use the exact phrasing `"If true, store the full result-set in result_cache and return a handle + sample."` — keep it consistent across tools so the model learns one pattern.

## Audited Mutation Routing

Every write to QPilot (`PUT`, `PATCH`, `POST`, `DELETE`) must route through `auditedMutation` in `src/qpilot/_audit.js`. Tools never call `auditedMutation` directly — domain modules wrap their mutations with it and expose the wrapped function to the tool layer.

The mutation safety rule in [`../CONTRIBUTING.md`](../CONTRIBUTING.md) is the enforcement boundary at PR review. Skipping the audit layer requires an explicit reason in the commit body. The only current exception is `delete_scheduled_order` — QPilot soft-deletes scheduled orders and recovery is via the QPilot UI, so the audit/rollback layer adds nothing.

When wrapping a new mutation, define a `<OPERATION>_AUDIT_KEYS` constant at the top of the domain module listing the fields the audit row should capture. The list must be a **superset of every key the write body can touch**, because rollback reads `args.properties` and pulls each prior value from `old_values` — missing a key there means the rollback writes `undefined`.

## Rollback Handler Registration

A mutation tool ships when one of the following is true:

1. A rollback handler is registered for its `(object_type, operation)` pair via `registerRollbackHandler` (see `src/qpilot/scheduled_orders.js` end of file). The handler may dispatch internally by `tool_name` to route a body PUT vs. status flip vs. SafeActivate-style endpoint.
2. The tool's description explicitly states why rollback is not possible (e.g. `retry_scheduled_order` — payment-gateway side effects cannot be reversed via the API), AND the rollback dispatcher returns a clear refusal rather than silently failing. The refusal handler is itself registered through the same dispatch so the dispatcher never falls through to "not supported."

Shipping a mutation tool without one of those two paths leaves the rollback dispatcher unable to handle the row — `rollback_change` will refuse with `Rollback is not supported for X update`. That's a worse UX than a clear refusal.

## Smoke-Test Marking

When a mutation tool ships without live validation against a real QPilot resource, the pending status must be marked in four places:

1. **Tool description**: the literal phrase `END-TO-END SMOKE TEST PENDING` with a one-line reason (e.g. "needs a Failed order").
2. **Source-code TODO** at the mutation function: `TODO(YYYY-MM-DD): no end-to-end smoke test yet — <what's needed>`.
3. **README row** for the tool: `**Smoke test pending** — see TODO in source` in the audit column.
4. **Project memory entry** (when the host loads memory): `<tool-name>-smoke-test-pending` documenting the playbook to run when the prerequisite resource becomes available.

The four marks are intentional redundancy: the tool description ensures the calling model warns the user; the source TODO and README row ensure a future contributor sees the gap during code or doc review; the memory entry ensures the test gets run when the resource becomes available, not forgotten.

A smoke-test is "complete" when at least one real call succeeded **and** the rollback path was exercised against the resulting audit row (or, for refuse-rollback tools, the refusal was verified).

## Response Shape Discipline

Tools wrap their successful response via `jsonText` (auto-overflow caching is built in — do not bypass it without `skipOverflow: true`) and their errors via `errorText`. Audited mutations return `{ audit_id, changed_fields, result }` so the caller can immediately reference the audit row for rollback. Reads with potentially large results expose `cache: z.boolean().optional()` and run the response through `maybeCacheResponse`. List endpoints with QPilot's multi-array-key shape go through `normalizeListResponse` before any caching or further handling.

These helpers live in `src/tools/_shared.js` and `src/qpilot/_cache.js`. Use them rather than inventing per-tool wrapping — the consistency is what lets the model reliably parse output across all 31 tools.
