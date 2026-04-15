// Meta-shape ingestion pipeline.
//
// Two Graph API shapes land here:
//   1. "ads" — ad metadata from /{account}/ads (status, campaign/adset IDs,
//      and the creative object with thumbnail/copy/title).
//   2. "insights" — daily time-incremented metrics from /{account}/insights
//      (spend, impressions, clicks, purchase conversions/values, video
//      engagement breakdowns).
//
// The pipeline:
//   - Upserts creatives keyed by the Meta creative object id (stable across
//     ads that share the same asset). Falls back to ad_id when a creative
//     id is absent.
//   - Upserts ads keyed by the external ad id, recording status, effective
//     status, campaign_id, adset_id, and linking to the creative row.
//   - Upserts insights keyed by (ad_id, date), storing the full metric set
//     including video breakdowns.

const db = require('../db');

// --- helpers --------------------------------------------------------------

const toNum = v => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toInt = v => Math.round(toNum(v));

// Pick a numeric value out of Meta's "actions" array by action type.
function actionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find(a => a.action_type === type);
  return hit ? toNum(hit.value) : 0;
}

// Meta reports video quartile views as arrays too
// (e.g. video_p25_watched_actions -> [{action_type:'video_view', value:'123'}])
function videoMetric(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  // Prefer the video_view action type; fall back to the first entry.
  const hit = arr.find(a => a.action_type === 'video_view') || arr[0];
  return toInt(hit.value);
}

// Normalize a Graph insights row into the flat insight shape we store.
function normalizeInsight(row) {
  const actions = row.actions || [];
  const values  = row.action_values || [];

  // "Purchases" uses `offsite_conversion.fb_pixel_purchase` on Pixel setups,
  // or `purchase` on CAPI. Sum any type that ends with 'purchase'.
  const purchases = actions
    .filter(a => /purchase$/.test(a.action_type))
    .reduce((s, a) => s + toNum(a.value), 0);
  const revenue = values
    .filter(a => /purchase$/.test(a.action_type))
    .reduce((s, a) => s + toNum(a.value), 0);

  // Link clicks preferred; fall back to top-level clicks.
  const linkClicks = actionValue(actions, 'link_click');
  const clicks = linkClicks || toInt(row.clicks);

  const impressions = toInt(row.impressions);
  const spend = toNum(row.spend);

  return {
    ad_id_external: row.ad_id,
    date:           String(row.date_start || row.date || '').slice(0, 10),
    spend,
    impressions,
    clicks,
    purchases: toInt(purchases),
    revenue,
    reach:     toInt(row.reach),
    frequency: toNum(row.frequency),
    // Video engagement
    video_plays:  videoMetric(row.video_play_actions),
    video_p25:    videoMetric(row.video_p25_watched_actions),
    video_p50:    videoMetric(row.video_p50_watched_actions),
    video_p75:    videoMetric(row.video_p75_watched_actions),
    video_p100:   videoMetric(row.video_p100_watched_actions),
    video_avg_time_watched: toNum(
      Array.isArray(row.video_avg_time_watched_actions) && row.video_avg_time_watched_actions[0]
        ? row.video_avg_time_watched_actions[0].value : 0
    ),
    thruplays: videoMetric(row.video_thruplay_watched_actions) || actionValue(actions, 'video_thruplay_watched_actions'),
    // Derived
    ctr:  impressions > 0 ? clicks / impressions : 0,
    cpa:  purchases   > 0 ? spend / purchases    : 0,
    cpm:  impressions > 0 ? (spend * 1000) / impressions : 0,
    roas: spend       > 0 ? revenue / spend      : 0,
  };
}

// --- upsert helpers -------------------------------------------------------

