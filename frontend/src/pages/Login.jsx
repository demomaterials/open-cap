import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post('/api/auth/login', form);
      setUser(r.user);
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand center">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <div>
            <div className="brand-name">open-cap</div>
            <div className="brand-sub">Continuous compliance for your assets</div>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Username</span>
          <input autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary block" disabled={busy || !form.username || !form.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
