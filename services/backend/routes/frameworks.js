import { Router } from 'express';
import { many, one, tx } from '../../common/db.js';
import { requireAuth } from '../../common/auth.js';
import { HttpError, str, uuid } from '../../common/http.js';
import { audit } from '../audit.js';

export const router = Router();
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

router.get('/', requireAuth(), async (_req, res) => {
  res.json({ items: await many(
    `SELECT f.*, count(fc.control_id)::int AS control_count
     FROM frameworks f LEFT JOIN framework_controls fc ON fc.framework_id = f.id
     GROUP BY f.id ORDER BY f.name`) });
});

router.get('/:id', requireAuth(), async (req, res) => {
  const id = uuid(req.params.id);
  const fw = await one('SELECT * FROM frameworks WHERE id = $1', [id]);
  if (!fw) throw new HttpError(404, 'framework not found');
  fw.controls = await many(
    `SELECT c.id, c.key, c.name, c.severity, c.asset_types, c.enabled, fc.reference
     FROM framework_controls fc JOIN controls c ON c.id = fc.control_id
     WHERE fc.framework_id = $1 ORDER BY fc.reference NULLS LAST, c.key`, [id]);
  res.json(fw);
});

function parse(body, partial = false) {
  const out = {
    name: str(body?.name, 'name', { required: !partial, max: 200 }),
    description: str(body?.description, 'description', { required: false, max: 5000 }),
    version: str(body?.version, 'version', { required: false, max: 50 }),
  };
  if (!partial) {
    out.key = str(body?.key, 'key', { max: 64 });
    if (!KEY_RE.test(out.key)) throw new HttpError(400, 'key may contain letters, digits, . _ - (2–64 chars)');
  }
  return out;
}

async function setControls(client, frameworkId, controls) {
  if (!Array.isArray(controls)) throw new HttpError(400, 'controls must be an array');
  await client.query('DELETE FROM framework_controls WHERE framework_id = $1', [frameworkId]);
  for (const c of controls) {
    const controlId = uuid(typeof c === 'string' ? c : c.control_id, 'control_id');
    await client.query(
      'INSERT INTO framework_controls (framework_id, control_id, reference) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [frameworkId, controlId, typeof c === 'object' ? c.reference ?? null : null]);
  }
}

router.post('/', requireAuth('editor'), async (req, res) => {
  const f = parse(req.body);
  const fw = await tx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO frameworks (key, name, description, version) VALUES ($1,$2,$3,$4) RETURNING *',
      [f.key, f.name, f.description, f.version]);
    if (req.body?.controls) await setControls(client, rows[0].id, req.body.controls);
    return rows[0];
  });
  await audit(req, 'create', 'framework', fw.id, { key: f.key });
  res.status(201).json(fw);
});

router.put('/:id', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const f = parse(req.body, true);
  const fw = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE frameworks SET name = COALESCE($2, name), description = $3, version = $4, updated_at = now()
       WHERE id = $1 RETURNING *`, [id, f.name, f.description, f.version]);
    if (!rows[0]) throw new HttpError(404, 'framework not found');
    if (req.body?.controls) await setControls(client, id, req.body.controls);
    return rows[0];
  });
  await audit(req, 'update', 'framework', id);
  res.json(fw);
});

router.put('/:id/controls', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  await tx(async (client) => {
    const { rows } = await client.query('SELECT 1 FROM frameworks WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'framework not found');
    await setControls(client, id, req.body?.controls ?? req.body);
  });
  await audit(req, 'set_controls', 'framework', id, { count: (req.body?.controls ?? req.body)?.length });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const r = await one('DELETE FROM frameworks WHERE id = $1 RETURNING key', [id]);
  if (!r) throw new HttpError(404, 'framework not found');
  await audit(req, 'delete', 'framework', id, r);
  res.status(204).end();
});
