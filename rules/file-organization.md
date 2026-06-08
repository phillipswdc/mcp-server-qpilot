# File Organization Rules

## File Size

Target file length: 250 lines or fewer.

Maximum normal file length: 400 lines.

When a file approaches 400 lines, look for a natural split:

- Separate UI, state, data access, and validation.
- Move reusable logic into focused helpers.
- Move types or schemas when they are shared across modules.
- Move test fixtures into dedicated fixture files.
- Split large tests by behavior.

Do not create tiny fragmented files that make the code harder to follow. A cohesive 320-line file is better than six confusing 50-line files.

## Acceptable Exceptions

The 400-line limit does not normally apply to:

- Generated files.
- Lockfiles.
- Database migrations.
- Schema snapshots.
- Large test fixtures.
- Translation catalogs.
- Vendor files.
- Framework-required configuration files.

When an exception is intentional, add a short note near the top of the file or in the related pull request.

## Naming

- Use names that describe responsibility.
- Avoid vague names such as `utils`, `helpers`, `common`, `misc`, or `stuff` unless the project already has a clear convention.
- Prefer domain-specific names such as `invoiceTotals`, `authSession`, or `userPermissions`.
- Keep file names stable unless renaming improves clarity.

## Suggested File Naming

- Markdown docs: `kebab-case.md`.
- General source files: follow the language or framework convention.
- React components: `PascalCase.tsx` or the existing project convention.
- Tests: match the file under test when possible, such as `billing-service.test.ts`.
- Fixtures: include the behavior or scenario, such as `expired-session.fixture.ts`.

## Module Boundaries

- Keep feature code close to the feature.
- Keep shared code genuinely shared.
- Avoid importing deeply across unrelated features.
- Do not create circular dependencies.
- Keep infrastructure code separate from domain logic when practical.
