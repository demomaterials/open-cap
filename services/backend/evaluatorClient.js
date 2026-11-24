import { config } from '../common/config.js';
import { HttpError } from '../common/http.js';

export async function callEvaluator(path, body) {
  let res;
  try {
    res = await fetch(`${config.evaluatorUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new HttpError(503, `evaluator unavailable: ${err.message}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 400 ? 400 : 502, json.error || `evaluator returned ${res.status}`);
  return json;
}