// Creatives: prefer keying by external_creative_id, otherwise by hash of the
// ad_id (so sequential re-imports of the same ad don't create duplicates).
const selectCreativeByExt = db.prepare(
  'SELECT id FROM creatives WHERE external_creative_id = ?'
);
const selectCreativeByHash = db.prepare(
  'SELECT id FROM creatives WHERE hash = ?'
);
const insertCreative = db.prepare(`
  INSERT INTO creatives (hash, external_creative_id, ad_account_id,
                         name, format, thumbnail_url, headline, body)
  VALUES (@hash, @external_creative_id, @ad_account_id,
          @name, @format, @thumbnail_url, @headline, @body)
`);
const updateCreative = db.prepare(`
  UPDATE creatives SET
    ad_account_id = COALESCE(@ad_account_id, ad_account_id),
    name          = COALESCE(@name, name),
    format        = COALESCE(@format, format),
    thumbnail_url = COALESCE(@thumbnail_url, thumbnail_url),
    headline      = COALESCE(@headline, headline),
    body          = COALESCE(@body, body)
  WHERE id = @id
`);

const selectAdByExt = db.prepare('SELECT id, creative_id FROM ads WHERE ad_id_external = ?');
const insertAd = db.prepare(`
  INSERT INTO ads (creative_id, ad_id_external, ad_account_id,
                   campaign, adset, campaign_id, adset_id, status, effective_status)
  VALUES (@creative_id, @ad_id_external, @ad_account_id,
          @campaign, @adset, @campaign_id, @adset_id, @status, @effective_status)
`);
const updateAd = db.prepare(`
  UPDATE ads SET
    creative_id      = @creative_id,
    ad_account_id    = COALESCE(@ad_account_id, ad_account_id),
    campaign         = COALESCE(@campaign, campaign),
    adset            = COALESCE(@adset, adset),
    campaign_id      = COALESCE(@campaign_id, campaign_id),
    adset_id         = COALESCE(@adset_id, adset_id),
    status           = COALESCE(@status, status),
    effective_status = COALESCE(@effective_status, effective_status)
  WHERE id = @id
`);

const upsertInsight = db.prepare(`
  INSERT INTO insights (ad_id, date, spend, impressions, clicks, purchases, revenue,
                        reach, frequency, video_plays, video_p25, video_p50, video_p75,
                        video_p100, video_avg_time_watched, thruplays)
  VALUES (@ad_id, @date, @spend, @impressions, @clicks, @purchases, @revenue,
          @reach, @frequency, @video_plays, @video_p25, @video_p50, @video_p75,
          @video_p100, @video_avg_time_watched, @thruplays)
  ON CONFLICT(ad_id, date) DO UPDATE SET
    spend       = excluded.spend,
    impressions = excluded.impressions,
    clicks      = excluded.clicks,
    purchases   = excluded.purchases,
    revenue     = excluded.revenue,
    reach       = excluded.reach,
    frequency   = excluded.frequency,
    video_plays = excluded.video_plays,
    video_p25   = excluded.video_p25,
    video_p50   = excluded.video_p50,
    video_p75   = excluded.video_p75,
    video_p100  = excluded.video_p100,
    video_avg_time_watched = excluded.video_avg_time_watched,
    thruplays   = excluded.thruplays
`);

// Classify format from the Meta creative object.
function detectFormat(creative) {
  if (!creative) return 'image';
  if (creative.video_id || creative.asset_feed_spec?.videos?.length) return 'video';
  if (creative.object_story_spec?.video_data) return 'video';
  if (creative.asset_feed_spec?.link_urls?.length > 1) return 'carousel';
  if (creative.object_story_spec?.link_data?.child_attachments?.length) return 'carousel';
  return 'image';
}

// Pull a reasonable thumbnail/headline/body out of the nested creative obj.
function creativeFields(adRow) {
  const c = adRow.creative || {};
  const story = c.object_story_spec || {};
  const link = story.link_data || {};
  const video = story.video_data || {};
  return {
    external_creative_id: c.id || null,
    thumbnail_url: c.thumbnail_url || link.picture || video.image_url || null,
    headline:      c.title || link.name || video.title || null,
    body:          c.body  || link.message || video.message || null,
    format:        detectFormat(c),
  };
}

