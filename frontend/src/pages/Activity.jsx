import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Empty, Loading, Page, Status, Tabs } from '../components.jsx';
import { ago, dt } from '../format.js';

export default function Activity() {
  const { user } = useAuth();
  const [tab, setTab] = useState('changes');
  const events = useLoad(() => get('/api/compliance/events?limit=200'), [], { poll: 30_000 });
  const audit = useLoad(() => (tab === 'audit' && can(user, 'admin') ? get('/api/system/audit?limit=200') : Promise.resolve(null)), [tab]);
  const status = useLoad(() => get('/api/system/status'), [], { poll: 10_000 });
  const s = status.data;
  return (
    <Page title="Activity" subtitle={s && `${s.assets} assets · ${s.controls} controls · ${s.eval_queue} queued for evaluation · ${s.active_runs} active collection runs · evaluator ${s.evaluator?.opa ? 'healthy' : 'unavailable'}`}>
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'changes', label: 'Compliance changes' }, ...(can(user, 'admin') ? [{ key: 'audit', label: 'Audit log' }] : [])]} />
      {tab === 'changes' && (
        <Card>
          {!events.data ? <Loading /> : events.data.items.length === 0 ? <Empty>No status changes yet.</Empty> : (
            <table className="table compact">
              <thead><tr><th>When</th><th>Control</th><th>Asset</th><th>Change</th><th>Reasons</th></tr></thead>
              <tbody>
                {events.data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap muted small" title={dt(e.occurred_at)}>{ago(e.occurred_at)}</td>
                    <td><Link to={`/controls/${e.control_id}`}>{e.control_key}</Link><div className="small muted">{e.control_name}</div></td>
                    <td><Link to={`/assets/${e.asset_id}`}>{e.asset_name}</Link><div className="small muted">{e.asset_type}</div></td>
                    <td className="nowrap"><Status s={e.from_status} /> → <Status s={e.to_status} /></td>
                    <td className="small reasons">{(e.reasons || []).slice(0, 3).map((r, i) => <div key={i}>{r}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === 'audit' && (
        <Card>
          {!audit.data ? <Loading /> : (
            <table className="table compact">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
              <tbody>
                {audit.data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap muted small" title={dt(a.occurred_at)}>{ago(a.occurred_at)}</td>
                    <td>{a.actor}</td><td>{a.action}</td><td className="small">{a.entity_type} <span className="muted">{a.entity_id}</span></td>
                    <td className="small mono trunc" title={JSON.stringify(a.detail)}>{a.detail && JSON.stringify(a.detail)}</td>
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
