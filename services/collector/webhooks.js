// Webhook receivers. Each connector has its own URL and secret:
//   POST /webhooks/github/:connectorId   (X-Hub-Signature-256 HMAC)
//   POST /webhooks/ado/:connectorId      (Basic auth password or X-CAP-Webhook-Secret header)
import crypto from 'node:crypto';
import { one, query, notify } from '../common/db.js';
import { decrypt, safeEqual } from '../common/crypto.js';
import { HttpError, UUID_RE } from '../common/http.js';
import { log } from '../common/log.js';
import { enqueueRun } from './runner.js';

async function loadConnector(id, provider) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'unknown connector');
  const c = await one('SELECT id, name, provider, enabled, webhook_secret_enc FROM connectors WHERE id = $1', [id]);
  if (!c || c.provider !== provider) throw new HttpError(404, 'unknown connector');
  const secret = decrypt(c.webhook_secret_enc);
  if (!secret) throw new HttpError(403, 'webhooks are not configured for this connector');
  return { ...c, secret };
}

async function markDeleted(type, externalId) {
  const { rowCount } = await query(
    'UPDATE assets SET deleted_at = now() WHERE type = $1 AND external_id = $2 AND deleted_at IS NULL', [type, externalId]);
  if (rowCount) await notify('cap_eval');
}

const GITHUB_ORG_EVENTS = new Set(['organization', 'member', 'membership', 'team', 'org_block']);

export function register(app) {
  app.post('/webhooks/github/:connectorId', async (req, res) => {
    const c = await loadConnector(req.params.connectorId, 'github');
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const expected = `sha256=${crypto.createHmac('sha256', c.secret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
    if (!safeEqual(sig, expected)) throw new HttpError(401, 'invalid signature');

    const event = req.headers['x-github-event'];
    const body = req.body || {};
    if (event === 'ping') return res.json({ ok: true, pong: true });
    if (!c.enabled) return res.status(202).json({ ok: true, ignored: 'connector disabled' });

    let scope = null;
    if (body.repository && !GITHUB_ORG_EVENTS.has(event)) {
      if (event === 'repository' && body.action === 'deleted') {
        await markDeleted('github_repo', `github:repo:${body.repository.id}`);
        return res.json({ ok: true, action: 'asset deleted' });
      }
      scope = { repo: body.repository.name };
    } else if (body.organization) {
      scope = { org: true };
    }
    const runId = await enqueueRun(c.id, 'webhook', scope);
    log.info('github webhook', { connector: c.name, event, action: body.action, scope, runId });
    res.status(202).json({ ok: true, queued: runId, scope });
  });

  app.post('/webhooks/ado/:connectorId', async (req, res) => {
    const c = await loadConnector(req.params.connectorId, 'ado');
    let provided = req.headers['x-cap-webhook-secret'];
    const auth = req.headers.authorization || '';
    if (!provided && auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      provided = decoded.slice(decoded.indexOf(':') + 1);
    }
    if (!provided || !safeEqual(provided, c.secret)) throw new HttpError(401, 'invalid webhook secret');
    if (!c.enabled) return res.status(202).json({ ok: true, ignored: 'connector disabled' });

    const body = req.body || {};
    const resource = body.resource || {};
    const repo = resource.repository || (body.eventType?.startsWith('git.repo') ? resource : null);
    let scope = null;
    if (body.eventType === 'git.repo.deleted' && repo?.id) {
      await markDeleted('ado_repo', `ado:repo:${repo.id}`);
      return res.json({ ok: true, action: 'asset deleted' });
    }
    if (repo?.id) scope = { project: repo.project?.id || body.resourceContainers?.project?.id, repo: repo.id };
    else if (body.resourceContainers?.project?.id) scope = { project: body.resourceContainers.project.id };
    const runId = await enqueueRun(c.id, 'webhook', scope);
    log.info('ado webhook', { connector: c.name, eventType: body.eventType, scope, runId });
    res.status(202).json({ ok: true, queued: runId, scope });
  });
}
