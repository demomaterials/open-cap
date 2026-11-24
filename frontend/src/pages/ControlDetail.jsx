import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, get, post, put, qs } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, CodeEditor, Counts, Empty, ErrorBox, Loading, Page, Pager, ScoreRing, Sev, Status, Tabs, TypeChips } from '../components.jsx';
import { ago, dt } from '../format.js';

const LIMIT = 50;

export default function ControlDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'fail';
  const tab = params.get('tab') || 'results';
  const offset = Number(params.get('offset') || 0);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);

  const control = useLoad(() => get(`/api/compliance/controls/${id}`), [id], { poll: 20_000 });
  const results = useLoad(
    () => get(`/api/compliance/controls/${id}/results${qs({ status, limit: LIMIT, offset, q: params.get('q') })}`),
    [id, status, offset, params.get('q')], { poll: 20_000 });

  const set = (patch) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') n.delete(k); else n.set(k, v); }
    setParams(n);
  };

  if (control.error && !control.data) return <Page title="Control"><ErrorBox error={control.error} /></Page>;
  if (!control.data) return <Page title="Control"><Loading /></Page>;
  const c = control.data;
  const t = c.totals;

  const toggle = async () => {
    await put(`/api/controls/${id}`, { enabled: !c.enabled });
    control.reload();
  };
  const reevaluate = async () => {
    await post(`/api/controls/${id}/evaluate`);
    setMsg('Re-evaluation queued for every applicable asset.');
  };
  const remove = async () => {
    if (!window.confirm(`Delete control ${c.key}? Its results are removed.`)) return;
    await del(`/api/controls/${id}`);
    navigate('/controls');
  };

  return (
    <Page title={<>{c.key} <Sev s={c.severity} /></>} subtitle={c.name}
      crumbs={[{ to: '/controls', label: 'Controls' }, { label: c.key }]}
      actions={can(user, 'editor') && (
        <>
          <button type="button" className="btn ghost" onClick={reevaluate}>Re-evaluate</button>
          <button type="button" className="btn ghost" onClick={toggle}>{c.enabled ? 'Disable' : 'Enable'}</button>
          <Link className="btn" to={`/controls/${id}/edit`}>Edit</Link>
          <button type="button" className="btn danger ghost" onClick={remove}>Delete</button>
        </>
      )}>
      {msg && <div className="notice">{msg}</div>}
      {c.compile_error && <div className="error-box"><strong>The Rego does not compile; all results are errors.</strong><pre>{c.compile_error}</pre></div>}
      <div className="grid hero">
        <Card className="hero-card">
          <div className="hero-body">
            <ScoreRing score={t.score} />
            <div className="hero-side">
              <Counts c={t} active={tab === 'results' ? status : null} onPick={(s) => set({ status: s, offset: null, tab: null })} />
              <p className="muted small">{t.total} applicable assets{!c.enabled && ' · control is disabled and excluded from all scores'}</p>
            </div>
          </div>
        </Card>
        <Card title="About">
          <dl className="dl">
            <dt>Applies to</dt><dd><TypeChips types={c.asset_types} /></dd>
            <dt>Frameworks</dt><dd>{c.frameworks.length ? c.frameworks.map((f) => <Link key={f.id} className="chip link" to={`/frameworks/${f.id}`}>{f.key}{f.reference && ` ${f.reference}`}</Link>) : '—'}</dd>
            <dt>Version</dt><dd>v{c.version} · updated {ago(c.updated_at)}</dd>
          </dl>
          {c.description && <p>{c.description}</p>}
          {c.remediation && <><h3>Remediation</h3><p className="small">{c.remediation}</p></>}
        </Card>
      </div>

      <Tabs active={tab === 'rego' ? 'rego' : status} onChange={(k) => (k === 'rego' ? set({ tab: 'rego' }) : set({ status: k, tab: null, offset: null }))}
        tabs={[
          { key: 'fail', label: 'Failing', count: t.fail, className: 't-fail' },
          { key: 'pass', label: 'Passing', count: t.pass, className: 't-pass' },
          { key: 'skip', label: 'Skipped', count: t.skip, className: 't-skip' },
          { key: 'error', label: 'Errors', count: t.error, className: 't-error' },
          { key: 'pending', label: 'Pending', count: t.pending },
          { key: 'rego', label: 'Rego' },
        ]} />

      {tab === 'rego' ? (
        <Card title="Evaluation policy" actions={can(user, 'editor') && <Link className="btn small" to={`/controls/${id}/edit`}>Edit &amp; test</Link>}>
          <CodeEditor value={c.rego} readOnly />
        </Card>
      ) : (
        <Card actions={
          <form onSubmit={(e) => { e.preventDefault(); set({ q, offset: null }); }}>
            <input className="search" placeholder="Filter by asset or owner…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        }>
          <ErrorBox error={results.error} />
          {!results.data ? <Loading /> : results.data.items.length === 0 ? <Empty>No assets in this category.</Empty> : (
            <>
              <table className="table">
                <thead><tr><th>Asset</th><th>Owner</th><th>Status</th><th>Reasons</th><th>Since</th></tr></thead>
                <tbody>
                  {results.data.items.map((r) => (
                    <tr key={r.asset_id}>
                      <td>
                        <Link to={`/assets/${r.asset_id}`} className="strong">{r.name}</Link>
                        {(r.html_url || r.web_url) && <a className="ext" href={r.html_url || r.web_url} target="_blank" rel="noreferrer" title="Open in provider">↗</a>}
                        <div className="muted small">{r.type}</div>
                      </td>
                      <td className="small">{r.owner || <span className="muted">—</span>}</td>
                      <td><Status s={r.status} />{r.stale && <span className="chip" title="Asset or control changed since this result">stale</span>}</td>
                      <td className="small reasons">{(r.reasons || []).map((x, i) => <div key={i}>{x}</div>)}</td>
                      <td className="muted small nowrap" title={dt(r.evaluated_at)}>{ago(r.status_since || r.evaluated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager total={results.data.total} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: o || null })} />
            </>
          )}
        </Card>
      )}
    </Page>
  );
}
