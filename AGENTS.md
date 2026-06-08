# AI Agent Coding Directives

These instructions apply to every AI coding agent working in this repository.

## Mission

Write production-quality code that is secure, maintainable, testable, and easy for humans to review. Prefer boring, proven solutions over clever abstractions.

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
