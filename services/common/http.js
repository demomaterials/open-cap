import express from 'express';
import { log } from './log.js';
import { pool } from './db.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Express app with JSON parsing, request logs, /healthz and /readyz. */
export function createApp({ jsonLimit = '5mb', rawBody = false, readyCheck } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({
    limit: jsonLimit,
    verify: rawBody ? (req, _res, buf) => { req.rawBody = buf; } : undefined,
  }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/readyz') return;
      log.info('request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - start });
    });
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      if (readyCheck && !(await readyCheck())) throw new Error('dependency not ready');
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });
  return app;
}

/** Install the 404 + error handlers. Call after all routes. */
export function finalize(app) {
  app.use((_req, _res, next) => next(new HttpError(404, 'not found')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === '23505') { status = 409; message = `already exists: ${err.detail || err.message}`; }
    if (err.code === '23503') { status = 409; message = `referenced entity missing or in use: ${err.detail || err.message}`; }
    if (err.code === '22P02') { status = 400; message = 'invalid identifier'; }
    if (err.type === 'entity.parse.failed') { status = 400; message = 'invalid JSON body'; }
    if (status >= 500) log.error('unhandled error', { path: req.originalUrl, err });
    res.status(status).json({ error: status >= 500 ? 'internal error' : message, details: err.details });
  });
  return app;
}

export function listenApp(app, port) {
  const server = app.listen(port, () => log.info('http listening', { port }));
  const shutdown = () => {
    log.info('shutting down');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

// Small validation helpers.
export function str(v, name, { required = true, max = 1000 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be a string`);
  if (v.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  return v.trim();
}

export function intIn(v, name, min, max, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be an integer in [${min}, ${max}]`);
  return n;
}

export function paging(q, maxLimit = 500) {
  return { limit: intIn(q.limit, 'limit', 1, maxLimit, 50), offset: intIn(q.offset, 'offset', 0, 10_000_000, 0) };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v, name = 'id') {
  if (!UUID_RE.test(String(v))) throw new HttpError(400, `${name} must be a UUID`);
  return v;
}
