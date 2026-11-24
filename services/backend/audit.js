import { query } from '../common/db.js';
import { log } from '../common/log.js';

export async function audit(req, action, entityType, entityId, detail) {
  try {
    await query(
      'INSERT INTO audit_log (actor, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)',
      [req.user?.username ?? null, action, entityType, entityId ? String(entityId) : null, detail ? JSON.stringify(detail) : null]);
  } catch (err) {
    log.warn('audit write failed', { err: err.message });
  }
}
