import { Router } from 'express';
import { many, one } from '../../common/db.js';
import { requireAuth } from '../../common/auth.js';
import { paging } from '../../common/http.js';
import { callEvaluator } from '../evaluatorClient.js';

export const router = Router();

router.get('/status', requireAuth(), async (_req, res) => {
  const counts = await one(
    `SELECT (SELECT count(*) FROM assets WHERE deleted_at IS NULL)::int AS assets,
            (SELECT count(*) FROM controls WHERE enabled)::int AS controls,
            (SELECT count(*) FROM frameworks)::int AS frameworks,
            (SELECT count(*) FROM connectors)::int AS connectors,
            (SELECT count(*) FROM eval_queue)::int AS eval_queue,
            (SELECT count(*) FROM collection_runs WHERE status IN ('queued','running'))::int AS active_runs,
            (SELECT max(evaluated_at) FROM evaluations) AS last_evaluation`);
  let evaluator;
  try { evaluator = await callEvaluator('/internal/status'); } catch (err) { evaluator = { error: err.message }; }
  res.json({ ...counts, evaluator });
});

router.get('/audit', requireAuth('admin'), async (req, res) => {
  const { limit, offset } = paging(req.query, 500);
  res.json({ items: await many('SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT $1 OFFSET $2', [limit, offset]) });
});
