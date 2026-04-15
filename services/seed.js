const db = require('../db');
const { importRows } = require('./importer');

const CREATIVES = [
  { name: 'UGC Testimonial v1', format: 'video',    headline: 'Real customers, real results', body: '"It changed my routine in a week." — Maya', thumb: 'https://picsum.photos/seed/c1/300/300' },
  { name: 'Static Discount 20', format: 'image',    headline: '20% off this week only',        body: 'Use code SPRING20 at checkout.',              thumb: 'https://picsum.photos/seed/c2/300/300' },
  { name: 'Founder Story',      format: 'video',    headline: 'Why I built this',              body: 'A note from our founder.',                   thumb: 'https://picsum.photos/seed/c3/300/300' },
  { name: 'Carousel Bestsellers', format: 'carousel', headline: 'Loved by 50k+ customers',     body: 'Shop the top picks.',                        thumb: 'https://picsum.photos/seed/c4/300/300' },
  { name: 'Before/After Static', format: 'image',   headline: 'See the difference',           body: '30 days, no filters.',                        thumb: 'https://picsum.photos/seed/c5/300/300' },
  { name: 'Press Quote',         format: 'image',   headline: '"A standout." — Vogue',         body: 'Featured in Vogue, Allure, and more.',       thumb: 'https://picsum.photos/seed/c6/300/300' },
];

const CAMPAIGNS = ['Prospecting US', 'Retargeting US', 'Prospecting EU'];
const ADSETS = ['Broad 25-45', 'Lookalike 1%', 'Interests - Beauty'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function ri(min, max) { return Math.floor(rand(min, max)); }

function seed({ days = 30 } = {}) {
  const today = new Date();
  const rows = [];
  let adCounter = 1000;

  for (const c of CREATIVES) {
    // Each creative ships in 1-2 adsets/campaigns
    const placements = Array.from({ length: ri(1, 3) }, () => ({
      campaign: CAMPAIGNS[ri(0, CAMPAIGNS.length)],
      adset: ADSETS[ri(0, ADSETS.length)],
      ad_id: `ad_${adCounter++}`,
    }));

    // Performance archetype per creative
    const baseRoas = rand(1.2, 4.5);
    const baseCtr = rand(0.008, 0.025);
    const fatigueFactor = Math.random() < 0.4; // some creatives fatigue

    for (const p of placements) {
      for (let d = days - 1; d >= 0; d--) {
        const date = new Date(today); date.setDate(today.getDate() - d);
        const dayStr = date.toISOString().slice(0, 10);

        const ageDecay = fatigueFactor && d < 7 ? 0.55 : 1;
        const impressions = ri(2000, 12000);
        const ctr = baseCtr * rand(0.8, 1.2);
        const clicks = Math.round(impressions * ctr);
        const spend = +(impressions / 1000 * rand(8, 22)).toFixed(2);
        const purchases = Math.max(0, Math.round(clicks * rand(0.01, 0.05)));
        const revenue = +(spend * baseRoas * ageDecay * rand(0.85, 1.15)).toFixed(2);

        rows.push({
          ad_id: p.ad_id, ad_name: c.name, campaign: p.campaign, adset: p.adset, date: dayStr,
          spend, impressions, clicks, purchases, revenue,
          format: c.format, thumbnail_url: c.thumb, headline: c.headline, body: c.body,
        });
      }
    }
  }

  const inserted = importRows(rows);

  // Seed a couple of tags
  const tags = ['UGC', 'Static', 'Video', 'Discount'];
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  tags.forEach(t => insTag.run(t));

  const tagMap = Object.fromEntries(db.prepare('SELECT id, name FROM tags').all().map(r => [r.name, r.id]));
  const link = db.prepare('INSERT OR IGNORE INTO creative_tags (creative_id, tag_id) VALUES (?, ?)');
  const creatives = db.prepare('SELECT id, name, format FROM creatives').all();
  for (const c of creatives) {
    if (/UGC|Testimonial/i.test(c.name)) link.run(c.id, tagMap['UGC']);
    if (c.format === 'image') link.run(c.id, tagMap['Static']);
    if (c.format === 'video') link.run(c.id, tagMap['Video']);
    if (/Discount|off/i.test(c.name)) link.run(c.id, tagMap['Discount']);
  }

  return { rowsInserted: inserted, creatives: creatives.length };
}

module.exports = { seed };
