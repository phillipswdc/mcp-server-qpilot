# AI Agent Coding Directives

These instructions apply to every AI coding agent working in this repository.

## Mission

Write production-quality code that is secure, maintainable, testable, and easy for humans to review. Prefer boring, proven solutions over clever abstractions.

## Project Memory

This repository is an MCP server wrapping the QPilot API. Many behaviors of that API are not in its public reference — they were discovered through live probing and recorded as project memory.

If your agent host loads a project memory file (Claude Code stores it at `~/.claude/projects/<project-slug>/memory/MEMORY.md`), **read the index there before assuming the QPilot API or this codebase behaves as documented elsewhere**. Memory entries are keyed by topic — start with anything matching `qpilot_*` when touching QPilot integration code.

If memory is not available to your session, do not assume the public QPilot reference is complete. Prefer live probing over assumption — QPilot's documented routes routinely omit error codes (e.g. snooze 1010 for missing site feature flag), reject formats the reference does not warn about (precision-strict timestamps), and have status-transition constraints not listed anywhere. When you discover such a behavior, capture it in `CONTRIBUTING.md`, a commit body, or the project's eventual `docs/qpilot-quirks.md` so the next agent does not re-discover it.

## Repository Conventions

Branching, commit-message format, scope vocabulary (`so`, `customers`, `chore`, …), merge style, and PR-description requirements are defined in [`CONTRIBUTING.md`](CONTRIBUTING.md). Read it before your first commit on this repository — the conventions there are project-specific and not derivable from generic best practice.

The mutation safety rule there (every write to QPilot routes through `auditedMutation` or has a documented reason it does not) is enforced at PR review; landing a non-audited mutation without justification is a blocker.

When adding, modifying, or reviewing an MCP tool, read [`rules/mcp-tools.md`](rules/mcp-tools.md). It codifies the project's tool-naming convention, description structure, zod `.describe()` discipline, audit routing, rollback registration, smoke-test marking, and response shape — concerns the generic rules in [`rules/code-quality.md`](rules/code-quality.md) etc. do not cover.

## Required Behavior

- Read the surrounding code before editing.
- Preserve existing architecture and conventions unless there is a clear defect or explicit request to change them.
- Make the smallest complete change that solves the problem.
- Keep files small, focused, and named clearly.
- Verify changes with the most relevant available tests, linters, or type checks.
- Explain any verification that could not be run.

## Hard Guardrails

- Do not commit secrets, tokens, credentials, private keys, or `.env` values.
- Do not disable security checks, tests, linters, or type checks to make work pass.
- Do not swallow errors with empty `catch` blocks or broad silent failure handling.
- Do not introduce global mutable state unless it is clearly required and isolated.
- Do not add dependencies without a clear need and project-compatible license.
- Do not create files that grow beyond 400 lines unless there is a documented reason.
- Do not perform large unrelated refactors while solving a narrow task.
- Do not add AI-generated co-author or attribution trailers to commit messages. No `Co-Authored-By: Claude ...`, no `🤖 Generated with [Claude Code]`, no equivalent from any other AI tool. See `CONTRIBUTING.md` § *No AI-generated trailers* for the full rule and rationale.

## File Size Rule

Target file length: 250 lines or fewer.

Maximum normal file length: 400 lines.

If a file would exceed 400 lines, split it by responsibility. Reasonable exceptions include generated files, lockfiles, schema snapshots, migrations, fixtures, and intentionally centralized configuration. Do not split files into useless fragments only to satisfy a number.

## Naming Rule

Use names that describe purpose, not implementation trivia.

- Files: `kebab-case` for docs and config-oriented project files unless the ecosystem requires another convention.
- Components/classes/types: `PascalCase`.
- Functions, variables, and methods: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` only for true constants.
- Tests: name after the behavior or module under test.

## Quality Rule

Code must be clear on first read. Prefer explicit conditionals, narrow functions, typed data, and obvious boundaries. Avoid clever one-liners, hidden side effects, and broad utility modules that become dumping grounds.

## Security Rule

Treat all external input as untrusted. Validate, sanitize, authorize, and log carefully. Never expose secrets in logs, errors, frontend bundles, or test fixtures.

## Testing Rule

Behavior changes require test coverage at the right level. Prefer focused unit tests for logic, integration tests for boundaries, and end-to-end tests only for critical user workflows.

## Documentation Rule

Update documentation when behavior, setup, configuration, public APIs, or operational expectations change. Keep documentation concise and accurate.
