/**
 * Thin QPilot HTTP client. There is no published QPilot SDK on npm, so we
 * own the transport layer here. Domain modules call `qpilotRequest` rather
 * than building fetch options themselves.
 *
 * Auth: `Authorization: Basic <token>`. The token is already pre-encoded
 * in env (see config/env.js), so we don't base64-encode it again.
 */
import { authHeader, env } from "../config/env.js";
import { REQUEST_TIMEOUT_MS } from "../config/constants.js";

/**
 * QPilot API error. Surfaces HTTP status and parsed error body for callers
 * (the retry helper uses `.status`; tool error handlers use `.message`).
 */
export class QpilotApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} body
   * @param {Record<string,string>} [headers]
   */
  constructor(message, status, body, headers) {
    super(message);
    this.name = "QpilotApiError";
    this.status = status;
    this.body = body;
    this.headers = headers ?? {};
  }
}

/**
 * Issue a request to the QPilot API.
 *
 * @param {object} options
 * @param {string} options.path Path under the base URL (leading slash optional)
 * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} [options.method="GET"]
 * @param {Record<string,string|number|boolean|undefined>} [options.query] Querystring params (undefined values dropped)
 * @param {object} [options.body] JSON body (will be stringified)
 * @param {AbortSignal} [options.signal] Caller-supplied abort signal
 * @returns {Promise<unknown>} Parsed JSON response, or null for 204
 */
export async function qpilotRequest({
  path,
  method = "GET",
  query,
  body,
  signal,
}) {
  const url = buildUrl(path, query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const headers = Object.fromEntries(response.headers.entries());
  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    // Include the full response body verbatim so callers and the audit log
    // see exactly what QPilot reported — message/error/title alone discard
    // validation arrays and typed result codes that ship in other keys.
    const summary = `${method} ${url} failed with status ${response.status}`;
    const message = text ? `${summary}: ${text}` : summary;
    throw new QpilotApiError(message, response.status, parsed ?? text, headers);
  }

  return parsed;
}

/**
 * Build a path scoped to the active site. Almost every QPilot endpoint sits
 * under `/Sites/{siteId}/…`, so resource modules call this rather than
 * repeating the literal site segment.
 *
 * @param {string} suffix Path under the site (leading slash optional)
 * @returns {string} Full path starting with `/Sites/{siteId}…`
 */
export function sitePath(suffix) {
  const clean = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/Sites/${env.siteId}${clean}`;
}

function buildUrl(path, query) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${env.baseUrl}${cleanPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      // ASP.NET-style binding expects repeated keys for array params
      // (?statusNames=Active&statusNames=Paused). The default URL.searchParams
      // .set with a stringified array would produce a single comma-joined
      // value which QPilot silently treats as one unmatched status string.
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null) continue;
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
