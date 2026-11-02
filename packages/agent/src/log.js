// Structured logs: one JSON line per event, e.g.
//   log.error('conversations.get_failed', { error })
//   → {"level":"error","event":"conversations.get_failed","code":"42P01","name":"error"}
//
// Only a short allowlist of fields is written, and only as numbers, booleans or short
// identifier-like strings. Message content, prompts, file names, emails and user IDs never
// fit that shape or that list, so they can't end up in the logs by accident. Pass an
// `error` field to log its code, name and HTTP status (never its message or stack).

const FIELDS = new Set([
  'code', 'name', 'status', 'reason', 'kind', 'tool', 'model',
  'count', 'deleted', 'removed', 'pages', 'version', 'from', 'to',
  'traceId', 'ms',
]);
const SAFE_STRING = /^[\w.:\/-]{1,80}$/;
const EVENT = /^[a-z0-9][\w.-]{0,79}$/i;
const PG_CODE = /^[0-9A-Z]{5}$/;

function clean(fields = {}) {
  const out = {};
  const { error, ...rest } = fields;
  if (error !== undefined) Object.assign(out, errorFields(error));
  for (const [key, value] of Object.entries(rest)) {
    if (!FIELDS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && SAFE_STRING.test(value)) out[key] = value;
  }
  return out;
}

// What an error can say about itself without its message: a code (Postgres, Node or
// Clerk style), its class name and an HTTP status.
export function errorFields(error) {
  const out = {};
  const code = error?.code;
  if (typeof code === 'string' && (PG_CODE.test(code) || /^[A-Z][A-Z0-9_]{1,40}$/.test(code))) out.code = code;
  const ctor = error !== null && typeof error === 'object' ? error.constructor?.name : undefined;
  const name = ctor && ctor !== 'Object' ? ctor : error?.name;
  if (typeof name === 'string' && /^\w{1,40}$/.test(name)) out.name = name;
  if (Number.isInteger(error?.status)) out.status = error.status;
  if (!Object.keys(out).length) out.name = typeof error;
  return out;
}

function write(level, event, fields) {
  const line = JSON.stringify({ level, event: EVENT.test(event) ? event : 'invalid-event', ...clean(fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event, fields) => write('error', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  info: (event, fields) => write('info', event, fields),
};
