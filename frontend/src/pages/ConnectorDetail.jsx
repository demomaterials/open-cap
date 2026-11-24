import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, post } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, ErrorBox, Loading, Page } from '../components.jsx';
import { ago, dt, duration } from '../format.js';
import { PROVIDER, RunStatus } from './Connectors.jsx';

export default function ConnectorDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [test, setTest] = useState(null);
  const [hook, setHook] = useState(null);
  const [msg, setMsg] = useState(null);
  const c = useLoad(() => get(`/api/connectors/${id}`), [id], { poll: 10_000 });
  const runs = useLoad(() => get(`/api/connectors/${id}/runs?limit=25`), [id], { poll: 5_000 });

  if (c.error) return <Page title="Connector"><ErrorBox error={c.error} /></Page>;
  if (!c.data) return <Page title="Connector"><Loading /></Page>;
  const x = c.data;

  const runNow = async () => {
    const r = await post(`/api/connectors/${id}/run`);
    setMsg(r.queued ? `Run #${r.run_id} queued.` : 'A full run is already queued.');
    runs.reload();
  };
  const testIt = async () => { setTest({ pending: true }); setTest(await post(`/api/connectors/${id}/test`)); };
  const showHook = async () => setHook(await get(`/api/connectors/${id}/webhook`));
  const rotate = async () => { if (window.confirm('Rotate the webhook secret? Update it in the provider afterwards.')) setHook(await post(`/api/connectors/${id}/webhook/rotate`)); };
  const remove = async () => {
    if (!window.confirm(`Delete connector ${x.name}? Its ${x.asset_count} assets are removed from compliance.`)) return;
    await del(`/api/connectors/${id}`);
    navigate('/connectors');
  };

  return (
    <Page title={x.name} subtitle={`${PROVIDER[x.provider]} · ${x.config.org || x.config.organization}`}
      crumbs={[{ to: '/connectors', label: 'Connectors' }, { label: x.name }]}
      actions={<>
        {can(user, 'editor') && <button type="button" className="btn ghost" onClick={testIt}>Test connection</button>}
        {can(user, 'editor') && <button type="button" className="btn primary" onClick={runNow}>Run now</button>}
        {can(user, 'admin') && <Link className="btn" to={`/connectors/${id}/edit`}>Edit</Link>}
        {can(user, 'admin') && <button type="button" className="btn danger ghost" onClick={remove}>Delete</button>}
      </>}>
      {msg && <div className="notice">{msg}</div>}
      {test && !test.pending && <div className={`notice ${test.ok ? 'good' : 'bad'}`}>{test.ok ? '✓ ' : '✗ '}{test.detail}</div>}
      <div className="grid two">
        <Card title="Configuration">
          <dl className="dl">
            <dt>Status</dt><dd>{x.enabled ? 'enabled' : 'disabled'} · <RunStatus s={x.last_status} /> {ago(x.last_run_at)}</dd>
            {x.last_error && <><dt>Last error</dt><dd className="t-fail small">{x.last_error}</dd></>}
            <dt>Schedule</dt><dd>every {x.schedule_minutes} minutes · next {x.enabled ? ago(x.next_run_at) : '—'}</dd>
            <dt>Assets</dt><dd><Link to={`/assets?connector=${x.id}`}>{x.asset_count}</Link></dd>
            <dt>PAT</dt><dd>{x.has_credential ? 'stored (encrypted)' : <span className="t-fail">missing</span>}</dd>
            {Object.entries(x.config).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd><code>{String(v)}</code></dd></Fragment>)}
          </dl>
        </Card>
        <Card title="Webhook" actions={can(user, 'admin') && <><button type="button" className="btn small ghost" onClick={showHook}>Reveal secret</button><button type="button" className="btn small ghost" onClick={rotate}>Rotate</button></>}>
          <p className="small">Point a {x.provider === 'github' ? 'GitHub organization webhook (content type application/json, events: repositories, branch protection rules, rulesets, members, pushes)' : 'Azure DevOps service hook (Web Hooks; events: code pushed, repository created/renamed/deleted). Put the secret in the basic-auth password or an X-CAP-Webhook-Secret header'} at:</p>
          <pre className="code-inline">{x.webhook_url}</pre>
          {hook && <><div className="muted small">Secret</div><pre className="code-inline">{hook.secret}</pre></>}
          <p className="muted small">Webhook deliveries trigger a scoped collection of the affected repository or project.</p>
        </Card>
      </div>
      <Card title="Runs">
        {!runs.data ? <Loading /> : (
          <table className="table compact">
            <thead><tr><th>#</th><th>Trigger</th><th>Status</th><th className="num">Assets</th><th className="num">New</th><th className="num">Changed</th><th className="num">Removed</th><th className="num">API errors</th><th className="num">API calls</th><th>Duration</th><th>Started</th></tr></thead>
            <tbody>
              {runs.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.id}</td>
                  <td className="small">{r.trigger}{r.scope && <span className="muted"> · {JSON.stringify(r.scope)}</span>}</td>
                  <td><RunStatus s={r.status} />{r.error && <div className="small t-fail">{r.error}</div>}</td>
                  <td className="num">{r.stats?.assets}</td>
                  <td className="num">{r.stats?.created}</td>
                  <td className="num">{r.stats?.changed}</td>
                  <td className="num">{r.stats?.deleted}</td>
                  <td className="num">{r.stats?.enrichment_errors}</td>
                  <td className="num">{r.stats?.api_calls}</td>
                  <td className="small">{duration(r.started_at, r.finished_at)}</td>
                  <td className="muted small nowrap" title={dt(r.created_at)}>{ago(r.started_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
