// Minimal structured JSON logger (one line per event, stdout).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;
const service = process.env.CAP_SERVICE || 'cap';

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, service, msg };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      line[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
    }
  }
  process.stdout.write(JSON.stringify(line) + '\n');
}

export const log = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};
