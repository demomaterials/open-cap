import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, qs } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Empty, ErrorBox, Loading, Page, Pager, StackBar } from '../components.jsx';
import { ago } from '../format.js';

const LIMIT = 50;

export default function Assets() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const offset = Number(params.get('offset') || 0);
  const types = useLoad(() => get('/api/asset-types'), []);
  const { data, error } = useLoad(() => get(`/api/assets${qs({
    type: params.get('type'), q: params.get('q'), owner: params.get('owner'), status: params.get('status'), limit: LIMIT, offset,
  })}`), [params.toString()]);

  const set = (patch) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
    setParams(n);
  };

  return (
    <Page title="Assets" subtitle="Everything collected from connectors or registered manually. Each asset is a JSON definition that controls evaluate."
      actions={can(user, 'editor') && <Link className="btn primary" to="/assets/new">Register asset</Link>}>
      <div className="toolbar">
        <form onSubmit={(e) => { e.preventDefault(); set({ q, offset: null }); }}>
          <input className="search" placeholder="Search name or id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <select value={params.get('type') || ''} onChange={(e) => set({ type: e.target.value, offset: null })}>
          <option value="">All types</option>
          {types.data?.items.map((t) => <option key={t.type} value={t.type}>{t.display_name} ({t.asset_count})</option>)}
        </select>
        <select value={params.get('status') || ''} onChange={(e) => set({ status: e.target.value, offset: null })}>
          <option value="">Any result</option>
          <option value="fail">Has failing</option>
          <option value="error">Has errors</option>
          <option value="pending">Has pending</option>
        </select>
        {params.get('owner') && <span className="chip">owner: {params.get('owner')} <button type="button" className="x" onClick={() => set({ owner: null })}>×</button></span>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <Card>
          {data.items.length === 0 ? <Empty>No assets found.</Empty> : (
            <>
              <table className="table">
                <thead><tr><th>Asset</th><th>Type</th><th>Owner</th><th className="num">Members</th><th>Source</th><th className="w-bar">Results</th><th className="num">Fail</th><th>Collected</th></tr></thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td><Link to={`/assets/${a.id}`} className="strong">{a.name}</Link></td>
                      <td><span className="chip">{a.type}</span></td>
                      <td className="small">{a.owner || <span className="muted">—</span>}</td>
                      <td className="num">{a.member_count}</td>
                      <td className="small">{a.connector_id ? <Link to={`/connectors/${a.connector_id}`}>{a.connector_name}</Link> : <span className="muted">manual</span>}</td>
                      <td className="w-bar"><StackBar c={a} /></td>
                      <td className="num t-fail">{a.fail || ''}</td>
                      <td className="muted small nowrap">{ago(a.last_collected_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager total={data.total} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: o ? String(o) : null })} />
            </>
          )}
        </Card>
      )}
    </Page>
  );
}
