// cap-collector: schedules and executes collection runs, receives webhooks.
import { config } from '../common/config.js';
import { listen, query, waitForDb, withAdvisoryLock } from '../common/db.js';
import { createApp, finalize, listenApp } from '../common/http.js';
import { log } from '../common/log.js';
import { sleep } from '../common/util.js';
import { claimRun, execute } from './runner.js';
import * as webhooks from './webhooks.js';

const MAX_PARALLEL = Number(process.env.COLLECTOR_PARALLEL_RUNS || 2);
const SCHEDULER_LOCK = 724_002;
let active = 0;
let wake = () => {};

/** Queue scheduled runs for due connectors; fail runs whose collector died. */
async function schedulerTick() {
  await withAdvisoryLock(SCHEDULER_LOCK, async () => {
    const { rows } = await query(
      `WITH due AS (
         UPDATE connectors c SET next_run_at = now() + make_interval(mins => c.schedule_minutes)
         WHERE c.enabled AND c.next_run_at <= now()
         RETURNING c.id)
       INSERT INTO collection_runs (connector_id, trigger)
       SELECT d.id, 'schedule' FROM due d
       WHERE NOT EXISTS (SELECT 1 FROM collection_runs r WHERE r.connector_id = d.id AND r.status IN ('queued','running'))
       RETURNING id, connector_id`);
    if (rows.length) { log.info('scheduled runs', { count: rows.length }); wake(); }
    const reaped = await query(
      `UPDATE collection_runs SET status = 'failed', finished_at = now(), error = 'collector instance stopped responding'
       WHERE status = 'running' AND heartbeat_at < now() - interval '5 minutes'`);
    if (reaped.rowCount) log.warn('reaped stale runs', { count: reaped.rowCount });
  });
}

async function schedulerLoop() {
  for (;;) {
    try { await schedulerTick(); } catch (err) { log.error('scheduler error', { err: err.message }); }
    await sleep(30_000);
  }
}

async function workerLoop() {
  for (;;) {
    try {
      while (active < MAX_PARALLEL) {
        const run = await claimRun();
        if (!run) break;
        active++;
        execute(run).finally(() => { active--; wake(); });
      }
    } catch (err) {
      log.error('worker error', { err: err.message });
    }
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 10_000); });
  }
}

const app = createApp({ rawBody: true, jsonLimit: '25mb' });
app.get('/internal/status', (_req, res) => res.json({ activeRuns: active, maxParallel: MAX_PARALLEL }));
webhooks.register(app);
finalize(app);

async function main() {
  await waitForDb();
  listen(['cap_collect'], () => wake());
  listenApp(app, config.port);
  schedulerLoop();
  workerLoop();
}

main().catch((err) => { log.error('fatal', { err }); process.exit(1); });
