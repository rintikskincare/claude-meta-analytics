const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema bootstrap. Idempotent: safe to run on every boot.
// Every row-bearing table carries created_at / updated_at (ISO8601 UTC), and
// updated_at is maintained by AFTER UPDATE triggers.
// ---------------------------------------------------------------------------
db.exec(`
-- Key/value application settings (e.g. default currency, timezone, API keys).
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Connected Meta (or other) ad accounts.
CREATE TABLE IF NOT EXISTS ad_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id  TEXT NOT NULL UNIQUE,             -- e.g. act_1234567890
  name         TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'meta',
  currency     TEXT NOT NULL DEFAULT 'USD',
  timezone     TEXT,
  access_token TEXT,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | paused | error
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform ON ad_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_status   ON ad_accounts(status);

-- Creatives (deduped by content hash). ad_account_id is nullable so CSV
-- imports without an account context still work.
CREATE TABLE IF NOT EXISTS creatives (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE SET NULL,
  hash          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  format        TEXT NOT NULL DEFAULT 'image',   -- image | video | carousel
  thumbnail_url TEXT,
  headline      TEXT,
  body          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_creatives_account ON creatives(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_creatives_format  ON creatives(format);
CREATE INDEX IF NOT EXISTS idx_creatives_name    ON creatives(name);

-- Saved/generated reports (async-friendly: queued -> running -> done/error).
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,                   -- leaderboard | fatigue | compare | custom
  params        TEXT NOT NULL DEFAULT '{}',      -- JSON blob (date range, filters, sort…)
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  result        TEXT,                            -- JSON blob or NULL
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_account ON reports(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_type    ON reports(type);

-- Existing operational tables (kept for importer/metrics services).
CREATE TABLE IF NOT EXISTS ads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id     INTEGER NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  ad_id_external  TEXT NOT NULL UNIQUE,
  campaign        TEXT,
  adset           TEXT
);
CREATE INDEX IF NOT EXISTS idx_ads_creative ON ads(creative_id);

CREATE TABLE IF NOT EXISTS insights (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id        INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  spend        REAL    NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  purchases    INTEGER NOT NULL DEFAULT 0,
  revenue      REAL    NOT NULL DEFAULT 0,
  UNIQUE(ad_id, date)
);
CREATE INDEX IF NOT EXISTS idx_insights_date ON insights(date);
CREATE INDEX IF NOT EXISTS idx_insights_ad   ON insights(ad_id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS creative_tags (
  creative_id INTEGER NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (creative_id, tag_id)
);

-- updated_at triggers ------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
  AFTER UPDATE ON settings FOR EACH ROW
  BEGIN UPDATE settings SET updated_at = datetime('now') WHERE key = OLD.key; END;

CREATE TRIGGER IF NOT EXISTS trg_ad_accounts_updated_at
  AFTER UPDATE ON ad_accounts FOR EACH ROW
  BEGIN UPDATE ad_accounts SET updated_at = datetime('now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_creatives_updated_at
  AFTER UPDATE ON creatives FOR EACH ROW
  BEGIN UPDATE creatives SET updated_at = datetime('now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_reports_updated_at
  AFTER UPDATE ON reports FOR EACH ROW
  BEGIN UPDATE reports SET updated_at = datetime('now') WHERE id = OLD.id; END;
`);

// ---------------------------------------------------------------------------
// Lightweight migration: add columns that older DBs may be missing. SQLite
// can't do "ADD COLUMN IF NOT EXISTS", so we check PRAGMA first.
// ---------------------------------------------------------------------------
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
if (!columnExists('creatives', 'updated_at')) {
  db.exec(`ALTER TABLE creatives ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`);
}
if (!columnExists('creatives', 'ad_account_id')) {
  db.exec(`ALTER TABLE creatives ADD COLUMN ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE SET NULL`);
}
for (const [col, ddl] of [
  ['last_synced_at',   `ALTER TABLE ad_accounts ADD COLUMN last_synced_at TEXT`],
  ['last_sync_status', `ALTER TABLE ad_accounts ADD COLUMN last_sync_status TEXT`],
  ['last_sync_error',  `ALTER TABLE ad_accounts ADD COLUMN last_sync_error TEXT`],
  ['last_sync_window', `ALTER TABLE ad_accounts ADD COLUMN last_sync_window INTEGER`],
]) {
  if (!columnExists('ad_accounts', col)) db.exec(ddl);
}

// Meta-ingestion extensions: track ad status, campaign/adset IDs, and
// a stable external creative id so Graph-sourced rows can upsert without
// content-hashing. Video metrics live on the insights row.
const ADD_IF_MISSING = {
  creatives: [
    ['external_creative_id', `ALTER TABLE creatives ADD COLUMN external_creative_id TEXT`],
  ],
  ads: [
    ['ad_account_id',   `ALTER TABLE ads ADD COLUMN ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE SET NULL`],
    ['status',          `ALTER TABLE ads ADD COLUMN status TEXT`],
    ['effective_status',`ALTER TABLE ads ADD COLUMN effective_status TEXT`],
    ['campaign_id',     `ALTER TABLE ads ADD COLUMN campaign_id TEXT`],
    ['adset_id',        `ALTER TABLE ads ADD COLUMN adset_id TEXT`],
    ['updated_at',      `ALTER TABLE ads ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`],
  ],
  insights: [
    ['reach',                  `ALTER TABLE insights ADD COLUMN reach INTEGER NOT NULL DEFAULT 0`],
    ['frequency',              `ALTER TABLE insights ADD COLUMN frequency REAL NOT NULL DEFAULT 0`],
    ['video_plays',            `ALTER TABLE insights ADD COLUMN video_plays INTEGER NOT NULL DEFAULT 0`],
    ['video_p25',              `ALTER TABLE insights ADD COLUMN video_p25 INTEGER NOT NULL DEFAULT 0`],
    ['video_p50',              `ALTER TABLE insights ADD COLUMN video_p50 INTEGER NOT NULL DEFAULT 0`],
    ['video_p75',              `ALTER TABLE insights ADD COLUMN video_p75 INTEGER NOT NULL DEFAULT 0`],
    ['video_p100',             `ALTER TABLE insights ADD COLUMN video_p100 INTEGER NOT NULL DEFAULT 0`],
    ['video_avg_time_watched', `ALTER TABLE insights ADD COLUMN video_avg_time_watched REAL NOT NULL DEFAULT 0`],
    ['thruplays',              `ALTER TABLE insights ADD COLUMN thruplays INTEGER NOT NULL DEFAULT 0`],
  ],
};
for (const [table, cols] of Object.entries(ADD_IF_MISSING)) {
  for (const [col, ddl] of cols) {
    if (!columnExists(table, col)) db.exec(ddl);
  }
}

// Unique index on external_creative_id (partial so NULLs from CSV imports
// don't collide).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_creatives_ext
    ON creatives(external_creative_id) WHERE external_creative_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ads_account  ON ads(ad_account_id);
  CREATE INDEX IF NOT EXISTS idx_ads_campaign ON ads(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_ads_status   ON ads(status);

  CREATE TRIGGER IF NOT EXISTS trg_ads_updated_at
    AFTER UPDATE ON ads FOR EACH ROW
    BEGIN UPDATE ads SET updated_at = datetime('now') WHERE id = OLD.id; END;
`);

// Seed default settings on first boot.
const seedSetting = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
);
seedSetting.run('schema_version', '1');
seedSetting.run('default_currency', 'USD');
seedSetting.run('fatigue_drop_threshold', '0.30');

module.exports = db;
