import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, post } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Counts, Empty, ErrorBox, JsonView, Loading, Page, ScoreRing, Sev, Status, Tabs } from '../components.jsx';
import { ago, dt } from '../format.js';

export default function AssetDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('results');
  const [msg, setMsg] = useState(null);
  const asset = useLoad(() => get(`/api/assets/${id}`), [id]);
  const results = useLoad(() => get(`/api/compliance/assets/${id}`), [id], { poll: 20_000 });
  const history = useLoad(() => (tab === 'history' ? get(`/api/assets/${id}/history`) : Promise.resolve(null)), [id, tab]);
  const children = useLoad(() => get(`/api/assets/${id}/children`), [id]);

  if (asset.error) return <Page title="Asset"><ErrorBox error={asset.error} /></Page>;
  if (!asset.data) return <Page title="Asset"><Loading /></Page>;
  const a = asset.data;
  const src = a.definition?.source || {};
  const link = src.html_url || src.web_url;

  const evaluate = async () => { await post(`/api/assets/${id}/evaluate`); setMsg('Re-evaluation queued.'); setTimeout(() => results.reload(), 2500); };
  const remove = async () => {
    if (!window.confirm(`Remove ${a.name}? It stops counting toward compliance (a connector will re-add it if it still exists).`)) return;
    await del(`/api/assets/${id}`);
    navigate('/assets');
  };

  return (
    <Page title={a.name} subtitle={<><span className="chip">{a.type}</span> {a.external_id}{link && <> · <a href={link} target="_blank" rel="noreferrer">open in provider ↗</a></>}</>}
      crumbs={[{ to: '/assets', label: 'Assets' }, { to: `/assets?type=${a.type}`, label: a.type }, { label: a.name }]}
      actions={can(user, 'editor') && (
        <>
          <button type="button" className="btn ghost" onClick={evaluate}>Re-evaluate</button>
          {!a.deleted_at && <button type="button" className="btn danger ghost" onClick={remove}>Remove</button>}
        </>
      )}>
      {msg && <div className="notice">{msg}</div>}
      {a.deleted_at && <div className="notice warn">This asset was removed {ago(a.deleted_at)} and no longer counts toward compliance.</div>}
      <div className="grid hero">
        <Card className="hero-card">
          {!results.data ? <Loading /> : (
            <div className="hero-body">
              <ScoreRing score={results.data.totals.score} />
              <div className="hero-side"><Counts c={results.data.totals} /></div>
            </div>
          )}
        </Card>
        <Card title="Ownership">
          <dl className="dl">
            <dt>Owner</dt><dd>{a.owner || <span className="muted">none</span>}</dd>
            <dt>Members</dt>
            <dd className="members">
              {a.members.length === 0 ? <span className="muted">none</span> : a.members.slice(0, 40).map((m, i) => (
                <span key={i} className="chip">{m.login || m.team || m.name}{m.role && <span className="muted"> · {m.role}</span>}</span>
              ))}
              {a.members.length > 40 && <span className="muted small">+{a.members.length - 40} more</span>}
            </dd>
            <dt>Parent</dt><dd>{a.parent_id ? <Link to={`/assets/${a.parent_id}`}>{a.parent_name}</Link> : '—'}</dd>
            <dt>Source</dt><dd>{a.connector_id ? <Link to={`/connectors/${a.connector_id}`}>{a.connector_name}</Link> : 'manual / API'}</dd>
            <dt>Collected</dt><dd title={dt(a.last_collected_at)}>{ago(a.last_collected_at)} · changed {ago(a.last_changed_at)}</dd>
          </dl>
        </Card>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'results', label: 'Control results', count: results.data?.results.length },
        { key: 'definition', label: 'Definition JSON' },
        { key: 'children', label: 'Children', count: children.data?.items.length },
        { key: 'history', label: 'History' },
      ]} />

      {tab === 'results' && (
        <Card>
          {!results.data ? <Loading /> : results.data.results.length === 0 ? <Empty>No enabled control applies to <code>{a.type}</code>. <Link to="/controls/new">Create one</Link>.</Empty> : (
            <table className="table">
              <thead><tr><th>Control</th><th>Status</th><th>Reasons</th><th>Frameworks</th><th>Evaluated</th></tr></thead>
              <tbody>
                {results.data.results.map((r) => (
                  <tr key={r.control_id}>
                    <td><Link className="strong" to={`/controls/${r.control_id}`}>{r.key}</Link> <Sev s={r.severity} /><div className="small">{r.name}</div></td>
                    <td><Status s={r.status} />{r.stale && <span className="chip">stale</span>}</td>
                    <td className="small reasons">{(r.reasons || []).map((x, i) => <div key={i}>{x}</div>)}</td>
                    <td className="small">{r.frameworks.map((f) => <span className="chip" key={f}>{f}</span>)}</td>
                    <td className="muted small nowrap">{ago(r.evaluated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === 'definition' && (
        <Card>
          {Object.keys(a.definition.errors || {}).length > 0 && (
            <div className="notice warn small">Some API calls failed during collection, so controls depending on them may be skipped: {Object.entries(a.definition.errors).map(([k, v]) => <div key={k}><code>{k}</code>: {v}</div>)}</div>
          )}
          <JsonView value={a.definition} maxHeight={900} />
        </Card>
      )}
      {tab === 'children' && (
        <Card>
          {!children.data ? <Loading /> : children.data.items.length === 0 ? <Empty>No child assets.</Empty> : (
            <table className="table compact"><tbody>
              {children.data.items.map((c) => <tr key={c.id}><td><Link to={`/assets/${c.id}`}>{c.name}</Link></td><td><span className="chip">{c.type}</span></td><td className="small">{c.owner}</td></tr>)}
            </tbody></table>
          )}
        </Card>
      )}
      {tab === 'history' && (
        <Card>
          {!history.data ? <Loading /> : history.data.items.length === 0 ? <Empty>No history.</Empty> : history.data.items.map((h) => (
            <details key={h.id} className="history">
              <summary>{dt(h.collected_at)} <span className="muted small">{h.content_hash.slice(0, 12)}</span></summary>
              <JsonView value={h.definition} maxHeight={400} />
            </details>
          ))}
        </Card>
      )}
    </Page>
  );
}
