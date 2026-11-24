import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Counts, Empty, ErrorBox, Loading, Page, Score, ScoreRing, Sev, Sparkline, StackBar, TypeChips } from '../components.jsx';

export default function FrameworkDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => get(`/api/compliance/frameworks/${id}`), [id], { poll: 30_000 });

  if (error && !data) return <Page title="Framework"><ErrorBox error={error} /></Page>;
  if (!data) return <Page title="Framework"><Loading /></Page>;

  const remove = async () => {
    if (!window.confirm(`Delete framework ${data.name}? Controls are kept.`)) return;
    await del(`/api/frameworks/${id}`);
    navigate('/frameworks');
  };

  return (
    <Page title={data.name} subtitle={data.description}
      crumbs={[{ to: '/frameworks', label: 'Frameworks' }, { label: data.key }]}
      actions={can(user, 'editor') && (
        <>
          <a className="btn ghost" href={`/api/compliance/export.csv?framework=${id}`}>Export CSV</a>
          <Link className="btn" to={`/frameworks/${id}/edit`}>Edit</Link>
          <button type="button" className="btn danger ghost" onClick={remove}>Delete</button>
        </>
      )}>
      <Card className="hero-card">
        <div className="hero-body">
          <ScoreRing score={data.totals.score} />
          <div className="hero-side">
            <Counts c={data.totals} />
            <div className="trend"><Sparkline points={data.trend} /></div>
          </div>
        </div>
      </Card>
      <Card title={`Controls (${data.controls.length})`}>
        {data.controls.length === 0 ? <Empty>This framework has no controls. <Link to={`/frameworks/${id}/edit`}>Add some</Link>.</Empty> : (
          <table className="table">
            <thead>
              <tr><th>Ref</th><th>Control</th><th>Applies to</th><th className="num">Passing</th><th className="num">Failing</th><th className="num">Skipped</th><th className="w-bar">Results</th><th className="num">Score</th></tr>
            </thead>
            <tbody>
              {data.controls.map((c) => (
                <tr key={c.id} className={c.enabled ? '' : 'disabled'}>
                  <td className="nowrap muted">{c.reference || '—'}</td>
                  <td>
                    <Link to={`/controls/${c.id}`} className="strong">{c.key}</Link> <Sev s={c.severity} />
                    {!c.enabled && <span className="chip">disabled</span>}
                    {c.compile_error && <span className="chip bad">compile error</span>}
                    <div className="small">{c.name}</div>
                  </td>
                  <td><TypeChips types={c.asset_types} /></td>
                  <td className="num"><Link className="t-pass" to={`/controls/${c.id}?status=pass`}>{c.pass}</Link></td>
                  <td className="num"><Link className="t-fail" to={`/controls/${c.id}?status=fail`}>{c.fail}</Link></td>
                  <td className="num"><Link className="t-skip" to={`/controls/${c.id}?status=skip`}>{c.skip}</Link></td>
                  <td className="w-bar"><StackBar c={c} /></td>
                  <td className="num"><Score score={c.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
