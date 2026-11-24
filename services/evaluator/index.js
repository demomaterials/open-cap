// cap-evaluator: drains eval_queue, evaluates controls (Rego via OPA sidecar),
// and serves in-cluster /internal/validate and /internal/test for the backend.
import { config } from '../common/config.js';
import { listen, query, waitForDb, withAdvisoryLock } from '../common/db.js';
import { createApp, finalize, HttpError, listenApp } from '../common/http.js';
import { log } from '../common/log.js';
import { mapLimit, sleep } from '../common/util.js';
import * as engine from './engine.js';
import * as opa from './opa.js';

const BATCH = Number(process.env.EVAL_BATCH || 25);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 4);
const SWEEP_SECONDS = Number(process.env.EVAL_SWEEP_SECONDS || 60);
const SWEEP_LOCK = 724_001;

let wake = () => {};
const stats = { evaluatedAssets: 0, evaluations: 0, lastBatchAt: null };

async function claimBatch() {
  // DELETE … RETURNING with SKIP LOCKED: each replica gets disjoint assets.
  const { rows } = await query(
    `DELETE FROM eval_queue WHERE asset_id IN (
       SELECT asset_id FROM eval_queue ORDER BY enqueued_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING asset_id`, [BATCH]);
  return rows.map((r) => r.asset_id);
}

async function workLoop() {
  for (;;) {
    try {
      await engine.checkOpa();
      const ids = await claimBatch();
      if (ids.length === 0) {
        await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 10_000); });
        continue;
      }
      const counts = await mapLimit(ids, CONCURRENCY, async (id) => {
        try {
          return await engine.evaluateAsset(id);
        } catch (err) {
          log.error('asset evaluation failed; requeueing', { asset: id, err });
          await query('INSERT INTO eval_queue (asset_id, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, 'retry'])
            .catch(() => {});
          return 0;
        }
      });
      const n = counts.reduce((a, b) => a + b, 0);
      stats.evaluatedAssets += ids.length;
      stats.evaluations += n;
      stats.lastBatchAt = new Date().toISOString();
      log.info('evaluated batch', { assets: ids.length, evaluations: n });
    } catch (err) {
      log.error('work loop error', { err: err.message });
      await sleep(5000);
    }
  }
}

/** Safety net: queue assets whose results are missing or stale (control/asset changed). */
async function sweepLoop() {
  for (;;) {
    await sleep(SWEEP_SECONDS * 1000);
    try {
      await withAdvisoryLock(SWEEP_LOCK, async () => {
        const { rowCount } = await query(
          `INSERT INTO eval_queue (asset_id, reason)
           SELECT DISTINCT asset_id, 'sweep' FROM applicable_results WHERE status = 'pending' OR stale
           ON CONFLICT (asset_id) DO NOTHING`);
        if (rowCount) { log.info('sweep queued assets', { count: rowCount }); wake(); }
      });
    } catch (err) {
      log.error('sweep failed', { err: err.message });
    }
  }
}

const app = createApp({ jsonLimit: '20mb', readyCheck: () => opa.healthy() });

app.get('/internal/status', async (_req, res) => {
  const { rows } = await query('SELECT count(*)::int AS queued FROM eval_queue');
  res.json({ opa: await opa.healthy(), queued: rows[0].queued, ...stats });
});

app.post('/internal/validate', async (req, res) => {
  const rego = req.body?.rego;
  if (typeof rego !== 'string') throw new HttpError(400, 'rego is required');
  const r = await engine.validate(rego);
  res.json({ ok: r.ok, errors: r.errors || [] });
});

app.post('/internal/test', async (req, res) => {
  const { rego, definition } = req.body || {};
  if (typeof rego !== 'string') throw new HttpError(400, 'rego is required');
  if (!definition || typeof definition !== 'object') throw new HttpError(400, 'definition is required');
  res.json(await engine.test(rego, definition));
});

finalize(app);

async function main() {
  for (let i = 0; !(await opa.healthy()); i++) {
    if (i % 10 === 0) log.info('waiting for OPA sidecar');
    await sleep(1000);
  }
  await waitForDb();
  listen(['cap_eval', 'cap_control_changed'], (channel, payload) => {
    if (channel === 'cap_control_changed' && payload) engine.forget(payload);
    wake();
  });
  listenApp(app, config.port);
  workLoop();
  sweepLoop();
}

main().catch((err) => { log.error('fatal', { err }); process.exit(1); });
