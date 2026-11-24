export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run async fn over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function instanceId() {
  return process.env.HOSTNAME || `local-${process.pid}`;
}