function upsertCreativeFromAd(adRow, accountId) {
  const cf = creativeFields(adRow);
  const hashKey = cf.external_creative_id || `ad:${adRow.id}`;

  const existing = cf.external_creative_id
    ? selectCreativeByExt.get(cf.external_creative_id)
    : selectCreativeByHash.get(hashKey);

  const payload = {
    hash: hashKey,
    external_creative_id: cf.external_creative_id,
    ad_account_id: accountId || null,
    name: adRow.name || `ad-${adRow.id}`,
    format: cf.format,
    thumbnail_url: cf.thumbnail_url,
    headline: cf.headline,
    body: cf.body,
  };

  if (existing) {
    updateCreative.run({ id: existing.id, ...payload });
    return existing.id;
  }
  const info = insertCreative.run(payload);
  return Number(info.lastInsertRowid);
}

function upsertAdRow(adRow, creativeId, accountId) {
  const payload = {
    creative_id:      creativeId,
    ad_id_external:   String(adRow.id),
    ad_account_id:    accountId || null,
    campaign:         adRow.campaign_name || null,
    adset:            adRow.adset_name || null,
    campaign_id:      adRow.campaign_id || null,
    adset_id:         adRow.adset_id || null,
    status:           adRow.status || null,
    effective_status: adRow.effective_status || null,
  };
  const existing = selectAdByExt.get(payload.ad_id_external);
  if (existing) {
    updateAd.run({ id: existing.id, ...payload });
    return existing.id;
  }
  const info = insertAd.run(payload);
  return Number(info.lastInsertRowid);
}

// --- public API -----------------------------------------------------------

/**
 * Ingest a batch of Meta Graph rows into the local DB.
 *
 * @param {object} params
 * @param {number} params.accountId     local ad_accounts.id
 * @param {Array}  params.ads           rows from /{account}/ads
 * @param {Array}  params.insights      rows from /{account}/insights
 * @returns {{creatives:number, ads:number, insights:number, skipped:number}}
 */
function ingest({ accountId, ads = [], insights = [] }) {
  const stats = { creatives: 0, ads: 0, insights: 0, skipped: 0 };
  const adIdToLocal = new Map();

  const tx = db.transaction(() => {
    for (const ad of ads) {
      if (!ad || !ad.id) { stats.skipped++; continue; }
      const cid = upsertCreativeFromAd(ad, accountId);
      const lid = upsertAdRow(ad, cid, accountId);
      adIdToLocal.set(String(ad.id), lid);
      stats.creatives++;
      stats.ads++;
    }

    for (const raw of insights) {
      const row = normalizeInsight(raw);
      if (!row.ad_id_external || !row.date) { stats.skipped++; continue; }

      // If the ad metadata wasn't included in this batch, upsert a stub ad
      // so the insight can still land (keeps ingestion resilient).
      let localAdId = adIdToLocal.get(row.ad_id_external);
      if (!localAdId) {
        const stub = { id: row.ad_id_external, name: `ad-${row.ad_id_external}` };
        const cid = upsertCreativeFromAd(stub, accountId);
        localAdId = upsertAdRow(stub, cid, accountId);
        adIdToLocal.set(row.ad_id_external, localAdId);
      }

      upsertInsight.run({
        ad_id: localAdId,
        date:  row.date,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        purchases: row.purchases,
        revenue: row.revenue,
        reach: row.reach,
        frequency: row.frequency,
        video_plays: row.video_plays,
        video_p25: row.video_p25,
        video_p50: row.video_p50,
        video_p75: row.video_p75,
        video_p100: row.video_p100,
        video_avg_time_watched: row.video_avg_time_watched,
        thruplays: row.thruplays,
      });
      stats.insights++;
    }
  });
  tx();
  return stats;
}

module.exports = { ingest, normalizeInsight, _internal: { creativeFields, detectFormat } };
