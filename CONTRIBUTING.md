# Contributing

## Branching

`main` is the only long-lived branch and is always kept in a shippable state.
All work happens on short-lived feature branches off `main`, merged back via
squash-merge.

### Naming

```
<type>/<scope>-<short-kebab-desc>
```

**Types**

| Type       | Use for                                          |
|------------|--------------------------------------------------|
| `feat`     | New tool, endpoint, or capability                |
| `fix`      | Bug fix                                          |
| `refactor` | Internal change, no external behavior difference |
| `docs`     | Documentation only                               |
| `chore`    | Tooling, dependencies, configuration             |
| `test`     | Tests only                                       |

**Scopes** (mirror `src/qpilot/`)

`so` (scheduled orders), `soi` (scheduled order items), `customer`, `payment`,
`product`, `cache`, `audit`, `infra`.

**Examples**

- `feat/so-snooze`
- `feat/customer-graph-reads`
- `feat/so-processing-cycles`
- `fix/soi-merge-body`
- `refactor/audit-rollback-dispatch`
- `docs/contributing`

Branches are short-lived. If a branch sits unmerged for more than a few days,
rebase it onto the current `main` rather than letting it drift.

## Commits

Conventional Commits format:

```
<type>(<scope>): <imperative subject, under 72 chars>

<optional body: what changed and the WHY that isn't obvious from the diff>
```

One logical change per commit. No trailing co-author footers. The commit body
is for the reasoning a future reader will need — hidden constraints,
QPilot quirks the change works around, why a particular approach was chosen
over the obvious alternative.

## Mutation safety rule

Any branch that adds or modifies code which issues a non-GET request to
QPilot (`PUT`, `PATCH`, `POST`, `DELETE`) must either:

1. Route the call through `auditedMutation` in `src/qpilot/_audit.js`, **or**
2. Include a line in the commit body explaining why an audit row is not
   appropriate for this operation (for example: soft-delete patterns,
   idempotent retry triggers, read-only POSTs).

A mutation without a documented audit story is a blocker, not a nit. The
audit log is the rollback story — anything that writes to QPilot must show
up there or have a reason it doesn't.

## Pull requests

Squash-merge into `main`. The squash subject becomes the canonical commit
subject; the squash body becomes the canonical commit body. Both are the
permanent record — keep them clean.

PR description should cover:

- What changed and why
- New tools added (with names, matching the registered MCP tool name)
- Any new QPilot endpoint touched and a link to its reference page on
  `https://docs.qpilot.cloud/reference/`
- For mutations: which `auditedMutation` path the call routes through,
  or why one isn't needed

## Versioning

SemVer, tracked in `package.json`.

- `0.x` while the tool surface and audit schema are still evolving
- Patch: bug fixes, internal refactors
- Minor: new tools, additive changes to existing tool inputs/outputs
- Major: breaking schema or tool-signature changes

Tag releases on `main` after a squash-merge:

```
git tag -a v0.x.0 -m "<release summary>"
git push origin v0.x.0
```

## Local development

- Node 20+
- Copy `.env.example` to `.env` and fill in `QPILOT_BASE_URL`,
  `QPILOT_SITE_ID`, `QPILOT_AUTH_TOKEN`. The server hard-fails on missing
  values at startup.
- The server is a stdio MCP child process — there is no hot reload. Restart
  the host client after source changes.
- Per-site SQLite files live in `data/qpilot-site-<id>.db` and are gitignored.

## QPilot reference discipline

Before adding or changing any QPilot HTTP call, fetch the specific endpoint's
reference page from `https://docs.qpilot.cloud/reference/` and verify the
exact query parameters and request body shape. The reference index page only
lists routes and methods — it does not document parameters. Guessing
parameter names from the index has bitten this codebase before.
