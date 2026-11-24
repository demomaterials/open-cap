// HTTP client for provider APIs: retries, GitHub/ADO rate limits, call counting.
import { log } from '../common/log.js';
import { sleep } from '../common/util.js';

export class ApiError extends Error {
  constructor(status, message, url) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

const MAX_RATE_WAIT_MS = 15 * 60 * 1000;

export function createClient({ headers, counter = { calls: 0 }, userAgent = 'open-cap-collector' }) {
  async function request(url, { method = 'GET', body, accept = [200], retries = 4 } = {}) {
    for (let attempt = 0; ; attempt++) {
      counter.calls++;
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { 'user-agent': userAgent, accept: 'application/json', ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(60_000),
          redirect: 'follow',
        });
      } catch (err) {
        if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
        throw new ApiError(0, `network error: ${err.message}`, url);
      }

      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      const retryAfter = res.headers.get('retry-after');
      const rateLimited = res.status === 429 || ((res.status === 403) && remaining === '0');
      if (rateLimited && attempt < retries) {
        let waitMs = retryAfter ? Number(retryAfter) * 1000 : 60_000;
        if (remaining === '0' && reset) waitMs = Math.max(1000, Number(reset) * 1000 - Date.now() + 1000);
        if (waitMs > MAX_RATE_WAIT_MS) throw new ApiError(res.status, `rate limited for ${Math.round(waitMs / 60000)} min`, url);
        log.warn('rate limited; waiting', { url, waitMs });
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500 && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }

      const text = await res.text();
      let json = null;
      if (text) { try { json = JSON.parse(text); } catch { json = null; } }
      if (!accept.includes(res.status)) {
        // ADO answers an expired PAT with a 203 HTML sign-in page.
        const msg = json?.message || (res.status === 203 ? 'authentication failed (PAT rejected)' : text.slice(0, 200));
        throw new ApiError(res.status, `${res.status} ${msg}`.trim(), url);
      }
      return { status: res.status, json, headers: res.headers };
    }
  }
  return { request, counter };
}

/** Wrap an optional enrichment call: returns [value, errorMessage]. */
export async function attempt(fn) {
  try {
    return [await fn(), null];
  } catch (err) {
    return [null, err.message];
  }
}
