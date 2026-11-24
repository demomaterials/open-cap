import { Router } from 'express';
import { many, one, query, tx, notify } from '../../common/db.js';
import { requireAuth } from '../../common/auth.js';
import { HttpError, str, uuid } from '../../common/http.js';
import { callEvaluator } from '../evaluatorClient.js';
import { audit } from '../audit.js';

export const router = Router();
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

router.get('/', requireAuth(), async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.asset_type) { params.push(String(req.query.asset_type)); where.push(`$${params.length} = ANY(c.asset_types)`); }
  if (req.query.framework) { params.push(uuid(req.query.framework, 'framework')); where.push(`EXISTS (SELECT 1 FROM framework_controls fc WHERE fc.control_id = c.id AND fc.framework_id = $${params.length})`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(c.key ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ items: await many(
    `SELECT c.id, c.key, c.name, c.description, c.severity, c.asset_types, c.enabled, c.version, c.compile_error,
            c.updated_at, c.created_by,
            COALESCE((SELECT json_agg(json_build_object('id', f.id, 'key', f.key, 'name', f.name) ORDER BY f.name)
                      FROM framework_controls fc JOIN frameworks f ON f.id = fc.framework_id WHERE fc.control_id = c.id), '[]') AS frameworks
     FROM controls c ${w} ORDER BY c.key`, params) });
});

router.get('/:id', requireAuth(), async (req, res) => {
  const id = uuid(req.params.id);
  const c = await one('SELECT * FROM controls WHERE id = $1', [id]);
  if (!c) throw new HttpError(404, 'control not found');
  c.frameworks = await many(
    `SELECT f.id, f.key, f.name, fc.reference FROM framework_controls fc JOIN frameworks f ON f.id = fc.framework_id
     WHERE fc.control_id = $1 ORDER BY f.name`, [id]);
  res.json(c);
});

async function validateRego(rego) {
  const r = await callEvaluator('/internal/validate', { rego });
  if (!r.ok) throw new HttpError(400, 'rego does not compile', r.errors);
}

function parse(body, partial) {
  const c = {};
  if (!partial || body.key !== undefined) {
    c.key = str(body.key, 'key', { max: 64 });
    if (!KEY_RE.test(c.key)) throw new HttpError(400, 'key may contain letters, digits, . _ - (2–64 chars)');
  }
  if (!partial || body.name !== undefined) c.name = str(body.name, 'name', { max: 300 });
  if (body.description !== undefined) c.description = str(body.description, 'description', { required: false, max: 10_000 });
  if (body.remediation !== undefined) c.remediation = str(body.remediation, 'remediation', { required: false, max: 10_000 });
  if (!partial || body.severity !== undefined) {
    c.severity = body.severity || 'medium';
    if (!SEVERITIES.includes(c.severity)) throw new HttpError(400, `severity must be one of ${SEVERITIES.join(', ')}`);
  }
  if (!partial || body.asset_types !== undefined) {
    if (!Array.isArray(body.asset_types) || body.asset_types.length === 0 || body.asset_types.some((t) => typeof t !== 'string')) {
      throw new HttpError(400, 'asset_types must be a non-empty array of asset type names');
    }
    c.asset_types = [...new Set(body.asset_types)];
  }
  if (!partial || body.rego !== undefined) c.rego = str(body.rego, 'rego', { max: 100_000 });
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean');
    c.enabled = body.enabled;
  }
  return c;
}

async function checkTypes(types) {
  const rows = await many('SELECT type FROM asset_types WHERE type = ANY($1)', [types]);
  const known = new Set(rows.map((r) => r.type));
  const unknown = types.filter((t) => !known.has(t));
  if (unknown.length) throw new HttpError(400, `unknown asset type(s): ${unknown.join(', ')}`);
}

