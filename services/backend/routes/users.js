import { Router } from 'express';
import { many, one } from '../../common/db.js';
import { hashPassword } from '../../common/crypto.js';
import { requireAuth } from '../../common/auth.js';
import { HttpError, str, uuid } from '../../common/http.js';
import { audit } from '../audit.js';

export const router = Router();
const ROLES = ['admin', 'editor', 'viewer'];

router.get('/', requireAuth('admin'), async (_req, res) => {
  res.json({ items: await many('SELECT id, username, display_name, role, disabled, created_at, last_login_at FROM users ORDER BY username') });
});

router.post('/', requireAuth('admin'), async (req, res) => {
  const username = str(req.body?.username, 'username', { max: 100 });
  if (!/^[a-zA-Z0-9._@-]{2,100}$/.test(username)) throw new HttpError(400, 'username has invalid characters');
  const password = str(req.body?.password, 'password', { max: 200 });
  if (password.length < 10) throw new HttpError(400, 'password must be at least 10 characters');
  const role = req.body?.role || 'viewer';
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
  const user = await one(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1,$2,$3,$4)
     RETURNING id, username, display_name, role, disabled, created_at`,
    [username, str(req.body?.display_name, 'display_name', { required: false, max: 200 }), hashPassword(password), role]);
  await audit(req, 'create', 'user', user.id, { username, role });
  res.status(201).json(user);
});

router.patch('/:id', requireAuth('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  const { role, disabled, password, display_name: displayName } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) throw new HttpError(400, 'invalid role');
  if (id === req.user.id && (role && role !== 'admin' || disabled)) throw new HttpError(400, 'you cannot demote or disable yourself');
  if (password !== undefined && (typeof password !== 'string' || password.length < 10)) throw new HttpError(400, 'password must be at least 10 characters');
  const user = await one(
    `UPDATE users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled),
       password_hash = COALESCE($4, password_hash), display_name = COALESCE($5, display_name)
     WHERE id = $1 RETURNING id, username, display_name, role, disabled`,
    [id, role ?? null, typeof disabled === 'boolean' ? disabled : null, password ? hashPassword(password) : null, displayName ?? null]);
  if (!user) throw new HttpError(404, 'user not found');
  await audit(req, 'update', 'user', id, { role, disabled, passwordReset: Boolean(password) });
  res.json(user);
});

router.delete('/:id', requireAuth('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'you cannot delete yourself');
  const r = await one('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
  if (!r) throw new HttpError(404, 'user not found');
  await audit(req, 'delete', 'user', id, r);
  res.status(204).end();
});
