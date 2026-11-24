// cap-presenter: read-only compliance API (/api/compliance/*) and periodic snapshots.
//
// Compliance for any scope (overall, framework, control, owner, asset type):
//   applicable pairs = active assets × enabled controls whose asset_types include the asset's type
//   score            = pass / (pairs − skip − error − pending) × 100
// Skipped, errored (unexecutable) and not-yet-evaluated pairs leave both numerator and denominator.
import { config } from '../common/config.js';
import { many, one, query, waitForDb, withAdvisoryLock } from '../common/db.js';
import { requireAuth } from '../common/auth.js';
import { createApp, finalize, HttpError, intIn, listenApp, paging, uuid } from '../common/http.js';
import { log } from '../common/log.js';
import { sleep } from '../common/util.js';

const SNAPSHOT_MINUTES = Number(process.env.SNAPSHOT_MINUTES || 15);
const SNAPSHOT_LOCK = 724_004;
const STATUSES = ['pass', 'fail', 'skip', 'error', 'pending'];

const COUNTS = `
  count(r.asset_id)::int AS total,
  count(*) FILTER (WHERE r.status = 'pass')::int    AS pass,
  count(*) FILTER (WHERE r.status = 'fail')::int    AS fail,
  count(*) FILTER (WHERE r.status = 'skip')::int    AS skip,
  count(*) FILTER (WHERE r.status = 'error')::int   AS error,
  count(*) FILTER (WHERE r.status = 'pending')::int AS pending`;
const SCORE = `compliance_score(
  count(*) FILTER (WHERE r.status = 'pass'), count(r.asset_id),
  count(*) FILTER (WHERE r.status = 'skip'), count(*) FILTER (WHERE r.status = 'error'),
  count(*) FILTER (WHERE r.status = 'pending')) AS score`;

const app = createApp();
const api = '/api/compliance';
const auth = requireAuth();

app.get(`${api}/summary`, auth, async (_req, res) => {
  const overall = await one(`SELECT ${COUNTS}, ${SCORE} FROM applicable_results r`);
  const frameworks = await many(
    `SELECT f.id, f.key, f.name, f.version,
            (SELECT count(*)::int FROM framework_controls x WHERE x.framework_id = f.id) AS control_count,
            ${COUNTS}, ${SCORE}
     FROM frameworks f
     LEFT JOIN framework_controls fc ON fc.framework_id = f.id
     LEFT JOIN applicable_results r ON r.control_id = fc.control_id
     GROUP BY f.id ORDER BY f.name`);
  // LEFT JOIN yields one all-NULL row for empty frameworks; count(*) would report 1.
  for (const f of frameworks) if (f.pass + f.fail + f.skip + f.error + f.pending === 0) { f.total = 0; f.score = null; }
  const byType = await many(
    `SELECT r.asset_type, count(DISTINCT r.asset_id)::int AS assets, ${COUNTS}, ${SCORE}
     FROM applicable_results r GROUP BY r.asset_type ORDER BY r.asset_type`);
  const bySeverity = await many(
    `SELECT c.severity, ${COUNTS}, ${SCORE}
     FROM applicable_results r JOIN controls c ON c.id = r.control_id GROUP BY c.severity
     ORDER BY array_position(ARRAY['critical','high','medium','low','info'], c.severity)`);
  const inventory = await one(
    `SELECT (SELECT count(*) FROM assets WHERE deleted_at IS NULL)::int AS assets,
            (SELECT count(*) FROM controls WHERE enabled)::int AS controls,
            (SELECT count(*) FROM eval_queue)::int AS eval_queue,
            (SELECT max(evaluated_at) FROM evaluations) AS last_evaluation,
            (SELECT max(finished_at) FROM collection_runs WHERE status = 'succeeded') AS last_collection`);
  const trend = await many(
    `SELECT date_trunc('hour', taken_at) AS t, avg(score)::numeric(6,2) AS score
     FROM compliance_snapshots WHERE scope = 'overall' AND taken_at > now() - interval '30 days'
     GROUP BY 1 ORDER BY 1`);
  res.json({ overall, frameworks, by_asset_type: byType, by_severity: bySeverity, inventory, trend });
});

