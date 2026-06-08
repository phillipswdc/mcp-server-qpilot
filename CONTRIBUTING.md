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

One logical change per commit. The commit body is for the reasoning a future
reader will need — hidden constraints, QPilot quirks the change works around,
why a particular approach was chosen over the obvious alternative.

### No AI-generated trailers

Commit messages on this repository must not contain AI-generated co-author
or attribution trailers. Specifically:

- No `Co-Authored-By: Claude ...` lines.
- No `Co-Authored-By: <any AI model> ...` lines.
- No `🤖 Generated with [Claude Code](https://claude.com/claude-code)` or any
  other AI-tool attribution footer.
- No "Generated with" / "Authored by" footers naming an AI tool.

The commit author is the human contributor. If an AI assistant helped write
the change, that fact lives in the PR description (if at all), not in the
permanent git history. This rule has been broken before and required a
history rewrite to fix — keep it clean the first time.

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

Merge with **"Create a merge commit"** (GitHub UI default) — not squash,
not rebase. This preserves the original feature-branch commit SHAs as the
parent of the merge commit, which keeps `git log --first-parent main`
readable as a series of PR merges while `git log` shows the individual
feature commits with their original hashes. Audit-bound projects need that
SHA preservation: rolling back to a specific feature state means
referencing a stable, never-rewritten hash.

The feature-branch commits themselves are the permanent record — keep
each one clean per the commit-message rules above.

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

## Verification

Run these before pushing a branch:

```
npm run check    # syntax check across src/ and test/
npm test         # full test suite
```

`npm run check` uses `node --check` per file — no lint config, just
catches syntax errors. `npm test` uses Node's built-in test runner
(`node --test`) — zero new dependencies.

Tests live under `test/`, mirroring the source tree
(`test/qpilot/...`, `test/tools/...`). Each test file imports
`test/_helpers/test-env.js` at the top to set the QPILOT_* env vars
to deterministic test values before any other module loads. Tests
that touch SQLite use the isolated `data/qpilot-site-test.db` file
and call `resetTestDb()` in a `beforeEach` hook so each test starts
clean.

When adding a new mutation tool, add at minimum:

- A unit test for any pure helper extracted from the mutation
  (date coercion, body merging, body validation, etc.).
- An `auditedMutation` flow test if the mutation uses a non-trivial
  `filterCapturedKeys` shape or a custom `extractObjectId` /
  `extractLastModifiedAt` callback.
- A drift test (`assertNoDrift` is exported from
  `src/qpilot/scheduled_orders/rollback.js` for this purpose) if the
  rollback path has interesting precondition logic.

Live smoke testing against real QPilot remains the canonical
end-to-end verification for new mutation tools. The unit/integration
tests cover the audit and rollback plumbing — they do not replace a
live smoke test.

## QPilot reference discipline

Before adding or changing any QPilot HTTP call, fetch the specific endpoint's
reference page from `https://docs.qpilot.cloud/reference/` and verify the
exact query parameters and request body shape. The reference index page only
lists routes and methods — it does not document parameters. Guessing
parameter names from the index has bitten this codebase before.
