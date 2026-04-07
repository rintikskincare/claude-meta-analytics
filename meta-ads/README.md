# Meta Ads Creative Analytics

A small, production-minded web app for slicing **Meta Ads insights at the creative level** — surfacing top performers, fatiguing creatives, and side-by-side comparisons that the native Ads Manager hides behind clicks.

Stack: **Node.js + Express + SQLite (better-sqlite3) + vanilla HTML/CSS/JS**. No build step, no framework.

## Quick start

```bash
cd meta-ads
npm install
npm start
# open http://localhost:3001
```

Then click **Load Demo Data** in the top-right to populate ~30 days of synthetic data, or import your own CSV (see format below).

## Features (v1)

- **Dashboard** — Spend, Revenue, ROAS, CPA, CTR, CPM, Purchases tiles + sortable creative leaderboard, filterable by date range and tag.
- **CSV import** — Upload an Ads Manager export. Flexible header matching (case-insensitive, common aliases).
- **Creative detail** — Trend chart (spend vs ROAS), per-placement (campaign × adset) breakdown, copy/headline display, manual tagging.
- **Compare** — Side-by-side metrics for 2–4 creatives, with the best value per metric highlighted.
- **Fatigue alerts** — Flags creatives whose 7-day ROAS dropped >30% vs the prior 7 days (with a min-spend gate).
- **Tagging** — Add/remove free-form tags per creative; filter the dashboard by tag.

## CSV format

Headers are case-insensitive and tolerant of common aliases. Recognized fields:

| Field | Aliases | Required |
|---|---|---|
| `ad_id` | `adid`, `ad_id_external` | ✅ |
| `date` | `day`, `reporting_starts` | ✅ |
| `ad_name` | `creative_name` | recommended |
| `campaign` | `campaign_name` | |
| `adset` | `ad_set_name`, `adset_name` | |
| `spend` | `amount_spent` | |
| `impressions` | | |
| `clicks` | `link_clicks` | |
| `purchases` | `results` | |
| `revenue` | `purchase_value`, `conversion_value` | |
| `format` | | (default `image`) |
| `thumbnail_url` | `thumbnail` | |
| `headline` | `title` | |
| `body` | `primary_text`, `copy` | |

Creatives are deduped by SHA1 of `(name, headline, body, thumbnail_url)`. Insights are upserted by `(ad_id, date)` so re-importing the same export is idempotent.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/metrics/totals?from=&to=` | Aggregated KPIs |
| `GET` | `/api/metrics/leaderboard?from=&to=&sort=&dir=&tag=&limit=` | Per-creative rollup |
| `GET` | `/api/metrics/fatigue?min_spend=100` | Fatigue alerts |
| `GET` | `/api/creatives` | All creatives + tags |
| `GET` | `/api/creatives/:id?from=&to=` | Detail + trend + placements |
| `POST` | `/api/creatives/:id/tags` | Body: `{name}` |
| `DELETE` | `/api/creatives/:id/tags/:name` | |
| `GET` | `/api/creatives/compare/many?ids=1,2,3` | |
| `GET` | `/api/creatives/tags/all` | |
| `POST` | `/api/ads/import` | multipart `file` field |
| `POST` | `/api/ads/seed` | Demo data |
| `POST` | `/api/ads/reset` | Wipe DB |
| `GET` | `/api/ads/date-range` | min/max insight date |

## Architecture

```
meta-ads/
├── server.js              # Express bootstrap
├── db.js                  # SQLite connection + migrations
├── routes/
│   ├── ads.js             # CSV import, seed, reset
│   ├── creatives.js       # detail, compare, tags
│   └── metrics.js         # totals, leaderboard, fatigue
├── services/
│   ├── importer.js        # CSV → normalized rows (idempotent upsert)
│   ├── metrics.js         # ROAS/CPA/CTR/CPM derivations
│   └── seed.js            # Synthetic demo data generator
└── public/                # Static frontend (no build step)
    ├── index.html         # Dashboard
    ├── creative.html      # Detail page
    ├── compare.html       # Comparison page
    ├── css/styles.css
    └── js/                # api.js (fetch + formatters), dashboard.js, creative.js, compare.js
```

### Schema

- `creatives(id, hash UNIQUE, name, format, thumbnail_url, headline, body, created_at)`
- `ads(id, creative_id FK, ad_id_external UNIQUE, campaign, adset)`
- `insights(id, ad_id FK, date, spend, impressions, clicks, purchases, revenue)` — `UNIQUE(ad_id, date)`
- `tags(id, name UNIQUE)` + `creative_tags(creative_id, tag_id)` join

### Design notes

- **Why SQLite + better-sqlite3?** Synchronous API keeps the route handlers trivial; the dataset (a single account's exports) easily fits in one file. WAL mode is enabled.
- **Idempotent imports** via `ON CONFLICT ... DO UPDATE` on `(ad_id, date)` mean re-uploading an extended export just appends new days.
- **No frontend framework.** Three small JS modules (`api.js`, page-specific scripts) keep the surface area auditable. Chart.js is loaded via CDN for the one chart we need.
- **Metrics derivation lives in one place** (`services/metrics.js#deriveKpis`) so totals, leaderboard, detail, and comparison all agree on definitions.

## Out of scope (v1)

- Live Meta Graph API sync (planned: nightly poll → same `insights` table)
- Auth / multi-tenant
- Attribution modeling
- Ad creation
