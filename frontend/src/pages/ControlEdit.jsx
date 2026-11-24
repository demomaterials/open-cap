import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, put, qs } from '../api.js';
import { Card, CodeEditor, ErrorBox, Field, JsonView, Loading, Page, Status } from '../components.jsx';

const TEMPLATE = `package cap

# input is the asset definition JSON:
#   input.type, input.name, input.owner, input.members
#   input.data     – the provider API object (e.g. GET /repos/{owner}/{repo})
#   input.related  – extra API responses (branch_protection, policies, …)
#   input.errors   – enrichment calls that failed, keyed by name
#
# Decide with any of:
#   pass        (boolean)  the asset complies
#   violations  (set)      reasons; non-empty means fail
#   skip        (boolean)  not applicable – excluded from the score
#   skip_reason (string)

default pass := false

pass if {
	input.owner != null
}

violations contains "Asset has no owner" if not pass
`;

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export default function ControlEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [types, setTypes] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
  const [testAssets, setTestAssets] = useState([]);
  const [testAsset, setTestAsset] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testDefinition, setTestDefinition] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [t, f] = await Promise.all([get('/api/asset-types'), get('/api/frameworks')]);
        setTypes(t.items);
        setFrameworks(f.items);
        if (id) {
          const c = await get(`/api/controls/${id}`);
          setForm({
            key: c.key, name: c.name, description: c.description || '', remediation: c.remediation || '', severity: c.severity,
            asset_types: c.asset_types, rego: c.rego, enabled: c.enabled, frameworks: c.frameworks.map((x) => ({ id: x.id, reference: x.reference })),
          });
        } else {
          setForm({ key: '', name: '', description: '', remediation: '', severity: 'medium', asset_types: [], rego: TEMPLATE, enabled: true, frameworks: [] });
        }
      } catch (err) { setError(err); }
    })();
  }, [id]);

  // Offer assets of the selected types for testing.
  const typeKey = form?.asset_types.join(',');
  useEffect(() => {
    if (!form || form.asset_types.length === 0) { setTestAssets([]); return; }
    Promise.all(form.asset_types.map((t) => get(`/api/assets${qs({ type: t, limit: 100 })}`)))
      .then((rs) => {
        const items = rs.flatMap((r) => r.items);
        setTestAssets(items);
        if (!items.find((a) => a.id === testAsset)) setTestAsset(items[0]?.id || '');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey]);

  useEffect(() => {
    if (!testAsset) { setTestDefinition(null); return; }
    get(`/api/assets/${testAsset}`).then((a) => setTestDefinition(a.definition)).catch(() => setTestDefinition(null));
  }, [testAsset]);

  if (!form) return <Page title="Control"><ErrorBox error={error} /><Loading /></Page>;

  const toggleType = (t) => setForm({ ...form, asset_types: form.asset_types.includes(t) ? form.asset_types.filter((x) => x !== t) : [...form.asset_types, t] });
  const inFw = (fid) => form.frameworks.some((f) => f.id === fid);
  const toggleFw = (fid) => setForm({ ...form, frameworks: inFw(fid) ? form.frameworks.filter((f) => f.id !== fid) : [...form.frameworks, { id: fid, reference: null }] });

  const validate = async () => {
    setValidation(null);
    try { setValidation(await post('/api/controls/validate', { rego: form.rego })); } catch (err) { setValidation({ ok: false, errors: [err.message] }); }
  };
  const runTest = async () => {
    setTestResult(null);
    try { setTestResult(await post('/api/controls/test', { rego: form.rego, asset_id: testAsset })); } catch (err) { setTestResult({ status: 'error', reasons: [err.message] }); }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = id ? await put(`/api/controls/${id}`, form) : await post('/api/controls', form);
      navigate(`/controls/${c.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Page title={id ? `Edit ${form.key}` : 'New control'} crumbs={[{ to: '/controls', label: 'Controls' }, { label: id ? form.key : 'New' }]}>
      <form onSubmit={save}>
        <Card title="Definition">
          <div className="form-grid">
            <Field label="Key" hint="Unique, e.g. GH-REPO-10"><input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required /></Field>
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Severity">
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Remediation"><textarea rows={2} value={form.remediation} onChange={(e) => setForm({ ...form, remediation: e.target.value })} /></Field>
          <Field label="Applies to asset types" hint="The control is evaluated against every active asset of these types.">
            <div className="checks">
              {types.map((t) => (
                <label key={t.type} className={`check ${form.asset_types.includes(t.type) ? 'on' : ''}`}>
                  <input type="checkbox" checked={form.asset_types.includes(t.type)} onChange={() => toggleType(t.type)} />
                  {t.display_name} <span className="muted small">({t.asset_count})</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Frameworks">
            <div className="checks">
              {frameworks.map((f) => (
                <label key={f.id} className={`check ${inFw(f.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={inFw(f.id)} onChange={() => toggleFw(f.id)} /> {f.name}
                </label>
              ))}
              {frameworks.length === 0 && <span className="muted small">No frameworks yet. <Link to="/frameworks/new">Create one</Link>.</span>}
            </div>
          </Field>
          <label className="check inline"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
        </Card>

        <div className="grid two editor-grid">
          <Card title="Rego" actions={<button type="button" className="btn small ghost" onClick={validate}>Validate</button>}>
            <CodeEditor value={form.rego} onChange={(rego) => { setForm({ ...form, rego }); setValidation(null); }} />
            {validation && (validation.ok
              ? <div className="notice good">Compiles.</div>
              : <div className="error-box"><ul>{validation.errors.map((x, i) => <li key={i}><code>{x}</code></li>)}</ul></div>)}
            <p className="muted small">See <code>docs/controls.md</code> for the full input reference. <code>http.send</code> and other network built-ins are blocked.</p>
          </Card>
          <Card title="Test against an asset" actions={<button type="button" className="btn small" disabled={!testAsset} onClick={runTest}>Run test</button>}>
            {form.asset_types.length === 0 ? <p className="muted">Pick asset types first.</p> : testAssets.length === 0 ? <p className="muted">No assets of the selected types yet.</p> : (
              <select className="block" value={testAsset} onChange={(e) => { setTestAsset(e.target.value); setTestResult(null); }}>
                {testAssets.map((a) => <option key={a.id} value={a.id}>{a.type} · {a.name}</option>)}
              </select>
            )}
            {testResult && (
              <div className="test-result">
                <Status s={testResult.status} />
                {testResult.reasons?.length > 0 && <ul className="small">{testResult.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                {testResult.raw && <><div className="muted small">Policy output</div><JsonView value={testResult.raw} maxHeight={160} /></>}
              </div>
            )}
            {testDefinition && <><div className="muted small spaced">Input (asset definition)</div><JsonView value={testDefinition} maxHeight={420} /></>}
          </Card>
        </div>

        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn primary" disabled={busy || form.asset_types.length === 0}>{busy ? 'Saving…' : 'Save control'}</button>
        </div>
      </form>
    </Page>
  );
}
