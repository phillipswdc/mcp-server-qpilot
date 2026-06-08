# Security Rules

## Secret Handling

- Never commit secrets, credentials, tokens, certificates, private keys, or production `.env` values.
- Never print secrets in logs, errors, screenshots, telemetry, or test output.
- Use environment variables or secret managers for sensitive configuration.
- Provide safe examples such as `.env.example` with fake values only.

## Input Validation

- Treat all user input, request data, files, webhooks, CLI arguments, and third-party API responses as untrusted.
- Validate type, shape, length, range, and allowed values at boundaries.
- Reject invalid input early.
- Normalize input before comparison when appropriate.

## Authorization

- Enforce authorization on the server side.
- Do not rely on hidden UI controls as a security boundary.
- Check ownership and tenant boundaries for every protected resource.
- Default to deny when permissions are unclear.

## Injection Prevention

- Use parameterized database queries or safe ORM APIs.
- Do not build SQL, shell commands, HTML, JSON, LDAP, or regular expressions from raw untrusted strings.
- Escape output for the target context.
- Avoid unsafe deserialization.

## Web Security

- Use secure cookies for session data.
- Protect state-changing requests from CSRF where applicable.
- Keep CORS narrow.
- Use a restrictive Content Security Policy when the project supports it.
- Do not store sensitive tokens in browser-accessible persistent storage unless there is a clear security design.

## Logging

- Log enough context to debug failures.
- Redact secrets, credentials, tokens, PII, and sensitive business data.
- Avoid logging full request bodies by default.

## Dependencies and Supply Chain

- Keep dependencies current.
- Review new dependencies for maintenance quality, license compatibility, and security history.
- Do not disable audit, lockfile, signature, or integrity checks to bypass failures.
