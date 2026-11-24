// HS256 JWT sessions shared by backend and presenter.
import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'cap_session';
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', config.jwtSecret()).update(data).digest('base64url');

export function issueToken(user, hours = config.sessionHours) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, name: user.username, role: user.role, iat: now, exp: now + hours * 3600, iss: 'open-cap' };
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = sign(`${head}.${body}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.iss !== 'open-cap' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenFrom(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return { token: h.slice(7), viaCookie: false };
  return { token: parseCookies(req.headers.cookie)[SESSION_COOKIE], viaCookie: true };
}

/**
 * Express middleware. Requires a valid session with at least `minRole`.
 * Cookie-authenticated unsafe requests must carry a same-origin Origin header (CSRF).
 */
export function requireAuth(minRole = 'viewer') {
  return (req, _res, next) => {
    const { token, viaCookie } = tokenFrom(req);
    const claims = verifyToken(token);
    if (!claims) return next(new HttpError(401, 'authentication required'));
    if ((ROLE_RANK[claims.role] ?? 0) < ROLE_RANK[minRole]) return next(new HttpError(403, `requires role ${minRole}`));
    if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && new URL(origin).host !== host) return next(new HttpError(403, 'cross-origin request rejected'));
    }
    req.user = { id: claims.sub, username: claims.name, role: claims.role };
    next();
  };
}

export function hasRole(user, role) {
  return (ROLE_RANK[user?.role] ?? 0) >= ROLE_RANK[role];
}
