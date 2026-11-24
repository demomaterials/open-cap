import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, qs } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Empty, ErrorBox, Loading, Page, Sev, TypeChips } from '../components.jsx';
import { ago } from '../format.js';

export default function Controls() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const type = params.get('asset_type') || '';
  const types = useLoad(() => get('/api/asset-types'), []);
  const { data, error } = useLoad(() => get(`/api/controls${qs({ q: params.get('q'), asset_type: type })}`), [params.toString()]);

  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };

  return (
    <Page title="Controls" subtitle="Each control applies to one or more asset types and is evaluated with Rego against the asset definition JSON."
      actions={can(user, 'editor') && <Link className="btn primary" to="/controls/new">New control</Link>}>
      <div className="toolbar">
        <form onSubmit={(e) => { e.preventDefault(); setParam('q', q); }}>
          <input className="search" placeholder="Search key or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select value={type} onChange={(e) => setParam('asset_type', e.target.value)}>
          <option value="">All asset types</option>
          {types.data?.items.map((t) => <option key={t.type} value={t.type}>{t.display_name}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <Card>
          {data.items.length === 0 ? <Empty>No controls match.</Empty> : (
            <table className="table">
              <thead><tr><th>Control</th><th>Severity</th><th>Applies to</th><th>Frameworks</th><th>Version</th><th>Updated</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className={c.enabled ? '' : 'disabled'}>
                    <td>
                      <Link to={`/controls/${c.id}`} className="strong">{c.key}</Link>
                      {!c.enabled && <span className="chip">disabled</span>}
                      {c.compile_error && <span className="chip bad">compile error</span>}
                      <div className="small">{c.name}</div>
                    </td>
                    <td><Sev s={c.severity} /></td>
                    <td><TypeChips types={c.asset_types} /></td>
                    <td className="small">{c.frameworks.map((f) => <Link key={f.id} to={`/frameworks/${f.id}`} className="chip link">{f.key}</Link>)}</td>
                    <td className="num">v{c.version}</td>
                    <td className="muted small nowrap">{ago(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Page>
  );
}
