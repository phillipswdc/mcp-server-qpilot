# Roadmap

Snapshot: **2026-06-08**. Built by surveying the full QPilot API surface
against what this server currently exposes, then ordering remaining work
by leverage (not by endpoint count).

Update this file when phases ship, when scope changes, or when a new
priority surfaces. The phase ordering below reflects current judgment —
re-evaluate after each phase rather than treating it as committed
sequence.

---

## QPilot surface — implemented vs gap

QPilot exposes **~115 endpoints** under `/Sites/{siteId}/`. This server
ships **~25**. Raw counts mislead — most of the gap is in domains
adjacent to (not core to) subscription management.

| Bucket | Endpoints | Status |
|---|---|---|
| **Scheduled-order CRUD + lifecycle** | 30 | 12 shipped, 11 high-value gaps, 7 lower |
| **Scheduled-order items** | 4 | 3 shipped, 1 gap (POST/create) |
| **Customers (reads)** | 7 | 6 shipped, 1 gap (Summaries) |
| **Customers (mutations)** | 4 | 0 shipped — entire mutation surface gap |
| **PaymentMethods** | 11 | 0 shipped — entire module gap |
| **PaymentIntegrations** | 5 | 0 shipped — admin |
| **ProcessingCycles** | 3 | 2 shipped, 1 mutation gap (PUT) |
| **Products / ProductGroups / Coupons** | 22 | 0 — likely out of scope |
| **Shipping (Addresses / Rates / Integrations)** | 17 | 0 — likely out of scope |
| **Webhooks** | 7 | 0 — admin / dev tooling |
| **QuickLinks (customer self-service)** | 13 | 0 — major feature, not subscriptions-core |
| **Reports + Dashboard** | 8 | 0 — analytics layer |
| **Site management + AccessTokens** | 8 | 0 — admin / sensitive |
| **Bundles / Email Preview / Misc** | 6 | 0 — narrow features |

---

## Phase 1 — Close the safety loop *(highest priority)*

Three classes of recently-shipped code sit in `main` without live
end-to-end validation:

