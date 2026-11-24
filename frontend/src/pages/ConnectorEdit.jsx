import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '../api.js';
import { Card, ErrorBox, Field, Loading, Page } from '../components.jsx';

const HELP = {
  github: 'Classic PAT scopes: repo, read:org (admin:org read for 2FA/base-permission controls). Fine-grained: Administration, Metadata, Contents, Custom properties (read) on all repositories, plus Members (read) on the organization.',
  ado: 'PAT scopes: Code (Read), Project and Team (Read), Member Entitlement Management (Read) for organization members. Policies are read through Code (Read).',
};

export default function ConnectorEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!id) { setForm({ name: '', provider: 'github', pat: '', schedule_minutes: 360, enabled: true, config: { org: '', apiUrl: '', repoFilter: '', includeArchived: true, collectAccess: true } }); return; }
    get(`/api/connectors/${id}`).then((c) => setForm({ name: c.name, provider: c.provider, pat: '', schedule_minutes: c.schedule_minutes, enabled: c.enabled, config: c.config })).catch(setError);
  }, [id]);

  if (!form) return <Page title="Connector"><ErrorBox error={error} /><Loading /></Page>;
  const cfg = form.config;
  const setCfg = (patch) => setForm({ ...form, config: { ...cfg, ...patch } });
  const setProvider = (provider) => setForm({ ...form, provider, config: provider === 'github' ? { org: '', includeArchived: true, collectAccess: true } : { organization: '' } });
  const cleanCfg = () => Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== '' && v !== null && v !== undefined));

  const runTest = async () => {
    setTest({ pending: true });
    try {
      setTest(id && !form.pat ? await post(`/api/connectors/${id}/test`) : await post('/api/connectors/test', { provider: form.provider, config: cleanCfg(), pat: form.pat }));
    } catch (err) { setTest({ ok: false, detail: err.message }); }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name: form.name, schedule_minutes: Number(form.schedule_minutes), enabled: form.enabled, config: cleanCfg(), ...(form.pat ? { pat: form.pat } : {}) };
    try {
      if (id) { await put(`/api/connectors/${id}`, body); navigate(`/connectors/${id}`); }
      else { const c = await post('/api/connectors', { ...body, provider: form.provider }); setCreated(c); }
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  if (created) {
    return (
      <Page title="Connector created" crumbs={[{ to: '/connectors', label: 'Connectors' }, { label: created.name }]}>
        <Card>
          <p>The first full collection has been queued. To get changes in near real time, configure a webhook in {created.provider === 'github' ? 'GitHub' : 'Azure DevOps'}:</p>
          <div className="muted small">Payload URL</div><pre className="code-inline">{created.webhook_url}</pre>
          <div className="muted small">Secret (you can reveal it again later)</div><pre className="code-inline">{created.webhook_secret}</pre>
          <div className="form-actions"><button type="button" className="btn primary" onClick={() => navigate(`/connectors/${created.id}`)}>Go to connector</button></div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title={id ? `Edit ${form.name}` : 'Add connector'} crumbs={[{ to: '/connectors', label: 'Connectors' }, { label: id ? form.name : 'New' }]}>
      <form onSubmit={save}>
        <Card>
          <div className="form-grid">
            <Field label="Provider">
              <select value={form.provider} disabled={Boolean(id)} onChange={(e) => setProvider(e.target.value)}>
                <option value="github">GitHub</option>
                <option value="ado">Azure DevOps</option>
              </select>
            </Field>
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Schedule (minutes)" hint="Full collection interval, minimum 5"><input type="number" min="5" max="10080" value={form.schedule_minutes} onChange={(e) => setForm({ ...form, schedule_minutes: e.target.value })} /></Field>
          </div>
          {form.provider === 'github' ? (
            <div className="form-grid">
              <Field label="Organization or user"><input value={cfg.org || ''} onChange={(e) => setCfg({ org: e.target.value })} required /></Field>
              <Field label="API URL" hint="GitHub Enterprise Server: https://host/api/v3"><input placeholder="https://api.github.com" value={cfg.apiUrl || ''} onChange={(e) => setCfg({ apiUrl: e.target.value })} /></Field>
              <Field label="Repository filter (regex)"><input value={cfg.repoFilter || ''} onChange={(e) => setCfg({ repoFilter: e.target.value })} /></Field>
            </div>
          ) : (
            <div className="form-grid">
              <Field label="Organization"><input value={cfg.organization || ''} onChange={(e) => setCfg({ organization: e.target.value })} required /></Field>
              <Field label="Base URL" hint="Azure DevOps Server: https://host/tfs"><input placeholder="https://dev.azure.com" value={cfg.baseUrl || ''} onChange={(e) => setCfg({ baseUrl: e.target.value })} /></Field>
              <Field label="Project filter (regex)"><input value={cfg.projectFilter || ''} onChange={(e) => setCfg({ projectFilter: e.target.value })} /></Field>
            </div>
          )}
          {form.provider === 'github' && (
            <div className="checks">
              <label className="check"><input type="checkbox" checked={cfg.includeArchived !== false} onChange={(e) => setCfg({ includeArchived: e.target.checked })} /> Include archived repositories</label>
              <label className="check"><input type="checkbox" checked={cfg.collectAccess !== false} onChange={(e) => setCfg({ collectAccess: e.target.checked })} /> Collect collaborators &amp; teams (2 extra calls per repo)</label>
            </div>
          )}
          <Field label={id ? 'Personal access token (leave empty to keep current)' : 'Personal access token'} hint={HELP[form.provider]}>
            <input type="password" autoComplete="off" value={form.pat} onChange={(e) => setForm({ ...form, pat: e.target.value })} required={!id} />
          </Field>
          <label className="check inline"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
          <div className="test-row">
            <button type="button" className="btn ghost" onClick={runTest} disabled={!id && !form.pat}>Test connection</button>
            {test && (test.pending ? <span className="muted">Testing…</span> : <span className={test.ok ? 't-pass' : 't-fail'}>{test.ok ? '✓ ' : '✗ '}{test.detail}</span>)}
          </div>
        </Card>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : id ? 'Save' : 'Create & collect'}</button>
        </div>
      </form>
    </Page>
  );
}
