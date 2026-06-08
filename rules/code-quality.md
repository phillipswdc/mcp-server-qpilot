# Code Quality Rules

## Principles

- Optimize for readability, correctness, and maintainability.
- Prefer straightforward code over cleverness.
- Keep modules focused on one responsibility.
- Make invalid states hard to represent when the language supports it.
- Keep public interfaces small and stable.

## Functions

- Keep functions short enough to understand without scrolling.
- Give each function one clear responsibility.
- Prefer early returns when they reduce nesting.
- Avoid boolean parameters that radically change behavior.
- Avoid hidden side effects in functions that appear to be pure.
- Do not use broad catch-all utilities as dumping grounds.

## Types and Data

- Use strong types, schemas, or validators at system boundaries.
- Prefer structured data over loosely shaped dictionaries when contracts matter.
- Avoid `any`, unchecked casts, or dynamic access unless isolated and justified.
- Keep transformation logic close to the boundary where data shape changes.

## Error Handling

- Handle expected errors deliberately.
- Let unexpected errors fail loudly enough to diagnose.
- Include useful context in errors without exposing secrets.
- Do not use empty `catch` blocks.
- Do not convert real failures into false success states.

## Dependencies

- Add dependencies only when they reduce meaningful complexity.
- Prefer well-maintained libraries with compatible licenses.
- Avoid duplicate libraries that solve the same problem.
- Do not add a dependency for trivial logic.

## Comments

- Write comments to explain why, not what.
- Remove stale comments.
- Avoid large commented-out code blocks.
- Use documentation comments for public APIs when the project style supports them.
