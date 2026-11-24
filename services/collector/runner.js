// Executes collection runs: claim → provider.collect → upsert assets → reconcile deletions.
import { many, notify, one, pool, query } from '../common/db.js';
import { decrypt } from '../common/crypto.js';
import { upsertAsset } from '../common/assets.js';
import { log } from '../common/log.js';
import { instanceId } from '../common/util.js';
import * as github from './providers/github.js';
import * as ado from './providers/ado.js';

export const providers = { github, ado };
const ME = instanceId();

export async function claimRun() {
  return one(
    `UPDATE collection_runs SET status = 'running', claimed_by = $1, started_at = now(), heartbeat_at = now()
     WHERE id = (
       SELECT r.id FROM collection_runs r
       WHERE r.status = 'queued'
         AND NOT EXISTS (SELECT 1 FROM collection_runs x WHERE x.connector_id = r.connector_id AND x.status = 'running')
       ORDER BY r.created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [ME]);
}

export async function execute(run) {
  const connector = await one('SELECT * FROM connectors WHERE id = $1', [run.connector_id]);
  const provider = connector && providers[connector.provider];
  const counter = { calls: 0 };
  const stats = { assets: 0, created: 0, changed: 0, deleted: 0, enrichment_errors: 0, api_calls: 0 };
  const heartbeat = setInterval(() => {
    query('UPDATE collection_runs SET heartbeat_at = now(), stats = $2 WHERE id = $1',
      [run.id, JSON.stringify({ ...stats, api_calls: counter.calls })]).catch(() => {});
  }, 15_000);

  log.info('collection started', { run: run.id, connector: connector?.name, trigger: run.trigger, scope: run.scope });
  try {
    if (!connector) throw new Error('connector no longer exists');
    if (!provider) throw new Error(`unsupported provider ${connector.provider}`);
    const pat = decrypt(connector.credential_enc);
    if (!pat) throw new Error('connector has no PAT configured');

    const ids = new Map(); // "type:external_id" -> asset id (for parent links)
    const emit = async (asset, { parentKey } = {}) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await upsertAsset(client, asset, {
          connectorId: connector.id,
          runId: run.id,
          parentId: parentKey ? ids.get(parentKey) ?? null : null,
        });
        await client.query('COMMIT');
        ids.set(`${asset.type}:${asset.external_id}`, r.id);
        stats.assets++;
        if (r.created) stats.created++;
        else if (r.changed) stats.changed++;
        return r.id;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    };

    // Resolve parent keys for scoped runs (parent emitted in an earlier run).
    const existing = await many('SELECT id, type, external_id FROM assets WHERE connector_id = $1', [connector.id]);
    for (const a of existing) ids.set(`${a.type}:${a.external_id}`, a.id);

    const result = await provider.collect({ cfg: connector.config, pat, scope: run.scope, emit, counter });
    stats.enrichment_errors = result?.errors ?? 0;

    if (!run.scope) {
      // Full run: anything from this connector not seen in this run is gone.
      const { rowCount } = await query(
        `UPDATE assets SET deleted_at = now()
         WHERE connector_id = $1 AND deleted_at IS NULL AND (last_seen_run_id IS DISTINCT FROM $2)`,
        [connector.id, run.id]);
      stats.deleted = rowCount;
    }
    stats.api_calls = counter.calls;

    await query(
      `UPDATE collection_runs SET status = 'succeeded', finished_at = now(), stats = $2 WHERE id = $1`,
      [run.id, JSON.stringify(stats)]);
    await query(
      `UPDATE connectors SET last_run_at = now(), last_status = 'succeeded', last_error = NULL WHERE id = $1`,
      [connector.id]);
    log.info('collection finished', { run: run.id, connector: connector.name, ...stats });
  } catch (err) {
    stats.api_calls = counter.calls;
    log.error('collection failed', { run: run.id, err: err.message });
    await query(
      `UPDATE collection_runs SET status = 'failed', finished_at = now(), error = $2, stats = $3 WHERE id = $1`,
      [run.id, err.message.slice(0, 2000), JSON.stringify(stats)]);
    if (connector) {
      await query(`UPDATE connectors SET last_run_at = now(), last_status = 'failed', last_error = $2 WHERE id = $1`,
        [connector.id, err.message.slice(0, 2000)]);
    }
  } finally {
    clearInterval(heartbeat);
    await notify('cap_eval').catch(() => {});
  }
}

/** Queue a run unless an equivalent one is already queued. Returns the run id. */
export async function enqueueRun(connectorId, trigger, scope = null) {
  const row = await one(
    `INSERT INTO collection_runs (connector_id, trigger, scope)
     SELECT $1, $2, $3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM collection_runs WHERE connector_id = $1 AND status = 'queued'
         AND (scope IS NULL OR scope = $3::jsonb))
     RETURNING id`,
    [connectorId, trigger, scope ? JSON.stringify(scope) : null]);
  if (row) await notify('cap_collect', row.id);
  return row?.id ?? null;
}
