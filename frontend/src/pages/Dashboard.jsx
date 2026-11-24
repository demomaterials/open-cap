import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useLoad } from '../hooks.js';
import { Card, Counts, Empty, ErrorBox, Loading, Page, Score, ScoreRing, Sparkline, StackBar, Status } from '../components.jsx';
import { ago } from '../format.js';

export default function Dashboard() {
  const { data, error, loading } = useLoad(() => get('/api/compliance/summary'), [], { poll: 30_000 });
  const events = useLoad(() => get('/api/compliance/events?limit=12'), [], { poll: 30_000 });
  const owners = useLoad(() => get('/api/compliance/owners?limit=8'), [], { poll: 60_000 });

  if (loading && !data) return <Page title="Dashboard"><Loading /></Page>;
  if (error && !data) return <Page title="Dashboard"><ErrorBox error={error} /></Page>;
  const { overall, frameworks, by_asset_type: byType, by_severity: bySev, inventory, trend } = data;

  return (
    <Page title="Compliance overview"
      subtitle={`${inventory.assets} assets · ${inventory.controls} enabled controls · last evaluation ${ago(inventory.last_evaluation)} · last collection ${ago(inventory.last_collection)}`}>
      <div className="grid hero">
        <Card className="hero-card">
          <div className="hero-body">
            <ScoreRing score={overall.score} size={148} />
            <div className="hero-side">
              <Counts c={overall} />
              <p className="muted small formula">
                Score = passing ÷ (applicable asset×control pairs − skipped − errored − pending).
                {' '}{overall.total} pairs, {overall.total - overall.skip - overall.error - overall.pending} scored.
                {inventory.eval_queue > 0 && <> · <strong>{inventory.eval_queue}</strong> assets waiting for evaluation</>}
              </p>
              <div className="trend"><Sparkline points={trend} /></div>
            </div>
          </div>
        </Card>
        <Card title="By severity">
          <table className="table compact">
            <tbody>
              {bySev.map((s) => (
                <tr key={s.severity}>
                  <td><span className={`sev ${s.severity}`}>{s.severity}</span></td>
                  <td className="w-bar"><StackBar c={s} /></td>
                  <td className="num"><Score score={s.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Frameworks" actions={<Link className="btn small ghost" to="/frameworks">All frameworks</Link>}>
        {frameworks.length === 0 ? <Empty>No frameworks yet. <Link to="/frameworks/new">Create one</Link>.</Empty> : (
          <div className="fw-grid">
            {frameworks.map((f) => (
              <Link to={`/frameworks/${f.id}`} key={f.id} className="fw-tile">
                <div className="fw-tile-head">
                  <div>
                    <div className="fw-name">{f.name}</div>
                    <div className="muted small">{f.key} · {f.control_count} controls</div>
                  </div>
                  <Score score={f.score} />
                </div>
                <StackBar c={f} height={10} />
                <div className="fw-tile-counts small">
                  <span className="t-pass">{f.pass} passing</span>
                  <span className="t-fail">{f.fail} failing</span>
                  <span className="t-skip">{f.skip} skipped</span>
                  {f.error > 0 && <span className="t-error">{f.error} error</span>}
                  {f.pending > 0 && <span className="t-pending">{f.pending} pending</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid two">
        <Card title="By asset type">
          {byType.length === 0 ? <Empty>No assets yet. <Link to="/connectors/new">Add a connector</Link> or <Link to="/assets/new">register an asset</Link>.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Type</th><th className="num">Assets</th><th>Results</th><th className="num">Score</th></tr></thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t.asset_type}>
                    <td><Link to={`/assets?type=${t.asset_type}`}>{t.asset_type}</Link></td>
                    <td className="num">{t.assets}</td>
                    <td className="w-bar"><StackBar c={t} /></td>
                    <td className="num"><Score score={t.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Owners with most failures">
          {!owners.data ? <Loading /> : owners.data.items.length === 0 ? <Empty>No results yet.</Empty> : (
            <table className="table compact">
              <thead><tr><th>Owner</th><th className="num">Assets</th><th className="num">Failing</th><th className="num">Score</th></tr></thead>
              <tbody>
                {owners.data.items.map((o) => (
                  <tr key={o.owner}>
                    <td><Link to={`/assets?owner=${encodeURIComponent(o.owner === '(unowned)' ? '' : o.owner)}`}>{o.owner}</Link></td>
                    <td className="num">{o.assets}</td>
                    <td className="num t-fail">{o.fail}</td>
                    <td className="num"><Score score={o.score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Recent status changes" actions={<Link className="btn small ghost" to="/activity">Activity</Link>}>
        {!events.data ? <Loading /> : events.data.items.length === 0 ? <Empty>No status changes yet.</Empty> : (
          <table className="table compact">
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted small">{ago(e.occurred_at)}</td>
                  <td><Link to={`/controls/${e.control_id}`}>{e.control_key}</Link></td>
                  <td><Link to={`/assets/${e.asset_id}`}>{e.asset_name}</Link></td>
                  <td className="nowrap"><Status s={e.from_status} /> → <Status s={e.to_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
