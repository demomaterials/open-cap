import { Router } from 'express';
import { one, query } from '../../common/db.js';
import { verifyPassword, hashPassword } from '../../common/crypto.js';
import { issueToken, requireAuth, SESSION_COOKIE } from '../../common/auth.js';
import { config } from '../../common/config.js';
import { HttpError, str } from '../../common/http.js';
import { audit } from '../audit.js';

export const router = Router();

// Very small in-memory brute-force brake per username.
const failures = new Map();

router.post('/login', async (req, res) => {
  const username = str(req.body?.username, 'username', { max: 100 });
  const password = str(req.body?.password, 'password', { max: 200 });
  const f = failures.get(username) || { n: 0, until: 0 };
  if (f.until > Date.now()) throw new HttpError(429, 'too many failed attempts; try again later');

  const user = await one('SELECT * FROM users WHERE username = $1 AND NOT disabled', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 60_000 * Math.min(15, f.n - 4); }
    failures.set(username, f);
    throw new HttpError(401, 'invalid username or password');
  }
  failures.delete(username);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const token = issueToken(user);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: config.sessionHours * 3600 * 1000,
  });
  req.user = { username: user.username };
  await audit(req, 'login', 'user', user.id);
  res.json({ user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }, token });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth(), async (req, res) => {
  const user = await one('SELECT id, username, display_name, role FROM users WHERE id = $1', [req.user.id]);
  if (!user) throw new HttpError(401, 'user no longer exists');
  res.json({ user });
});

router.post('/password', requireAuth(), async (req, res) => {
  const current = str(req.body?.current_password, 'current_password', { max: 200 });
  const next = str(req.body?.new_password, 'new_password', { max: 200 });
  if (next.length < 10) throw new HttpError(400, 'new password must be at least 10 characters');
  const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user || !verifyPassword(current, user.password_hash)) throw new HttpError(400, 'current password is wrong');
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hashPassword(next)]);
  await audit(req, 'password_change', 'user', user.id);
  res.json({ ok: true });
});