app.get(`${api}/frameworks/:id`, auth, async (req, res) => {
  const id = uuid(req.params.id);
  const fw = await one('SELECT * FROM frameworks WHERE id = $1', [id]);
  if (!fw) throw new HttpError(404, 'framework not found');
  fw.totals = await one(
    `SELECT ${COUNTS}, ${SCORE} FROM framework_controls fc JOIN applicable_results r ON r.control_id = fc.control_id
     WHERE fc.framework_id = $1`, [id]);
  fw.controls = await many(
    `SELECT c.id, c.key, c.name, c.severity, c.asset_types, c.enabled, c.compile_error, fc.reference,
            ${COUNTS}, ${SCORE}
     FROM framework_controls fc
     JOIN controls c ON c.id = fc.control_id
     LEFT JOIN applicable_results r ON r.control_id = c.id
     WHERE fc.framework_id = $1
     GROUP BY c.id, fc.reference
     ORDER BY fc.reference NULLS LAST, c.key`, [id]);
  for (const c of fw.controls) if (c.pass + c.fail + c.skip + c.error + c.pending === 0) { c.total = 0; c.score = null; }
  fw.trend = await many(
    `SELECT date_trunc('hour', taken_at) AS t, avg(score)::numeric(6,2) AS score FROM compliance_snapshots
     WHERE scope = 'framework' AND scope_id = $1 AND taken_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [id]);
  res.json(fw);
});

app.get(`${api}/controls/:id`, auth, async (req, res) => {
  const id = uuid(req.params.id);
  const control = await one(
    `SELECT id, key, name, description, severity, asset_types, enabled, version, compile_error, remediation, rego, updated_at
     FROM controls WHERE id = $1`, [id]);
  if (!control) throw new HttpError(404, 'control not found');
  control.totals = await one(`SELECT ${COUNTS}, ${SCORE} FROM applicable_results r WHERE r.control_id = $1`, [id]);
  control.frameworks = await many(
    `SELECT f.id, f.key, f.name, fc.reference FROM framework_controls fc JOIN frameworks f ON f.id = fc.framework_id
     WHERE fc.control_id = $1 ORDER BY f.name`, [id]);
  res.json(control);
});

app.get(`${api}/controls/:id/results`, auth, async (req, res) => {
  const id = uuid(req.params.id);
  const { limit, offset } = paging(req.query);
  const params = [id];
  let filter = '';
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
    params.push(req.query.status);
    filter += ` AND r.status = $${params.length}`;
  }
  if (req.query.q) { params.push(`%${req.query.q}%`); filter += ` AND (a.name ILIKE $${params.length} OR a.owner ILIKE $${params.length})`; }
  const total = await one(
    `SELECT count(*)::int AS n FROM applicable_results r JOIN assets a ON a.id = r.asset_id WHERE r.control_id = $1 ${filter}`, params);
  params.push(limit, offset);
  const items = await many(
    `SELECT a.id AS asset_id, a.name, a.type, a.owner, r.status, COALESCE(r.reasons, '[]') AS reasons, r.evaluated_at, r.stale,
            e.status_since, a.definition->'source'->>'html_url' AS html_url, a.definition->'source'->>'web_url' AS web_url
     FROM applicable_results r
     JOIN assets a ON a.id = r.asset_id
     LEFT JOIN evaluations e ON e.asset_id = r.asset_id AND e.control_id = r.control_id
     WHERE r.control_id = $1 ${filter}
     ORDER BY a.name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ items, total: total.n, limit, offset });
});

app.get(`${api}/assets/:id`, auth, async (req, res) => {
  const id = uuid(req.params.id);
  const totals = await one(`SELECT ${COUNTS}, ${SCORE} FROM applicable_results r WHERE r.asset_id = $1`, [id]);
  const results = await many(
    `SELECT c.id AS control_id, c.key, c.name, c.severity, r.status, COALESCE(r.reasons, '[]') AS reasons, r.evaluated_at, r.stale,
            COALESCE((SELECT json_agg(f.key ORDER BY f.key) FROM framework_controls fc JOIN frameworks f ON f.id = fc.framework_id
                      WHERE fc.control_id = c.id), '[]') AS frameworks
     FROM applicable_results r JOIN controls c ON c.id = r.control_id
     WHERE r.asset_id = $1
     ORDER BY array_position(ARRAY['fail','error','pending','skip','pass'], r.status), c.key`, [id]);
  res.json({ totals, results });
});

app.get(`${api}/owners`, auth, async (req, res) => {
  const limit = intIn(req.query.limit, 'limit', 1, 500, 50);
  res.json({ items: await many(
    `SELECT COALESCE(r.owner, '(unowned)') AS owner, count(DISTINCT r.asset_id)::int AS assets, ${COUNTS}, ${SCORE}
     FROM applicable_results r GROUP BY 1 ORDER BY fail DESC, owner LIMIT $1`, [limit]) });
});

