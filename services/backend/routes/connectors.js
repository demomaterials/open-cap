import { Router } from 'express';
import { many, one, query, notify } from '../../common/db.js';
import { requireAuth } from '../../common/auth.js';
import { encrypt, decrypt, randomToken } from '../../common/crypto.js';
import { config } from '../../common/config.js';
import { HttpError, intIn, paging, str, uuid } from '../../common/http.js';
import * as github from '../../collector/providers/github.js';
import * as ado from '../../collector/providers/ado.js';
import { audit } from '../audit.js';

export const router = Router();
export const runsRouter = Router();
const providers = { github, ado };

const COLUMNS = `c.id, c.name, c.provider, c.config, c.schedule_minutes, c.enabled, c.next_run_at, c.last_run_at,
  c.last_status, c.last_error, c.created_at, c.updated_at,
  (c.credential_enc IS NOT NULL) AS has_credential, (c.webhook_secret_enc IS NOT NULL) AS has_webhook_secret,
  (SELECT count(*)::int FROM assets a WHERE a.connector_id = c.id AND a.deleted_at IS NULL) AS asset_count`;

function webhookUrl(c) {
  return `${config.publicBaseUrl}/webhooks/${c.provider}/${c.id}`;
}

function withUrl(c) {
  return c && { ...c, webhook_url: webhookUrl(c) };
}

