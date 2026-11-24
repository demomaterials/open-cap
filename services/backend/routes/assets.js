import { Router } from 'express';
import { many, one, query, tx, notify } from '../../common/db.js';
import { requireAuth } from '../../common/auth.js';
import { HttpError, paging, str, uuid } from '../../common/http.js';
import { upsertAsset, ensureAssetType } from '../../common/assets.js';
import { audit } from '../audit.js';

export const router = Router();
export const typesRouter = Router();
const TYPE_RE = /^[a-z][a-z0-9_]{1,62}$/;

// ---- asset types --------------------------------------------------------
typesRouter.get('/', requireAuth(), async (_req, res) => {
  res.json({
    items: await many(
      `SELECT t.*, COALESCE(a.n, 0)::int AS asset_count
       FROM asset_types t
       LEFT JOIN (SELECT type, count(*) AS n FROM assets WHERE deleted_at IS NULL GROUP BY type) a ON a.type = t.type
       ORDER BY t.type`),
  });
});

typesRouter.post('/', requireAuth('editor'), async (req, res) => {
  const type = str(req.body?.type, 'type', { max: 63 });
  if (!TYPE_RE.test(type)) throw new HttpError(400, 'type must be snake_case (a-z, 0-9, _)');
  const row = await one(
    `INSERT INTO asset_types (type, display_name, description, provider) VALUES ($1,$2,$3,'manual') RETURNING *`,
    [type, str(req.body?.display_name, 'display_name', { max: 200 }), str(req.body?.description, 'description', { required: false, max: 2000 })]);
  await audit(req, 'create', 'asset_type', type);
  res.status(201).json(row);
});

// ---- assets -------------------------------------------------------------
router.get('/', requireAuth(), async (req, res) => {
  const { limit, offset } = paging(req.query);
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.include_deleted !== 'true') where.push('a.deleted_at IS NULL');
  if (req.query.type) add('a.type = ?', String(req.query.type));
  if (req.query.connector) add('a.connector_id = ?', uuid(req.query.connector, 'connector'));
  if (req.query.owner) add('a.owner ILIKE ?', `%${req.query.owner}%`);
  if (req.query.q) add('(a.name ILIKE ? OR a.external_id ILIKE $' + (params.length + 1) + ')', `%${req.query.q}%`);
  if (req.query.status) {
    // assets having at least one result with this status
    add(`EXISTS (SELECT 1 FROM applicable_results r WHERE r.asset_id = a.id AND r.status = ?)`, String(req.query.status));
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one(`SELECT count(*)::int AS n FROM assets a ${w}`, params);
  params.push(limit, offset);
  const items = await many(
    `SELECT a.id, a.type, a.external_id, a.name, a.owner, jsonb_array_length(a.members) AS member_count,
            a.connector_id, c.name AS connector_name, a.last_collected_at, a.last_changed_at, a.deleted_at,
            COALESCE(s.pass,0)::int AS pass, COALESCE(s.fail,0)::int AS fail, COALESCE(s.skip,0)::int AS skip,
            COALESCE(s.error,0)::int AS error, COALESCE(s.pending,0)::int AS pending
     FROM assets a
     LEFT JOIN connectors c ON c.id = a.connector_id
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE status='pass') AS pass, count(*) FILTER (WHERE status='fail') AS fail,
              count(*) FILTER (WHERE status='skip') AS skip, count(*) FILTER (WHERE status='error') AS error,
              count(*) FILTER (WHERE status='pending') AS pending
       FROM applicable_results r WHERE r.asset_id = a.id) s ON true
     ${w}
     ORDER BY a.type, a.name
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ items, total: total.n, limit, offset });
});

router.get('/:id', requireAuth(), async (req, res) => {
  const id = uuid(req.params.id);
  const asset = await one(
    `SELECT a.*, c.name AS connector_name, p.name AS parent_name, p.type AS parent_type,
            (SELECT count(*)::int FROM assets ch WHERE ch.parent_id = a.id AND ch.deleted_at IS NULL) AS child_count
     FROM assets a LEFT JOIN connectors c ON c.id = a.connector_id LEFT JOIN assets p ON p.id = a.parent_id
     WHERE a.id = $1`, [id]);
  if (!asset) throw new HttpError(404, 'asset not found');
  asset.definition = { id: asset.id, ...asset.definition };
  res.json(asset);
});

router.get('/:id/history', requireAuth(), async (req, res) => {
  const id = uuid(req.params.id);
  res.json({
    items: await many(
      `SELECT id, content_hash, collected_at, definition FROM asset_history WHERE asset_id = $1
       ORDER BY collected_at DESC LIMIT 50`, [id]),
  });
});

router.get('/:id/children', requireAuth(), async (req, res) => {
  const id = uuid(req.params.id);
  res.json({ items: await many(
    `SELECT id, type, name, owner FROM assets WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY type, name LIMIT 1000`, [id]) });
});

function parseManual(body) {
  const type = str(body?.type, 'type', { max: 63 });
  if (!TYPE_RE.test(type)) throw new HttpError(400, 'type must be snake_case');
  const name = str(body?.name, 'name', { max: 500 });
  const members = body?.members ?? [];
  if (!Array.isArray(members)) throw new HttpError(400, 'members must be an array');
  if (body?.data !== undefined && (typeof body.data !== 'object' || body.data === null)) throw new HttpError(400, 'data must be an object');
  return {
    type,
    external_id: str(body?.external_id, 'external_id', { required: false, max: 500 }) || `manual:${type}:${name}`,
    name,
    owner: str(body?.owner, 'owner', { required: false, max: 300 }),
    members: members.map((m) => (typeof m === 'string' ? { login: m } : m)),
    source: { provider: body?.source || 'manual' },
    data: body?.data ?? {},
    related: body?.related ?? {},
    errors: {},
  };
}

async function ingest(req, items) {
  const results = [];
  await tx(async (client) => {
    for (const raw of items) {
      const asset = parseManual(raw);
      await ensureAssetType(client, asset.type, raw.type_display_name, 'manual');
      const r = await upsertAsset(client, asset);
      results.push({ id: r.id, type: asset.type, external_id: asset.external_id, created: r.created, changed: r.changed });
    }
  });
  await notify('cap_eval');
  await audit(req, 'ingest', 'asset', null, { count: results.length });
  return results;
}

// Manual registration ("Application" etc.) and the generic ingest API for other collectors.
router.post('/', requireAuth('editor'), async (req, res) => {
  const [r] = await ingest(req, [req.body]);
  res.status(r.created ? 201 : 200).json(r);
});

router.post('/ingest', requireAuth('editor'), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.assets;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'body must be an array of assets (or {assets:[…]})');
  if (items.length > 5000) throw new HttpError(400, 'at most 5000 assets per request');
  res.json({ items: await ingest(req, items) });
});

router.delete('/:id', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const r = await one('UPDATE assets SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING name, type', [id]);
  if (!r) throw new HttpError(404, 'asset not found');
  await audit(req, 'delete', 'asset', id, r);
  res.status(204).end();
});

router.post('/:id/evaluate', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  await query(`INSERT INTO eval_queue (asset_id, reason) VALUES ($1,'manual') ON CONFLICT DO NOTHING`, [id]);
  await notify('cap_eval');
  res.status(202).json({ queued: true });
});