app.get(`${api}/trend`, auth, async (req, res) => {
  const scope = req.query.scope || 'overall';
  if (!['overall', 'framework', 'control'].includes(scope)) throw new HttpError(400, 'scope must be overall, framework or control');
  const days = intIn(req.query.days, 'days', 1, 365, 30);
  const params = [scope, days];
  let filter = '';
  if (scope !== 'overall') { params.push(uuid(req.query.id)); filter = 'AND scope_id = $3'; }
  res.json({ items: await many(
    `SELECT date_trunc('hour', taken_at) AS t, avg(score)::numeric(6,2) AS score,
            max(passing) AS passing, max(failing) AS failing, max(skipped) AS skipped
     FROM compliance_snapshots WHERE scope = $1 AND taken_at > now() - make_interval(days => $2) ${filter}
     GROUP BY 1 ORDER BY 1`, params) });
});

app.get(`${api}/events`, auth, async (req, res) => {
  const { limit } = paging(req.query, 200);
  res.json({ items: await many(
    `SELECT ev.id, ev.occurred_at, ev.from_status, ev.to_status, ev.reasons,
            a.id AS asset_id, a.name AS asset_name, a.type AS asset_type, c.id AS control_id, c.key AS control_key, c.name AS control_name
     FROM evaluation_events ev JOIN assets a ON a.id = ev.asset_id JOIN controls c ON c.id = ev.control_id
     WHERE ev.from_status IS NOT NULL
     ORDER BY ev.occurred_at DESC LIMIT $1`, [limit]) });
});

function csvCell(v) {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

app.get(`${api}/export.csv`, auth, async (req, res) => {
  const params = [];
  let join = '';
  if (req.query.framework) {
    params.push(uuid(req.query.framework, 'framework'));
    join = 'JOIN framework_controls fc ON fc.control_id = r.control_id AND fc.framework_id = $1';
  }
  const rows = await many(
    `SELECT c.key AS control_key, c.name AS control_name, c.severity, a.type AS asset_type, a.name AS asset_name,
            a.owner, r.status, r.reasons, r.evaluated_at
     FROM applicable_results r ${join}
     JOIN controls c ON c.id = r.control_id JOIN assets a ON a.id = r.asset_id
     ORDER BY c.key, a.name`, params);
  const cols = ['control_key', 'control_name', 'severity', 'asset_type', 'asset_name', 'owner', 'status', 'reasons', 'evaluated_at'];
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="cap-compliance.csv"');
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
});

finalize(app);

async function snapshot() {
  await withAdvisoryLock(SNAPSHOT_LOCK, async () => {
    const recent = await one(
      `SELECT 1 AS x FROM compliance_snapshots WHERE scope = 'overall' AND taken_at > now() - make_interval(mins => $1)`,
      [Math.max(1, SNAPSHOT_MINUTES - 1)]);
    if (recent) return;
    const cols = `total, passing, failing, skipped, errored, pending, score`;
    const agg = `count(*), count(*) FILTER (WHERE r.status='pass'), count(*) FILTER (WHERE r.status='fail'),
                 count(*) FILTER (WHERE r.status='skip'), count(*) FILTER (WHERE r.status='error'),
                 count(*) FILTER (WHERE r.status='pending'), ${SCORE.replace(' AS score', '')}`;
    await query(`INSERT INTO compliance_snapshots (scope, scope_id, ${cols})
                 SELECT 'overall', NULL, ${agg} FROM applicable_results r`);
    await query(`INSERT INTO compliance_snapshots (scope, scope_id, ${cols})
                 SELECT 'framework', fc.framework_id, ${agg} FROM framework_controls fc
                 JOIN applicable_results r ON r.control_id = fc.control_id GROUP BY fc.framework_id`);
    await query(`INSERT INTO compliance_snapshots (scope, scope_id, ${cols})
                 SELECT 'control', r.control_id, ${agg} FROM applicable_results r GROUP BY r.control_id`);
    await query(`DELETE FROM compliance_snapshots WHERE taken_at < now() - interval '400 days'`);
    log.info('compliance snapshot taken');
  });
}

async function snapshotLoop() {
  for (;;) {
    try { await snapshot(); } catch (err) { log.error('snapshot failed', { err: err.message }); }
    await sleep(60_000);
  }
}

async function main() {
  await waitForDb();
  listenApp(app, config.port);
  snapshotLoop();
}

main().catch((err) => { log.error('fatal', { err }); process.exit(1); });