function parseConfig(provider, body, existing = {}) {
  const cfg = { ...existing, ...(body.config || {}) };
  const clean = {};
  if (provider === 'github') {
    clean.org = str(cfg.org, 'config.org (organization or user login)', { max: 100 });
    if (!/^[A-Za-z0-9-]+$/.test(clean.org)) throw new HttpError(400, 'config.org must be a GitHub login');
    if (cfg.apiUrl) {
      clean.apiUrl = str(cfg.apiUrl, 'config.apiUrl', { max: 300 });
      if (!/^https:\/\//.test(clean.apiUrl)) throw new HttpError(400, 'config.apiUrl must be https://');
    }
    if (cfg.repoFilter) { clean.repoFilter = str(cfg.repoFilter, 'config.repoFilter', { max: 200 }); try { new RegExp(clean.repoFilter); } catch { throw new HttpError(400, 'config.repoFilter is not a valid regex'); } }
    clean.includeArchived = cfg.includeArchived !== false;
    clean.collectAccess = cfg.collectAccess !== false;
  } else if (provider === 'ado') {
    clean.organization = str(cfg.organization, 'config.organization', { max: 100 });
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(clean.organization)) throw new HttpError(400, 'config.organization is invalid');
    if (cfg.baseUrl) {
      clean.baseUrl = str(cfg.baseUrl, 'config.baseUrl', { max: 300 });
      if (!/^https:\/\//.test(clean.baseUrl)) throw new HttpError(400, 'config.baseUrl must be https://');
    }
    if (cfg.projectFilter) { clean.projectFilter = str(cfg.projectFilter, 'config.projectFilter', { max: 200 }); try { new RegExp(clean.projectFilter); } catch { throw new HttpError(400, 'config.projectFilter is not a valid regex'); } }
  } else {
    throw new HttpError(400, 'provider must be github or ado');
  }
  if (cfg.concurrency !== undefined) clean.concurrency = intIn(cfg.concurrency, 'config.concurrency', 1, 16, 4);
  return clean;
}

router.get('/', requireAuth(), async (_req, res) => {
  res.json({ items: (await many(`SELECT ${COLUMNS} FROM connectors c ORDER BY c.name`)).map(withUrl) });
});

router.get('/:id', requireAuth(), async (req, res) => {
  const c = await one(`SELECT ${COLUMNS} FROM connectors c WHERE c.id = $1`, [uuid(req.params.id)]);
  if (!c) throw new HttpError(404, 'connector not found');
  res.json(withUrl(c));
});

router.post('/', requireAuth('admin'), async (req, res) => {
  const body = req.body || {};
  const provider = body.provider;
  const cfg = parseConfig(provider, body);
  const name = str(body.name, 'name', { max: 100 });
  const pat = str(body.pat, 'pat', { max: 1000 });
  const schedule = intIn(body.schedule_minutes, 'schedule_minutes', 5, 10080, 360);
  const webhookSecret = randomToken(24);
  const c = await one(
    `INSERT INTO connectors (name, provider, config, credential_enc, webhook_secret_enc, schedule_minutes, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, provider, cfg, encrypt(pat), encrypt(webhookSecret), schedule, body.enabled !== false]);
  await audit(req, 'create', 'connector', c.id, { name, provider, config: cfg });
  const created = await one(`SELECT ${COLUMNS} FROM connectors c WHERE c.id = $1`, [c.id]);
  // The first full collection starts right away (next_run_at defaults to now()).
  res.status(201).json({ ...withUrl(created), webhook_secret: webhookSecret });
});

router.put('/:id', requireAuth('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  const existing = await one('SELECT * FROM connectors WHERE id = $1', [id]);
  if (!existing) throw new HttpError(404, 'connector not found');
  const body = req.body || {};
  const cfg = body.config ? parseConfig(existing.provider, body, existing.config) : existing.config;
  const pat = body.pat ? str(body.pat, 'pat', { max: 1000 }) : null;
  const schedule = intIn(body.schedule_minutes, 'schedule_minutes', 5, 10080, existing.schedule_minutes);
  await query(
    `UPDATE connectors SET name = COALESCE($2, name), config = $3, credential_enc = COALESCE($4, credential_enc),
       schedule_minutes = $5, enabled = COALESCE($6, enabled),
       next_run_at = CASE WHEN $5 <> schedule_minutes THEN LEAST(next_run_at, now() + make_interval(mins => $5)) ELSE next_run_at END,
       updated_at = now()
     WHERE id = $1`,
    [id, body.name ? str(body.name, 'name', { max: 100 }) : null, cfg, pat ? encrypt(pat) : null, schedule,
      typeof body.enabled === 'boolean' ? body.enabled : null]);
  await audit(req, 'update', 'connector', id, { config: cfg, patRotated: Boolean(pat), schedule, enabled: body.enabled });
  res.json(withUrl(await one(`SELECT ${COLUMNS} FROM connectors c WHERE c.id = $1`, [id])));
});

router.delete('/:id', requireAuth('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  // Assets collected by this connector are soft-deleted so they stop counting.
  await query('UPDATE assets SET deleted_at = now() WHERE connector_id = $1 AND deleted_at IS NULL', [id]);
  const r = await one('DELETE FROM connectors WHERE id = $1 RETURNING name', [id]);
  if (!r) throw new HttpError(404, 'connector not found');
  await audit(req, 'delete', 'connector', id, r);
  res.status(204).end();
});

/** Verify a PAT before saving (body: provider, config, pat) or for a saved connector (/:id/test). */
async function runTest(provider, cfg, pat) {
  const p = providers[provider];
  if (!p) throw new HttpError(400, 'unknown provider');
  try {
    return await p.testConnection(cfg, pat);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

router.post('/test', requireAuth('admin'), async (req, res) => {
  const body = req.body || {};
  const cfg = parseConfig(body.provider, body);
  res.json(await runTest(body.provider, cfg, str(body.pat, 'pat', { max: 1000 })));
});

router.post('/:id/test', requireAuth('editor'), async (req, res) => {
  const c = await one('SELECT * FROM connectors WHERE id = $1', [uuid(req.params.id)]);
  if (!c) throw new HttpError(404, 'connector not found');
  res.json(await runTest(c.provider, c.config, decrypt(c.credential_enc)));
});

router.post('/:id/run', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const c = await one('SELECT id FROM connectors WHERE id = $1', [id]);
  if (!c) throw new HttpError(404, 'connector not found');
  const run = await one(
    `INSERT INTO collection_runs (connector_id, trigger)
     SELECT $1, 'manual' WHERE NOT EXISTS (
       SELECT 1 FROM collection_runs WHERE connector_id = $1 AND status = 'queued' AND scope IS NULL)
     RETURNING id`, [id]);
  if (run) await notify('cap_collect', run.id);
  await audit(req, 'run', 'connector', id);
  res.status(202).json({ queued: Boolean(run), run_id: run?.id ?? null });
});

router.get('/:id/runs', requireAuth(), async (req, res) => {
  const { limit, offset } = paging(req.query, 200);
  res.json({ items: await many(
    `SELECT id, trigger, scope, status, claimed_by, started_at, finished_at, stats, error, created_at
     FROM collection_runs WHERE connector_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [uuid(req.params.id), limit, offset]) });
});

router.get('/:id/webhook', requireAuth('admin'), async (req, res) => {
  const c = await one('SELECT id, provider, webhook_secret_enc FROM connectors WHERE id = $1', [uuid(req.params.id)]);
  if (!c) throw new HttpError(404, 'connector not found');
  res.json({ url: webhookUrl(c), secret: decrypt(c.webhook_secret_enc) });
});

router.post('/:id/webhook/rotate', requireAuth('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  const secret = randomToken(24);
  const c = await one('UPDATE connectors SET webhook_secret_enc = $2, updated_at = now() WHERE id = $1 RETURNING id, provider',
    [id, encrypt(secret)]);
  if (!c) throw new HttpError(404, 'connector not found');
  await audit(req, 'rotate_webhook_secret', 'connector', id);
  res.json({ url: webhookUrl(c), secret });
});

// ---- runs across all connectors ----------------------------------------
runsRouter.get('/', requireAuth(), async (req, res) => {
  const { limit, offset } = paging(req.query, 200);
  res.json({ items: await many(
    `SELECT r.id, r.connector_id, c.name AS connector_name, c.provider, r.trigger, r.scope, r.status,
            r.started_at, r.finished_at, r.stats, r.error, r.created_at
     FROM collection_runs r JOIN connectors c ON c.id = r.connector_id
     ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]) });
});
