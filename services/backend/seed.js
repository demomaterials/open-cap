// Bootstrap: admin user and the built-in control catalog. Idempotent; never
// overwrites rows that already exist, so edits made in the UI survive restarts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, tx, withAdvisoryLock } from '../common/db.js';
import { hashPassword } from '../common/crypto.js';
import { log } from '../common/log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalogDir = path.join(here, '..', 'catalog');
const SEED_LOCK = 724_003;

export async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  const existing = await one('SELECT count(*)::int AS n FROM users');
  if (existing.n > 0) return;
  if (!password) {
    log.warn('no users exist and ADMIN_PASSWORD is not set; nobody can log in');
    return;
  }
  await one(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, 'Administrator', $2, 'admin')
     ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hashPassword(password)]);
  log.info('bootstrap admin created', { username });
}

export async function seedCatalog() {
  if (process.env.CAP_SEED_CATALOG === 'false') return;
  const catalog = JSON.parse(fs.readFileSync(path.join(catalogDir, 'catalog.json'), 'utf8'));
  await withAdvisoryLock(SEED_LOCK, () => tx(async (c) => {
    for (const t of catalog.assetTypes) {
      await c.query(
        `INSERT INTO asset_types (type, display_name, description, provider) VALUES ($1,$2,$3,$4)
         ON CONFLICT (type) DO NOTHING`, [t.type, t.display_name, t.description, t.provider]);
    }
    const controlIds = {};
    let createdControls = 0;
    for (const ctl of catalog.controls) {
      const rego = fs.readFileSync(path.join(catalogDir, 'rego', `${ctl.key}.rego`), 'utf8');
      const ins = await c.query(
        `INSERT INTO controls (key, name, description, severity, asset_types, rego, remediation, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'catalog') ON CONFLICT (key) DO NOTHING RETURNING id`,
        [ctl.key, ctl.name, ctl.description, ctl.severity, ctl.asset_types, rego, ctl.remediation]);
      if (ins.rows[0]) createdControls++;
      const { rows } = await c.query('SELECT id FROM controls WHERE key = $1', [ctl.key]);
      controlIds[ctl.key] = rows[0].id;
    }
    let createdFrameworks = 0;
    for (const fw of catalog.frameworks) {
      const ins = await c.query(
        `INSERT INTO frameworks (key, name, description, version) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO NOTHING RETURNING id`, [fw.key, fw.name, fw.description, fw.version]);
      if (!ins.rows[0]) continue; // existing framework: leave its membership alone
      createdFrameworks++;
      for (const [key, ref] of fw.controls) {
        await c.query(
          `INSERT INTO framework_controls (framework_id, control_id, reference) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`, [ins.rows[0].id, controlIds[key], ref]);
      }
    }
    if (createdControls || createdFrameworks) log.info('catalog seeded', { createdControls, createdFrameworks });
  }));
}