async function setFrameworks(client, controlId, frameworks) {
  if (!Array.isArray(frameworks)) return;
  await client.query('DELETE FROM framework_controls WHERE control_id = $1', [controlId]);
  for (const f of frameworks) {
    const fid = uuid(typeof f === 'string' ? f : f.id ?? f.framework_id, 'framework id');
    await client.query('INSERT INTO framework_controls (framework_id, control_id, reference) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [fid, controlId, typeof f === 'object' ? f.reference ?? null : null]);
  }
}

/** Queue every active asset the control applies to. */
async function enqueueForControl(controlId, reason) {
  await query(
    `INSERT INTO eval_queue (asset_id, reason)
     SELECT a.id, $2 FROM assets a JOIN controls c ON a.type = ANY(c.asset_types)
     WHERE c.id = $1 AND a.deleted_at IS NULL
     ON CONFLICT (asset_id) DO NOTHING`, [controlId, reason]);
  await notify('cap_control_changed', controlId);
}

router.post('/', requireAuth('editor'), async (req, res) => {
  const c = parse(req.body || {}, false);
  await checkTypes(c.asset_types);
  await validateRego(c.rego);
  const control = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO controls (key, name, description, severity, asset_types, rego, remediation, enabled, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true),$9) RETURNING *`,
      [c.key, c.name, c.description ?? null, c.severity, c.asset_types, c.rego, c.remediation ?? null, c.enabled ?? null, req.user.username]);
    await setFrameworks(client, rows[0].id, req.body.frameworks);
    return rows[0];
  });
  await enqueueForControl(control.id, 'control_created');
  await audit(req, 'create', 'control', control.id, { key: c.key });
  res.status(201).json(control);
});

router.put('/:id', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const c = parse(req.body || {}, true);
  if (c.asset_types) await checkTypes(c.asset_types);
  if (c.rego) await validateRego(c.rego);
  const control = await tx(async (client) => {
    const { rows: [before] } = await client.query('SELECT * FROM controls WHERE id = $1 FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'control not found');
    const evalChanged = (c.rego !== undefined && c.rego !== before.rego)
      || (c.asset_types && c.asset_types.join(',') !== before.asset_types.join(','))
      || (c.enabled !== undefined && c.enabled !== before.enabled);
    const { rows } = await client.query(
      `UPDATE controls SET key = COALESCE($2, key), name = COALESCE($3, name),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         severity = COALESCE($6, severity), asset_types = COALESCE($7, asset_types), rego = COALESCE($8, rego),
         remediation = CASE WHEN $9::boolean THEN $10 ELSE remediation END,
         enabled = COALESCE($11, enabled), version = version + $12, compile_error = CASE WHEN $12 > 0 THEN NULL ELSE compile_error END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, c.key ?? null, c.name ?? null, c.description !== undefined, c.description ?? null, c.severity ?? null,
        c.asset_types ?? null, c.rego ?? null, c.remediation !== undefined, c.remediation ?? null, c.enabled ?? null, evalChanged ? 1 : 0]);
    await setFrameworks(client, id, req.body.frameworks);
    return { ...rows[0], evalChanged };
  });
  if (control.evalChanged) await enqueueForControl(id, 'control_changed');
  await audit(req, 'update', 'control', id, { key: control.key, version: control.version });
  res.json(control);
});

router.delete('/:id', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const r = await one('DELETE FROM controls WHERE id = $1 RETURNING key', [id]);
  if (!r) throw new HttpError(404, 'control not found');
  await notify('cap_control_changed', id);
  await audit(req, 'delete', 'control', id, r);
  res.status(204).end();
});

router.post('/validate', requireAuth('editor'), async (req, res) => {
  const rego = str(req.body?.rego, 'rego', { max: 100_000 });
  res.json(await callEvaluator('/internal/validate', { rego }));
});

/** Evaluate unsaved Rego against an existing asset (asset_id) or an ad-hoc definition. */
router.post('/test', requireAuth('editor'), async (req, res) => {
  const rego = str(req.body?.rego, 'rego', { max: 100_000 });
  let definition = req.body?.definition;
  if (req.body?.asset_id) {
    const a = await one('SELECT id, definition FROM assets WHERE id = $1', [uuid(req.body.asset_id, 'asset_id')]);
    if (!a) throw new HttpError(404, 'asset not found');
    definition = { id: a.id, ...a.definition };
  }
  if (!definition || typeof definition !== 'object') throw new HttpError(400, 'asset_id or definition is required');
  res.json(await callEvaluator('/internal/test', { rego, definition }));
});

router.post('/:id/evaluate', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  await enqueueForControl(id, 'manual');
  res.status(202).json({ queued: true });
});
