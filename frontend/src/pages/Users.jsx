import { useState } from 'react';
import { del, get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { Card, ErrorBox, Field, Loading, Page } from '../components.jsx';
import { ago } from '../format.js';

export default function Users() {
  const { user: me } = useAuth();
  const { data, error, reload } = useLoad(() => get('/api/users'), []);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'viewer' });
  const [err, setErr] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setErr(null);
    try { await post('/api/users', form); setForm({ username: '', display_name: '', password: '', role: 'viewer' }); reload(); } catch (x) { setErr(x); }
  };
  const update = async (id, body) => { setErr(null); try { await patch(`/api/users/${id}`, body); reload(); } catch (x) { setErr(x); } };
  const resetPw = async (u) => { const pw = window.prompt(`New password for ${u.username} (min 10 chars)`); if (pw) update(u.id, { password: pw }); };
  const remove = async (u) => { if (window.confirm(`Delete ${u.username}?`)) { try { await del(`/api/users/${u.id}`); reload(); } catch (x) { setErr(x); } } };

  return (
    <Page title="Users" subtitle="Viewers read everything. Editors manage controls, frameworks, assets and run collections. Admins also manage connectors and users.">
      <ErrorBox error={error || err} />
      <Card>
        {!data ? <Loading /> : (
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className={u.disabled ? 'disabled' : ''}>
                  <td><strong>{u.username}</strong><div className="small muted">{u.display_name}</div></td>
                  <td>
                    <select value={u.role} disabled={u.id === me.id} onChange={(e) => update(u.id, { role: e.target.value })}>
                      <option>viewer</option><option>editor</option><option>admin</option>
                    </select>
                  </td>
                  <td>{u.disabled ? 'disabled' : 'active'}</td>
                  <td className="muted small">{ago(u.last_login_at)}</td>
                  <td className="actions-cell">
                    <button type="button" className="btn small ghost" onClick={() => resetPw(u)}>Reset password</button>
                    {u.id !== me.id && <button type="button" className="btn small ghost" onClick={() => update(u.id, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                    {u.id !== me.id && <button type="button" className="btn small danger ghost" onClick={() => remove(u)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Add user">
        <form onSubmit={create} className="form-grid four">
          <Field label="Username"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
          <Field label="Display name"><input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Password" hint="At least 10 characters"><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option>viewer</option><option>editor</option><option>admin</option>
            </select>
          </Field>
          <div className="form-actions"><button className="btn primary">Add user</button></div>
        </form>
      </Card>
    </Page>
  );
}
