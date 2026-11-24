export function fmtScore(score) {
  return score === null || score === undefined ? '—' : `${Number(score).toFixed(score >= 99.95 || score === 0 ? 0 : 1)}%`;
}

export function scoreClass(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 90) return 'good';
  if (score >= 70) return 'warn';
  return 'bad';
}

export function ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 0) return `in ${dur(-s)}`;
  return `${dur(s)} ago`;
}

function dur(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function dt(ts) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

export function duration(a, b) {
  if (!a || !b) return '—';
  return dur(Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)));
}

export const STATUS_LABEL = { pass: 'Passing', fail: 'Failing', skip: 'Skipped', error: 'Error', pending: 'Pending' };
