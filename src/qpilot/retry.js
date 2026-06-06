/**
 * Retry helper for transient QPilot HTTP failures (429 + 5xx).
 *
 * Wait between attempts honors the `Retry-After` header (seconds) when
 * present, otherwise uses exponential backoff starting at 500ms.
 */
import { DEFAULT_RETRY_ATTEMPTS } from "../config/constants.js";

/**
 * Execute `fn`, retrying on transient failures up to `retries` times.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [retries]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, retries = DEFAULT_RETRY_ATTEMPTS) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      const transient = status === 429 || (status >= 500 && status < 600);
      if (!transient || attempt >= retries) throw err;
      const retryAfter = Number(err?.headers?.["retry-after"]);
      const wait = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : 500 * Math.pow(2, attempt);
      await sleep(wait);
      attempt += 1;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
