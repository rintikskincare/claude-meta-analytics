const db = require('../db');

// Known settings with defaults and type coercion. Unknown keys are rejected
// on write but returned as-is on read (so manual DB tweaks still surface).
const SCHEMA = {
  meta_access_token:        { type: 'string', secret: true,  default: '' },
  gemini_api_key:           { type: 'string', secret: true,  default: '' },
  date_range_days:          { type: 'int',    secret: false, default: 30,   min: 1,   max: 365 },
  sync_frequency:           { type: 'enum',   secret: false, default: 'daily', values: ['off', 'hourly', 'daily', 'weekly'] },
  winner_roas_threshold:    { type: 'float',  secret: false, default: 2.0,  min: 0 },
  iteration_spend_threshold:{ type: 'float',  secret: false, default: 100,  min: 0 },
};

const KEYS = Object.keys(SCHEMA);
const SECRET_KEYS = KEYS.filter(k => SCHEMA[k].secret);

function isSecret(key) {
  return !!(SCHEMA[key] && SCHEMA[key].secret);
}

// Mask a secret value: show only the last 4 chars, never the full token.
function maskSecret(val) {
  if (val == null || val === '') return { set: false, preview: null };
  const s = String(val);
  const tail = s.length >= 4 ? s.slice(-4) : '';
  return { set: true, preview: `••••${tail}` };
}

function coerce(key, raw) {
  const def = SCHEMA[key];
  if (!def) throw new Error(`unknown setting: ${key}`);
  if (raw == null || raw === '') {
    if (def.type === 'string') return '';
    throw new Error(`${key} is required`);
  }
  switch (def.type) {
    case 'string': return String(raw);
    case 'int': {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) throw new Error(`${key} must be an integer`);
      if (def.min != null && n < def.min) throw new Error(`${key} must be >= ${def.min}`);
      if (def.max != null && n > def.max) throw new Error(`${key} must be <= ${def.max}`);
      return String(n);
    }
    case 'float': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
      if (def.min != null && n < def.min) throw new Error(`${key} must be >= ${def.min}`);
      if (def.max != null && n > def.max) throw new Error(`${key} must be <= ${def.max}`);
      return String(n);
    }
    case 'enum':
      if (!def.values.includes(String(raw))) {
        throw new Error(`${key} must be one of: ${def.values.join(', ')}`);
      }
      return String(raw);
    default:
      throw new Error(`bad schema for ${key}`);
  }
}

// Decode stored string back into the native type for internal consumers.
function decode(key, stored) {
  const def = SCHEMA[key];
  if (!def) return stored;
  if (stored == null) return def.default;
  switch (def.type) {
    case 'int':   return parseInt(stored, 10);
    case 'float': return Number(stored);
    default:      return stored;
  }
}

const selectOne = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsert = db.prepare(`
  INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

// Internal getter: returns the *real* value. Never return this over HTTP for
// secret keys — use getAllPublic() for API responses.
function get(key) {
  const row = selectOne.get(key);
  return decode(key, row ? row.value : null);
}

function setOne(key, value) {
  if (!(key in SCHEMA)) throw new Error(`unknown setting: ${key}`);
  const coerced = coerce(key, value);
  upsert.run({ key, value: coerced });
  return true;
}

function setMany(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('body must be an object');
  const tx = db.transaction(entries => {
    for (const [k, v] of entries) setOne(k, v);
  });
  // Only apply known keys; ignore secret keys whose value is empty string or
  // the mask preview (so the client can round-trip the redacted response
  // without clobbering stored secrets).
  const entries = Object.entries(patch).filter(([k, v]) => {
    if (!(k in SCHEMA)) return false;
    if (isSecret(k)) {
      if (v == null) return false;
      if (typeof v === 'string' && (v === '' || v.startsWith('••••'))) return false;
    }
    return true;
  });
  tx(entries);
  return entries.map(([k]) => k);
}

// Public view for API responses: secrets are replaced with a mask object.
function getAllPublic() {
  const out = {};
  for (const key of KEYS) {
    const row = selectOne.get(key);
    const stored = row ? row.value : null;
    if (isSecret(key)) {
      out[key] = maskSecret(stored);
    } else {
      out[key] = decode(key, stored ?? String(SCHEMA[key].default));
    }
  }
  return out;
}

// Convenience for internal modules that need the real secret (e.g. when
// calling the Meta Graph API). Keep this off the HTTP surface.
function getSecret(key) {
  if (!isSecret(key)) throw new Error(`${key} is not a secret`);
  return get(key) || '';
}

module.exports = {
  SCHEMA, KEYS, SECRET_KEYS,
  get, getSecret, setOne, setMany, getAllPublic, isSecret, maskSecret,
};
