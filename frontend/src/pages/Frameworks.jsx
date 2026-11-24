import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { can, useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, Empty, ErrorBox, Loading, Page, Score, StackBar } from '../components.jsx';

export default function Frameworks() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => get('/api/compliance/summary'), []);
  return (
    <Page title="Frameworks" subtitle="A framework groups controls. Its score covers every asset each control applies to."
      actions={can(user, 'editor') && <Link className="btn primary" to="/frameworks/new">New framework</Link>}>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <Card>
          {data.frameworks.length === 0 ? <Empty>No frameworks.</Empty> : (
            <table className="table">
              <thead><tr><th>Framework</th><th className="num">Controls</th><th className="num">Passing</th><th className="num">Failing</th><th className="num">Skipped</th><th className="w-bar">Results</th><th className="num">Score</th></tr></thead>
              <tbody>
                {data.frameworks.map((f) => (
                  <tr key={f.id}>
                    <td><Link to={`/frameworks/${f.id}`} className="strong">{f.name}</Link><div className="muted small">{f.key}{f.version && ` · v${f.version}`}</div></td>
                    <td className="num">{f.control_count}</td>
                    <td className="num t-pass">{f.pass}</td>
                    <td className="num t-fail">{f.fail}</td>
                    <td className="num t-skip">{f.skip}</td>
                    <td className="w-bar"><StackBar c={f} /></td>
                    <td className="num"><Score score={f.score} /></td>
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
