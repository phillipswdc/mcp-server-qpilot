# qpilot-mcp

A Model Context Protocol server for [QPilot](https://qpilot.cloud) that gives
an LLM safe, audited access to a single QPilot site: scheduled orders,
scheduled order items, customers, plus a local cache and a per-mutation audit
log with one-click rollback.

This server is scoped to **one QPilot site per process**. Audit history lives
in a site-specific SQLite file so the log can't bleed across tenants.

---

## Setup

### Requirements
- Node 22+ (Node 20 reached end-of-life April 2026)
- Read/write QPilot API credentials for one site

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Set in `.env`:

| Var | What |
|---|---|
| `QPILOT_BASE_URL` | `https://api.qpilot.cloud` (no trailing slash) |
| `QPILOT_SITE_ID` | Numeric site id this process scopes to |
| `QPILOT_AUTH_TOKEN` | Pre-encoded Basic credential. **Do NOT prefix with `Basic `.** Treat as a secret. |

The server hard-fails on startup if any are missing — so a misconfig surfaces
immediately instead of as a confusing 401 on the first API call.

### Register with Claude Desktop (or any MCP client)

Add to your client's MCP config (Claude Desktop: `~/Library/Application
Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "qpilot": {
      "command": "node",
      "args": ["/absolute/path/to/qpilot/src/index.js"]
    }
  }
}
```

Quit and relaunch the client for the server to start.

### Repointing to a different site

Change `QPILOT_SITE_ID` in `.env` and restart the client. A new
`data/qpilot-site-<id>.db` file is created automatically — audit history stays
separate per site.

### Verification

```bash
npm test          # full test suite (Node's built-in node --test)
npm run check     # syntax check across src/ and test/
```

Tests use Node 22+'s built-in test runner — no test framework
dependencies. See `CONTRIBUTING.md` § *Verification* for the test-writing
playbook.

---

## Tools (34)

Read tools that surface `processingErrorCode` (single SO, processing-cycle reads, etc.) are auto-enriched with `processingErrorCodeName` and `processingErrorCodeMeaning` so you don't have to memorize the numeric codes. See [`docs/qpilot-error-codes.md`](docs/qpilot-error-codes.md) for the full Layer 1 catalog (11 codes) and links to per-gateway codes when a payment fails.

### Scheduled orders
| Tool | Purpose | Audited |
|---|---|---|
| `get_scheduled_order` | Fetch one SO (auto-annotates `processingErrorCode`) | — |
| `search_scheduled_orders` | v3 list (page, statuses, search, orderBy) | — |
| `get_scheduled_order_history` | QPilot's `/ScheduledOrdersHistory` (date range) | — |
| `update_scheduled_order` | Partial update via merge-body PUT | ✅ rollback-able |
| `change_scheduled_order_status` | Active ⇄ Paused only | ✅ rollback-able |
| `snooze_scheduled_order` | Snooze until a future UTC date (auto-reactivates) | ✅ rollback-able |
| `update_scheduled_order_next_occurrence` | Surgical next-occurrence change via dedicated endpoint | ✅ rollback-able |
| `update_scheduled_order_frequency` | Change recurrence frequency/type via dedicated endpoint | ✅ rollback-able |
| `safe_activate_scheduled_order` | Reactivate via dedicated SafeActivate endpoint (handles Failed→Active and, with `allow_deleted`, Deleted→Active) | ✅ rollback-able for Paused/Deleted prior states |
| `retry_scheduled_order` | Trigger a processing-cycle retry via POST .../Retry. ⚠️ Real payment-gateway side effects. **Smoke test pending** — see TODO in source. **Gated**: requires `confirm_payment_impact: true` | ❌ not rollback-able (payment side effects can't be reversed) |
| `change_scheduled_order_payment_method` | Swap the payment method backing an SO via dedicated PATCH .../PaymentMethod endpoint. **Smoke test pending** — needs a second valid PM on site 1113 | ✅ rollback-able (via generic PUT) |
| `delete_scheduled_order` | Soft-delete (recoverable in QPilot UI) | — (project rule) |

### Scheduled order items
| Tool | Purpose | Audited |
|---|---|---|
| `get_scheduled_order_item` | Fetch one item | — |
| `update_scheduled_order_item` | Update quantity / price / etc. | ✅ rollback-able |
| `delete_scheduled_order_item` | Hard-delete | ✅ rollback-able |

### Customers
| Tool | Purpose |
|---|---|
| `get_customer` | Fetch by string id (e.g. `"107"`). The numeric `customerId` field 404s — use the `id` from list responses. |
| `search_customers` | Free-text customer search |
| `get_customer_payment_methods` | Flat array of PMs on file (id, type, lastFourDigits, isDefault, billing). Source of valid `payment_method_id` values for `change_scheduled_order_payment_method`. |
| `get_customer_scheduled_orders` | Flat array of full SO entities owned by the customer. Replaces the unreliable `search_scheduled_orders + customerId filter` pattern. Optional `include_deleted`. |
| `get_customer_metrics` | Single object: active/paused/failed/deleted counts and values, lifetime value, last cycle dates. Optional `exclude_event_logs_data` for speed. |
| `get_customer_event_logs` | Flat array of QPilot events (eventType, eventVerb, originator, descriptionFormatted). ⚠️ Can be hundreds of items — pass `cache:true`. |

### Processing diagnostics
Three pure-GET tools that pair with `retry_scheduled_order` — investigate what QPilot's pipeline actually did before retrying blind.

| Tool | Purpose |
|---|---|
| `list_scheduled_order_processing_cycles` | List cycles for one SO. Filter by status (Processing / Success / Failed / Retry / Void). Pass `cache:true` for filtering via `query_cache`. |
| `get_processing_cycle` | Fetch one cycle by id. Ids surface as `lastProcessingCycleId` on the SO or in the list above. |
| `get_processing_cycle_logs` | QPilot's diagnostic log entries for one cycle — the canonical place to look when a cycle ended Failed. |

### Audit / rollback
| Tool | Purpose |
|---|---|
| `get_environment` | Show current site_id, scope, session_id |
| `list_recent_changes` | Browse audit_log rows (filters: object_type/id, session, success, rolled_back) |
| `get_change_detail` | Full audit row — old/new values, changed_fields, args, error |
| `rollback_change` | Reverse a recorded mutation; dispatches by (object_type, operation) |
| `prune_audit_log` | Delete rows by age / session / except-session |

### Cache
| Tool | Purpose |
|---|---|
| `cache_summary` | Counts of cached payloads by source tool |
| `list_caches` | List cache entries |
| `get_cached_value` | Fetch a stored cache by id |
| `query_cache` | Filter-expression query over cached rows (the search → cache → query flow) |
| `expire_cache` | Drop cache entries |

---

## Audit model

Every mutation routes through `auditedMutation` (`src/qpilot/_audit.js`),
which:

1. Captures `old_values` via a fresh GET.
2. Runs the write (or records the failure).
3. Captures `new_values` via a re-GET.
4. Diffs the two for `changed_fields`.
5. Inserts one row in `audit_log` with `args`, `success`, `error`, and a
   session id stamped at process startup.

The captured `old_values` / `new_values` are filtered to **only the keys the
caller intended to change** (`filterCapturedKeys`). The PUT body itself is a
full entity (QPilot requires it per RFC 2616 — see "Partial updates" below),
but the audit row stays clean.

Failed mutations still produce a row (`success: false`, `new_values: null`),
which makes the log a complete forensic record — not just "things that worked".

### SQLite location

`data/qpilot-site-<QPILOT_SITE_ID>.db`. Created on first run. Schema lives in
`src/db/schema.js`.

WAL mode is on, so you may see `.db-shm` and `.db-wal` sidecars — leave them
in place.

### Rollback

```
rollback_change <audit_id>
```

Dispatches to the registered handler for the row's `(object_type, operation)`.
Refuses already-rolled-back rows, failed mutations, or rows recorded in a
different `scope` than the current process. Pass `force: true` to override
the drift-detection guard (refuses to roll back if the entity has changed
since the original mutation).

---

## Partial updates and QPilot's full-entity PUT

QPilot follows RFC 2616: PUT bodies must contain the **complete entity** even
if you're only changing one field. A partial body 400s on the first missing
required scalar (`Frequency`, `CustomerId`, `UtcOffset`, …).

`update_scheduled_order` and `update_scheduled_order_item` handle this for
you:

1. Fetch the current entity via GET.
2. Spread your `properties` over it.
3. Strip nested/computed fields via `PUT_STRIP_KEYS` (relations like
   `customer`, `site`, `scheduledOrderItems`, plus computed totals and
   timestamps). See `src/qpilot/scheduled_orders.js`.
4. PUT the merged body.

Callers just pass the keys they want to change. The audit log only records
those keys. Don't echo back the full GET response — let the tool merge.

When adding a new scheduled-order field, ask: *is this computed by QPilot,
or is it part of the persisted entity?* Computed/relational → add to
`PUT_STRIP_KEYS`. Persisted scalar → leave it through.

---

## Known QPilot quirks (live-verified)

- **Status enum is small.** `change_scheduled_order_status` accepts only
  `Active` and `Paused`. `Failed` and `Completed` are processing-cycle
  states owned by QPilot; `Deleted` is the soft-delete flag, set via
  `delete_scheduled_order`.
- **Generic PUT rejects status changes.** Don't try to set `status` via
  `update_scheduled_order` — use `change_scheduled_order_status`.
- **Soft-deleted orders reject all PUTs.** Once `lastChangeToDeleted` is
  set, both the body PUT and `/status/{value}` 400. Restore via
  `safe_activate_scheduled_order` with `allow_deleted: true` — that
  endpoint accepts soft-deleted orders specifically.
- **`get_customer` takes the string `id`, not `customerId`.** Use the value
  from `customer.id` in list responses (e.g. `"107"`). The numeric
  `customerId` 404s.
- **`/ScheduledOrdersHistory` has no per-order filter.** Pull a date range
  with `cache: true`, then `query_cache` with
  `filter: scheduledOrderId EQ <id>`.

---

## Limitations

- **No hot-reload.** This is a stdio MCP server started as a child process
  by your MCP client. Changes to source files take effect only after the
  client restarts the server (typically: quit and relaunch the client).
- **Customer surface is read-only.** Six customer read tools are exposed
  (`get_customer`, `search_customers`, `get_customer_payment_methods`,
  `get_customer_scheduled_orders`, `get_customer_metrics`,
  `get_customer_event_logs`). Customer-entity writes (create / update /
  delete) are not wired — use the QPilot UI for those.
- **A few QPilot endpoints remain unimplemented.** Notably:
  `EstimatedDeliveryDate`, `RetryUpdateOrder`, and the customer
  `SwitchCustomer` flow on scheduled orders. Design notes for each are
  captured in project memory under `deferred_endpoints` for pickup when
  prioritized.
- **One site per process.** Multi-site setups need one server registration
  per site, each with its own `QPILOT_SITE_ID`.
- **Two tools shipped without live smoke tests.** `retry_scheduled_order`
  (needs a Failed SO; triggers real payment-gateway side effects on a
  successful retry) and `change_scheduled_order_payment_method` (needs a
  second valid payment method on the test site). Both are flagged in
  their tool descriptions and tracked as open issues. Retry is gated
  behind a required `confirm_payment_impact: true` argument so it
  cannot be invoked accidentally before the smoke test is complete.

---

## Layout

```
src/
  index.js                       # MCP entrypoint
  config/
    env.js                       # Loads + validates env, generates session_id
    constants.js                 # Limits, supported types, cache TTLs
  qpilot/
    client.js                    # HTTP client, auth, path helpers
    retry.js                     # Backoff for 429 / 5xx
    _audit.js                    # auditedMutation wrapper
    audit.js                     # Rollback dispatcher + audit-domain methods
    _cache.js                    # Auto-overflow + opt-in caching helpers
    cache.js                     # Cache-domain methods
    scheduled_orders.js          # Barrel — re-exports the split below
    scheduled_orders/
      constants.js               # OBJECT_TYPE + per-mutation AUDIT_KEYS
      paths.js                   # URL builders per endpoint
      helpers.js                 # mergeForPut, matchTimestampPrecision, …
      reads.js                   # getById, search, history
      mutations.js               # 9 audited mutation functions
      rollback.js                # Dispatcher + handlers + drift guard
    scheduled_order_items.js
    customers.js
  tools/
    *.js                         # Thin MCP-tool wrappers around the qpilot/ layer
  db/
    index.js                     # SQLite singleton (per-site file)
    schema.js                    # Tables: audit_log, result_cache
    queries/                     # Typed query helpers
test/
  _helpers/test-env.js           # Sets test env + resetTestDb()
  qpilot/                        # Mirrors src/qpilot/
  tools/                         # Mirrors src/tools/
rules/                           # AI agent + contributor coding rules
AGENTS.md / CLAUDE.md            # Agent-facing entry points (CLAUDE.md @-imports AGENTS.md)
CONTRIBUTING.md                  # Branching, commits, verification, mutation safety
data/
  qpilot-site-<id>.db            # Audit log + cache, per site (gitignored)
```
