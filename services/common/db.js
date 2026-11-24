import pg from 'pg';
import { config } from './config.js';
import { log } from './log.js';

// Return BIGINT/COUNT as numbers (counts never exceed 2^53 here).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool(config.db);
pool.on('error', (err) => log.error('pg pool error', { err }));

export async function query(text, params) {
  return pool.query(text, params);
}

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function notify(channel, payload = '') {
  await pool.query('SELECT pg_notify($1, $2)', [channel, String(payload)]);
}

/**
 * LISTEN on channels with a dedicated connection that reconnects on failure.
 * onMessage(channel, payload) is called for each notification.
 */
export function listen(channels, onMessage) {
  let stopped = false;
  let client;
  const connect = async () => {
    if (stopped) return;
    try {
      client = new pg.Client(config.db);
      client.on('notification', (n) => onMessage(n.channel, n.payload));
      client.on('error', (err) => {
        log.warn('listen connection error; reconnecting', { err: err.message });
        client.end().catch(() => {});
        setTimeout(connect, 3000);
      });
      await client.connect();
      for (const ch of channels) await client.query(`LISTEN ${ch}`);
      log.info('listening', { channels });
    } catch (err) {
      log.warn('listen connect failed; retrying', { err: err.message });
      setTimeout(connect, 5000);
    }
  };
  connect();
  return () => { stopped = true; client?.end().catch(() => {}); };
}

/** Wait until the database answers (startup ordering in Kubernetes). */
export async function waitForDb(attempts = 60) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1 FROM assets LIMIT 1');
      return;
    } catch (err) {
      log.warn('database not ready', { attempt: i, err: err.message });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('database not reachable');
}

/** Run fn only on the replica that wins a session-less advisory lock. */
export async function withAdvisoryLock(key, fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!rows[0].ok) return false;
    try { await fn(); } finally { await client.query('SELECT pg_advisory_unlock($1)', [key]); }
    return true;
  } finally {
    client.release();
  }
}
