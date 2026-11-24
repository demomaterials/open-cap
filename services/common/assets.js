// Asset persistence shared by the collector and the backend's ingest API.
import { contentHash } from './crypto.js';

/**
 * Build the asset definition document that controls evaluate.
 *   { id?, type, external_id, name, owner, members, parent, source, data, related, errors }
 * `collected_at` is set by the caller and excluded from the hash so unchanged
 * assets don't create history rows on every run.
 */
export function buildDefinition(a) {
  return {
    type: a.type,
    external_id: String(a.external_id),
    name: a.name,
    owner: a.owner ?? null,
    members: a.members ?? [],
    parent: a.parent ?? null,
    source: a.source ?? null,
    data: a.data ?? {},
    related: a.related ?? {},
    errors: a.errors ?? {},
  };
}

/**
 * Insert or update one asset. Returns { id, changed, created }.
 * On change: writes asset_history and queues the asset for evaluation.
 */
export async function upsertAsset(client, asset, { connectorId = null, runId = null, parentId = null } = {}) {
  const definition = buildDefinition(asset);
  const hash = contentHash(definition);
  const { rows } = await client.query(
    `INSERT INTO assets (type, external_id, name, connector_id, parent_id, owner, members, definition, content_hash, last_seen_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (type, external_id) DO UPDATE SET
       name = EXCLUDED.name,
       connector_id = COALESCE(EXCLUDED.connector_id, assets.connector_id),
       parent_id = COALESCE(EXCLUDED.parent_id, assets.parent_id),
       owner = EXCLUDED.owner,
       members = EXCLUDED.members,
       definition = EXCLUDED.definition,
       last_changed_at = CASE WHEN assets.content_hash <> EXCLUDED.content_hash OR assets.deleted_at IS NOT NULL
                              THEN now() ELSE assets.last_changed_at END,
       content_hash = EXCLUDED.content_hash,
       last_seen_run_id = EXCLUDED.last_seen_run_id,
       last_collected_at = now(),
       deleted_at = NULL
     RETURNING id, (xmax = 0) AS created,
       (SELECT content_hash FROM assets old WHERE old.type = $1 AND old.external_id = $2) AS old_hash`,
    [definition.type, definition.external_id, definition.name, connectorId, parentId, definition.owner,
      JSON.stringify(definition.members), JSON.stringify(definition), hash, runId],
  );
  const row = rows[0];
  // old_hash is read from the pre-statement snapshot, so it is the previous value.
  const changed = row.created || row.old_hash !== hash;
  if (changed) {
    await client.query('INSERT INTO asset_history (asset_id, content_hash, definition) VALUES ($1,$2,$3)',
      [row.id, hash, JSON.stringify(definition)]);
  }
  if (changed || row.created) {
    await client.query(
      `INSERT INTO eval_queue (asset_id, reason) VALUES ($1, $2)
       ON CONFLICT (asset_id) DO NOTHING`, [row.id, row.created ? 'asset_created' : 'asset_changed']);
  }
  return { id: row.id, changed, created: row.created };
}

export async function ensureAssetType(client, type, displayName, provider) {
  await client.query(
    `INSERT INTO asset_types (type, display_name, provider) VALUES ($1,$2,$3) ON CONFLICT (type) DO NOTHING`,
    [type, displayName || type, provider || 'manual'],
  );
}
