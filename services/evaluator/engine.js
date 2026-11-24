// Evaluation engine: keeps OPA in sync with control versions and evaluates assets.
import { many, query } from '../common/db.js';
import { log } from '../common/log.js';
import { mapLimit } from '../common/util.js';
import * as opa from './opa.js';
import { interpret } from './policy.js';

const SENTINEL = 'cap_sentinel';
// controlId -> { version, ok, errors }
const loaded = new Map();

/** Detect an OPA restart (sidecar lost its policies) and reset the cache. */
export async function checkOpa() {
  if (!(await opa.policyExists(SENTINEL))) {
    if (loaded.size) log.warn('OPA policies lost; reloading lazily');
    loaded.clear();
    const r = await opa.putRaw(SENTINEL, 'package cap.sentinel\n\nok := true\n');
    if (!r.ok) throw new Error(`cannot load sentinel policy: ${r.errors.join('; ')}`);
  }
}

async function ensurePolicy(control) {
  const cached = loaded.get(control.id);
  if (cached && cached.version === control.version) return cached;
  const r = await opa.putPolicy(control.id, control.rego);
  const entry = { version: control.version, ok: r.ok, errors: r.errors || [] };
  loaded.set(control.id, entry);
  // Record compile errors on the control so the UI can show them.
  await query('UPDATE controls SET compile_error = $2 WHERE id = $1 AND version = $3 AND compile_error IS DISTINCT FROM $2',
    [control.id, r.ok ? null : entry.errors.join('\n'), control.version]);
  if (!r.ok) log.warn('control failed to compile', { control: control.key, errors: entry.errors });
  return entry;
}

export async function evaluateOne(control, definition) {
  const policy = await ensurePolicy(control);
  if (!policy.ok) return { status: 'error', reasons: policy.errors.map((e) => `compile: ${e}`) };
  try {
    return interpret(await opa.evaluate(control.id, definition));
  } catch (err) {
    return { status: 'error', reasons: [`evaluation: ${err.message}`] };
  }
}

/** Evaluate every applicable enabled control against one asset and persist results. */
export async function evaluateAsset(assetId) {
  const assets = await many(
    'SELECT id, type, definition, content_hash, deleted_at FROM assets WHERE id = $1', [assetId]);
  const asset = assets[0];
  if (!asset || asset.deleted_at) return 0;
  const controls = await many(
    'SELECT id, key, version, rego FROM controls WHERE enabled AND $1 = ANY(asset_types)', [asset.type]);
  const input = { id: asset.id, ...asset.definition };

  const results = await mapLimit(controls, 8, async (control) => {
    const start = Date.now();
    const r = await evaluateOne(control, input);
    return { control, ...r, ms: Date.now() - start };
  });

  for (const r of results) {
    // Upsert and capture the previous status for the event log in one round trip.
    const { rows } = await query(
      `WITH prev AS (SELECT status FROM evaluations WHERE asset_id = $1 AND control_id = $2)
       INSERT INTO evaluations (asset_id, control_id, status, reasons, control_version, asset_hash, duration_ms, evaluated_at, status_since)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (asset_id, control_id) DO UPDATE SET
         status = EXCLUDED.status, reasons = EXCLUDED.reasons, control_version = EXCLUDED.control_version,
         asset_hash = EXCLUDED.asset_hash, duration_ms = EXCLUDED.duration_ms, evaluated_at = now(),
         status_since = CASE WHEN evaluations.status = EXCLUDED.status THEN evaluations.status_since ELSE now() END
       RETURNING (SELECT status FROM prev) AS prev_status`,
      [asset.id, r.control.id, r.status, JSON.stringify(r.reasons), r.control.version, asset.content_hash, r.ms],
    );
    const prev = rows[0]?.prev_status ?? null;
    if (prev !== r.status) {
      await query(
        'INSERT INTO evaluation_events (asset_id, control_id, from_status, to_status, reasons) VALUES ($1,$2,$3,$4,$5)',
        [asset.id, r.control.id, prev, r.status, JSON.stringify(r.reasons)]);
    }
  }
  return results.length;
}

/** Validate a Rego snippet without persisting it (uses a scratch policy id). */
export async function validate(rego) {
  const scratch = '00000000-0000-0000-0000-00000000beef';
  const r = await opa.putPolicy(scratch, rego);
  await opa.deletePolicy(scratch);
  return r;
}

/** Evaluate an unsaved Rego snippet against a definition (UI "Test" button). */
export async function test(rego, definition) {
  const scratch = `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
  const r = await opa.putPolicy(scratch, rego);
  if (!r.ok) return { status: 'error', reasons: r.errors.map((e) => `compile: ${e}`), raw: null };
  try {
    const raw = await opa.evaluate(scratch, definition);
    return { ...interpret(raw), raw: raw ?? null };
  } catch (err) {
    return { status: 'error', reasons: [`evaluation: ${err.message}`], raw: null };
  } finally {
    await opa.deletePolicy(scratch);
  }
}

export function forget(controlId) {
  loaded.delete(controlId);
}
