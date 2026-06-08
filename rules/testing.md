# Testing Rules

## Expectations

- Add or update tests when behavior changes.
- Prefer focused tests that prove the important behavior.
- Cover edge cases, failure paths, and security-sensitive branches.
- Keep tests deterministic.
- Avoid tests that depend on execution order.

## Test Levels

- Use unit tests for pure logic and small modules.
- Use integration tests for database, API, filesystem, queue, and service boundaries.
- Use end-to-end tests for critical user workflows.
- Do not use end-to-end tests as the only coverage for complex business logic.

## Test Quality

- Test behavior, not implementation details.
- Use clear test names that describe the expected behavior.
- Keep fixtures realistic but minimal.
- Avoid excessive mocks when a real boundary test is practical.
- Do not snapshot large unstable output unless it is the clearest contract.

## Verification

Before finishing a coding task, run the most relevant available checks:

- Formatter.
- Linter.
- Type checker.
- Unit tests.
- Integration or end-to-end tests for affected workflows.

If a check cannot be run, state why and identify the remaining risk.

## Failing Tests

- Do not ignore failing tests.
- Do not delete failing tests unless they are obsolete and replaced by better coverage.
- Do not weaken assertions just to make tests pass.
- If unrelated tests fail, report them clearly.
