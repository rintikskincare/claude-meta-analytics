const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const db = require('../db');

// Expected CSV columns (case-insensitive, flexible):
//   ad_id, ad_name, campaign, adset, date, spend, impressions, clicks,
//   purchases, revenue, format, thumbnail_url, headline, body
// Missing optional fields are tolerated.

function norm(h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, '_'); }

function pick(row, ...keys) {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k];
  return null;
}

function toNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[, $]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function creativeHash({ name, headline, body, thumbnail_url }) {
  return crypto.createHash('sha1')
    .update([name, headline, body, thumbnail_url].map(x => x || '').join('|'))
    .digest('hex');
}

const upsertCreative = db.prepare(`
  INSERT INTO creatives (hash, name, format, thumbnail_url, headline, body)
  VALUES (@hash, @name, @format, @thumbnail_url, @headline, @body)
  ON CONFLICT(hash) DO UPDATE SET name = excluded.name
  RETURNING id
`);

const upsertAd = db.prepare(`
  INSERT INTO ads (creative_id, ad_id_external, campaign, adset)
  VALUES (@creative_id, @ad_id_external, @campaign, @adset)
  ON CONFLICT(ad_id_external) DO UPDATE SET
    creative_id = excluded.creative_id,
    campaign = excluded.campaign,
    adset = excluded.adset
  RETURNING id
`);

const upsertInsight = db.prepare(`
  INSERT INTO insights (ad_id, date, spend, impressions, clicks, purchases, revenue)
  VALUES (@ad_id, @date, @spend, @impressions, @clicks, @purchases, @revenue)
  ON CONFLICT(ad_id, date) DO UPDATE SET
    spend = excluded.spend, impressions = excluded.impressions,
    clicks = excluded.clicks, purchases = excluded.purchases, revenue = excluded.revenue
`);

function importRows(rawRows) {
  const rows = rawRows.map(r => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[norm(k)] = v;
    return o;
  });

  const tx = db.transaction(() => {
    let count = 0;
    for (const r of rows) {
      const ad_id_external = pick(r, 'ad_id', 'adid', 'ad_id_external');
      const date = pick(r, 'date', 'day', 'reporting_starts');
      if (!ad_id_external || !date) continue;

      const creativePayload = {
        name: pick(r, 'ad_name', 'creative_name') || `ad-${ad_id_external}`,
        format: pick(r, 'format') || 'image',
        thumbnail_url: pick(r, 'thumbnail_url', 'thumbnail'),
        headline: pick(r, 'headline', 'title'),
        body: pick(r, 'body', 'primary_text', 'copy'),
      };
      const hash = creativeHash(creativePayload);
      const { id: creative_id } = upsertCreative.get({ hash, ...creativePayload });

      const { id: ad_id } = upsertAd.get({
        creative_id,
        ad_id_external: String(ad_id_external),
        campaign: pick(r, 'campaign', 'campaign_name'),
        adset: pick(r, 'adset', 'ad_set_name', 'adset_name'),
      });

      upsertInsight.run({
        ad_id,
        date: String(date).slice(0, 10),
        spend: toNum(pick(r, 'spend', 'amount_spent')),
        impressions: toNum(pick(r, 'impressions')),
        clicks: toNum(pick(r, 'clicks', 'link_clicks')),
        purchases: toNum(pick(r, 'purchases', 'results')),
        revenue: toNum(pick(r, 'revenue', 'purchase_value', 'conversion_value')),
      });
      count++;
    }
    return count;
  });

  return tx();
}

function importCsv(buffer) {
  const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  return importRows(records);
}

module.exports = { importCsv, importRows };
