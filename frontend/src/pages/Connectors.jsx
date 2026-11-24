import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Empty, ErrorBox, Loading, Page } from '../components.jsx';
import { ago, duration } from '../format.js';

export const PROVIDER = { github: 'GitHub', ado: 'Azure DevOps' };

export function RunStatus({ s }) {
  return <span className={`pill run-${s}`}>{s || 'never run'}</span>;
}

export default function Connectors() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => get('/api/connectors'), [], { poll: 15_000 });
  const runs = useLoad(() => get('/api/runs?limit=15'), [], { poll: 10_000 });
  return (
    <Page title="Connectors" subtitle="Collectors pull assets from GitHub and Azure DevOps with a PAT, on a schedule and on webhook events."
      actions={can(user, 'admin') && <Link className="btn primary" to="/connectors/new">Add connector</Link>}>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <Card>
          {data.items.length === 0 ? <Empty>No connectors yet. {can(user, 'admin') && <Link to="/connectors/new">Add one</Link>}</Empty> : (
            <table className="table">
              <thead><tr><th>Connector</th><th>Provider</th><th>Target</th><th className="num">Assets</th><th>Schedule</th><th>Last run</th><th>Next run</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className={c.enabled ? '' : 'disabled'}>
                    <td><Link to={`/connectors/${c.id}`} className="strong">{c.name}</Link>{!c.enabled && <span className="chip">disabled</span>}</td>
                    <td>{PROVIDER[c.provider]}</td>
                    <td className="small">{c.config.org || c.config.organization}</td>
                    <td className="num">{c.asset_count}</td>
                    <td className="small">every {c.schedule_minutes >= 60 ? `${c.schedule_minutes / 60}h` : `${c.schedule_minutes}m`}</td>
                    <td><RunStatus s={c.last_status} /> <span className="muted small">{ago(c.last_run_at)}</span>{c.last_error && <div className="small t-fail trunc" title={c.last_error}>{c.last_error}</div>}</td>
                    <td className="muted small">{c.enabled ? ago(c.next_run_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      <Card title="Recent collection runs">
        {!runs.data ? <Loading /> : runs.data.items.length === 0 ? <Empty>No runs yet.</Empty> : (
          <table className="table compact">
            <thead><tr><th>#</th><th>Connector</th><th>Trigger</th><th>Status</th><th className="num">Assets</th><th className="num">Changed</th><th className="num">API calls</th><th>Duration</th><th>Started</th></tr></thead>
            <tbody>
              {runs.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.id}</td>
                  <td><Link to={`/connectors/${r.connector_id}`}>{r.connector_name}</Link></td>
                  <td className="small">{r.trigger}{r.scope && <span className="muted"> · {Object.values(r.scope).join('/')}</span>}</td>
                  <td><RunStatus s={r.status} />{r.error && <div className="small t-fail trunc" title={r.error}>{r.error}</div>}</td>
                  <td className="num">{r.stats?.assets ?? ''}</td>
                  <td className="num">{r.stats ? (r.stats.created || 0) + (r.stats.changed || 0) : ''}</td>
                  <td className="num">{r.stats?.api_calls ?? ''}</td>
                  <td className="small">{duration(r.started_at, r.finished_at)}</td>
                  <td className="muted small nowrap">{ago(r.started_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
