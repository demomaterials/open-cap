// Client for the OPA sidecar (opa run --server on localhost).
import { buildModule, packagePath, policyId } from './policy.js';

const OPA_URL = process.env.OPA_URL || 'http://127.0.0.1:8181';
const TIMEOUT_MS = Number(process.env.OPA_TIMEOUT_MS || 5000);

async function call(method, path, body, contentType = 'application/json') {
  const res = await fetch(`${OPA_URL}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': contentType } : {},
    body: body === undefined ? undefined : (contentType === 'application/json' ? JSON.stringify(body) : body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const textBody = await res.text();
  let json = null;
  try { json = textBody ? JSON.parse(textBody) : null; } catch { json = { message: textBody }; }
  return { status: res.status, json };
}

function formatErrors(json) {
  if (!json) return ['unknown OPA error'];
  if (Array.isArray(json.errors) && json.errors.length) {
    return json.errors.map((e) => (e.location ? `line ${e.location.row}:${e.location.col}: ${e.message}` : e.message));
  }
  return [json.message || 'unknown OPA error'];
}

export async function healthy() {
  try {
    const { status } = await call('GET', '/health');
    return status === 200;
  } catch {
    return false;
  }
}

/** Upload a control's policy. Returns { ok: true } or { ok: false, errors: [...] }. */
export async function putPolicy(controlId, rego) {
  const built = buildModule(controlId, rego);
  if (built.error) return { ok: false, errors: [built.error] };
  const { status, json } = await call('PUT', `/v1/policies/${policyId(controlId)}`, built.module, 'text/plain');
  if (status === 200) return { ok: true };
  return { ok: false, errors: formatErrors(json) };
}

export async function deletePolicy(controlId) {
  await call('DELETE', `/v1/policies/${policyId(controlId)}`).catch(() => {});
}

export async function evaluate(controlId, input) {
  const { status, json } = await call('POST', `/v1/data/${packagePath(controlId)}`, { input });
  if (status !== 200) {
    const err = new Error(formatErrors(json).join('; '));
    err.opa = true;
    throw err;
  }
  return json.result;
}

export async function policyExists(id) {
  const { status } = await call('GET', `/v1/policies/${id}`);
  return status === 200;
}

export async function putRaw(id, module) {
  const { status, json } = await call('PUT', `/v1/policies/${id}`, module, 'text/plain');
  return status === 200 ? { ok: true } : { ok: false, errors: formatErrors(json) };
}
