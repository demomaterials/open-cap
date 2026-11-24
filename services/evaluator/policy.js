// Turning a control's Rego into an OPA module, and an OPA result into a status.
//
// Rego contract for control authors (documented in docs/controls.md):
//   pass        boolean  – the asset complies
//   violations  set      – human-readable failure reasons (non-empty ⇒ fail)
//   skip        boolean  – control does not apply to this asset (excluded from score)
//   skip_reason string   – shown for skipped results
// The input document is the asset definition: { type, name, owner, members, data, related, errors, ... }.

const FORBIDDEN = /\b(http\.send|net\.lookup_ip_addr|opa\.runtime|rego\.parse_module|time\.now_ns)\b/;
const PACKAGE_RE = /^[ \t]*package[ \t]+[^\n]*$/m;

export function packagePath(controlId) {
  return `cap/controls/c_${String(controlId).replace(/-/g, '')}`;
}

export function policyId(controlId) {
  return `cap_c_${String(controlId).replace(/-/g, '')}`;
}

/** Returns { module } or { error } */
export function buildModule(controlId, rego) {
  if (typeof rego !== 'string' || !rego.trim()) return { error: 'rego is empty' };
  if (rego.length > 100_000) return { error: 'rego is too large (max 100 KB)' };
  const forbidden = rego.match(FORBIDDEN);
  if (forbidden) return { error: `built-in '${forbidden[1]}' is not allowed in controls (non-deterministic or network access)` };
  const pkg = `package ${packagePath(controlId).replace(/\//g, '.')}`;
  // Replace the author's package line in place so error line numbers still match the editor.
  const module = PACKAGE_RE.test(rego) ? rego.replace(PACKAGE_RE, pkg) : `${pkg}\n${rego}`;
  return { module };
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function text(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Map the policy's document to { status, reasons }. */
export function interpret(result) {
  if (result === undefined || result === null || typeof result !== 'object') {
    return { status: 'error', reasons: ['Policy produced no result (is the package/rule definition correct?)'] };
  }
  if (result.skip === true) {
    return { status: 'skip', reasons: asList(result.skip_reason ?? 'Control is not applicable to this asset').map(text) };
  }
  const violations = asList(result.violations).map(text);
  if (violations.length > 0) return { status: 'fail', reasons: violations };
  if (typeof result.pass === 'boolean') {
    return result.pass ? { status: 'pass', reasons: [] } : { status: 'fail', reasons: ['Control condition not met'] };
  }
  if (Array.isArray(result.violations)) return { status: 'pass', reasons: [] };
  return { status: 'error', reasons: ['Policy defines neither `pass` nor `violations`'] };
}