- `retry_scheduled_order` — gated since PR #22, never smoke-tested.
- `change_scheduled_order_payment_method` — open as GitHub issue #5.
- Processing-cycle trio (PR #23) — pass-throughs, response shapes still
  recorded as "discover at runtime."
- `auditedMutation` partial-state path (PR #21) — refetch-failure case
  never artificially triggered against QPilot.

Building more primitives on top of unverified ones accumulates risk
faster than features. This phase is a **discipline pass**: no new tools.

**Deliverables**
- Live runs of each unverified tool against site 1113.
- Tool descriptions updated with real response shapes from the trio.
- GitHub #5 closed.
- Project memory entries (`retry_smoke_test_pending`,
  `payment_method_smoke_test_pending`) cleared or updated.

**Effort** ~1 long session if committed to as a block; otherwise it
spreads thin across whichever tools get touched next.

---

## Phase 2 — Read-only mode

The original roadmap step 5. Single env-var gate at `auditedMutation`
that throws when set. Five design questions are open in the
`read_only_mode_design` memory entry; resolve them in a 30-minute
decision pass at the start of this work rather than pre-resolving them.

**Why before the cache layer**: it's load-bearing for safety
(deploying this MCP server in shared environments), not performance.

**Effort** ~1 session including the design pass.

---

## Phase 3 — Close the scheduled-order mutation surface

Three deferred mutations that finish the SO surface. After this, the
SO mutation coverage is *complete* — no more partial coverage.

- **`SwitchCustomer`** (PATCH) — user-flagged priority in
  `deferred_endpoints` memory. Blocker: needs two test customers on
  site 1113 you can safely flip an SO between. Mitigation: stub a
  second test customer at session start.
- **`EstimatedDeliveryDate`** (PUT) — design already complete in
  `deferred_endpoints` memory. ~30 min to implement and live-test.
- **`RetryUpdateOrder`** (POST) — ship-blind sibling of `/Retry`. Gate
  behind `confirm_payment_impact` for symmetry. ~30 min.

**Effort** ~1 session.

---

## Phase 4 — PaymentMethods reads + safe mutations

Highest-leverage gap of the unimplemented domains. Reads first, then
narrowly-scoped mutations.

**Ship (reads, 3 tools):**
- `GET /PaymentMethods` — site-wide list
- `GET /PaymentMethods/{id}` — single PM detail
- `GET /PaymentMethods/{id}/ScheduledOrders` — which SOs reference this PM
- `GET /OtherPaymentMethods/{customerId}/{type}` — alternative gateway PMs

**Defer / skip:**
- `POST /PaymentMethods`, `POST /Upsert`, `PUT /PaymentMethods/{id}` —
  payment-data mutation is PCI-adjacent; wait for a concrete use case
  before exposing to an LLM-callable tool.
- `POST /Customers/{ext}/PaymentMethods/Vault`, `PUT /Vault` —
  security-sensitive token management. Hold indefinitely.
- `DELETE /PaymentMethods/{id}` — destructive; PM deletion belongs in
  the QPilot UI for now.

**Effort** ~1-2 sessions.

---

## Phase 5 — Diagnostic + dashboard tier

Pure-GET batch — fast to ship together as one PR.

- `get_integration_check` — `GET /Integration-Check` (operational health)
- 5 Dashboard endpoints:
  - `MonthlyReportByCurrency/{period}`
  - `SOsCreatedByMonth/{period}`
  - `SOsDeletedByMonth/{period}`
  - `SOsProcessedByMonth/{period}`
  - `SOsErrorCodeCounts/{period}`
- 3 Reports:
  - `CohortReport/{period}/{status}`
  - `ScheduledOrdersByCycles/{period}`
  - `ScheduledOrdersChurn/{period}`
- `GET /CustomerMetrics` (site-wide variant of the per-customer
  metrics tool we already ship)

**Why batched**: all pure reads, similar shape, no audit complexity.
~9 tools at once.

**Effort** ~1 session.

---

## Phase 6 — SQLite read-cache layer

Original roadmap step 4. Paused mid-design. Two gating questions in the
`local_cache_architecture` memory entry need answers before code starts:

1. Wipe-on-session-start vs. TTL-based eviction
2. Which read tools auto-cache vs. opt-in via `cache:true`

**Recommendation**: drop this from the active roadmap until the
questions get answered. Resolve them in a focused conversation (~30 min),
then schedule the build.

**Effort** ~1-2 sessions of build, after design resolves.

---

## Phase 7 — Webhooks management

7 endpoints. `Sample/{eventType}` and `PollingSample/{eventType}` return
canonical event payloads for any event type — useful for downstream
integrations that need to know what QPilot's webhooks look like without
provisioning real ones.

Ship reads + simple create/update/delete if a concrete use case
emerges; otherwise skip.

**Effort** ~1 session if pursued.

---

## Phase 8 — QuickLinks *(feature decision)*

13 endpoints. Customer-self-service tokenized URLs that let customers
manage their own subscriptions without logging in (pause / change PM /
update address). **Not subscriptions-core; it's customer-facing UI
infrastructure.**

Build only if you're surfacing it to a downstream agent that creates
links programmatically (e.g., a support-bot flow: "send the customer a
link to pause"). Otherwise defer indefinitely.

**Effort** Major. Don't pick up casually.

---

## Out of scope (recommended)

~75 endpoints. Skip unless a specific use case appears.

| Domain | Why skip |
|---|---|
| **Products / ProductGroups / Coupons** (22) | Usually managed in the parent ecommerce platform (WooCommerce, Shopify, BigCommerce). QPilot syncs from there. |
| **Shipping (Addresses / Rates / Integrations)** (17) | Same — managed upstream. |
| **Customer mutations** (POST/PUT/DELETE, Upsert) | Customer records are externally owned in most setups. Adding write surface here forks state. |
| **Site management** (PUT/Pause/Resume/Metadata/Delete) | Admin-level, one-off, not LLM-callable. |
| **AccessTokens** (CustomerLogin, Generate) | Security-sensitive. Should never be exposed via an MCP tool by default. |
| **Bundles / Email Preview / Misc** | Narrow features without a strong subscriptions-core motivation. |
| **ProcessingCycles mutation** (PUT) | Direct cycle mutation has unclear semantics — likely admin/recovery, not normal operation. |
| **PaymentIntegrations** (5) | Admin configuration; rarely touched. |

---

## Summary

| Phase | Theme | Sessions | When |
|---|---|---|---|
| 1 | Smoke debt + tool-description updates | ~1-2 | **Next** — discipline, no new tools |
| 2 | Read-only mode | ~1 | After phase 1 |
| 3 | Finish SO mutations (SwitchCustomer + 2) | ~1 | After phase 2 |
| 4 | PaymentMethods reads | ~1-2 | When useful |
| 5 | Diagnostics + dashboards (~9 tools batch) | ~1 | Easy win |
| 6 | Cache layer | ~1-2 | Only after design questions resolve |
| 7 | Webhooks | ~1 | Only if needed |
| 8 | QuickLinks | major | Feature decision, not a default |
| — | ~75 other endpoints | — | Out of scope unless use case emerges |

## Recommended sequence

**Phase 1 → Phase 2 → Phase 3.** That's three sessions that close every
loose end on the current surface and ship the safety feature you
actually need. Then re-evaluate — by that point you'll know which of
Phases 4-8 the real workload demands.
