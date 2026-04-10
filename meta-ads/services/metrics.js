const db = require('../db');

// Safe division
const safe = (n, d) => (d > 0 ? n / d : 0);

function deriveKpis(row) {
  return {
    spend: row.spend || 0,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    purchases: row.purchases || 0,
    revenue: row.revenue || 0,
    roas: safe(row.revenue, row.spend),
    cpa: safe(row.spend, row.purchases),
    ctr: safe(row.clicks, row.impressions),
    cpm: safe(row.spend * 1000, row.impressions),
    cpc: safe(row.spend, row.clicks),
  };
}

function dateClause(from, to) {
  const conds = [];
  const params = {};
  if (from) { conds.push('i.date >= @from'); params.from = from; }
  if (to)   { conds.push('i.date <= @to');   params.to   = to;   }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

function totals({ from, to } = {}) {
  const { where, params } = dateClause(from, to);
  const row = db.prepare(`
    SELECT COALESCE(SUM(spend),0) spend,
           COALESCE(SUM(impressions),0) impressions,
           COALESCE(SUM(clicks),0) clicks,
           COALESCE(SUM(purchases),0) purchases,
           COALESCE(SUM(revenue),0) revenue
    FROM insights i ${where}
  `).get(params);
  return deriveKpis(row);
}

function creativeLeaderboard({ from, to, sort = 'spend', dir = 'desc', limit = 50, tag } = {}) {
  const { where, params } = dateClause(from, to);
  const tagJoin = tag
    ? 'JOIN creative_tags ct ON ct.creative_id = c.id JOIN tags t ON t.id = ct.tag_id AND t.name = @tag'
    : '';
  if (tag) params.tag = tag;
  const allowedSort = ['spend', 'revenue', 'roas', 'cpa', 'ctr', 'impressions', 'purchases'];
  const sortKey = allowedSort.includes(sort) ? sort : 'spend';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           SUM(i.spend) spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks) clicks,
           SUM(i.purchases) purchases,
           SUM(i.revenue) revenue
    FROM creatives c
    ${tagJoin}
    JOIN ads a ON a.creative_id = c.id
    JOIN insights i ON i.ad_id = a.id
    ${where}
    GROUP BY c.id
    HAVING spend > 0
  `).all(params);

  const enriched = rows.map(r => ({ ...r, ...deriveKpis(r) }));
  enriched.sort((a, b) => sortDir === 'ASC' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  return enriched.slice(0, limit);
}

function creativeDetail(id, { from, to } = {}) {
  const creative = db.prepare('SELECT * FROM creatives WHERE id = ?').get(id);
  if (!creative) return null;

  const tags = db.prepare(`
    SELECT t.name FROM tags t JOIN creative_tags ct ON ct.tag_id = t.id
    WHERE ct.creative_id = ? ORDER BY t.name
  `).all(id).map(r => r.name);

  const { where, params } = dateClause(from, to);
  params.cid = id;

  const totalsRow = db.prepare(`
    SELECT SUM(i.spend) spend, SUM(i.impressions) impressions,
           SUM(i.clicks) clicks, SUM(i.purchases) purchases, SUM(i.revenue) revenue
    FROM insights i JOIN ads a ON a.id = i.ad_id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
  `).get(params);

  const trend = db.prepare(`
    SELECT i.date,
           SUM(i.spend) spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks) clicks,
           SUM(i.purchases) purchases,
           SUM(i.revenue) revenue
    FROM insights i JOIN ads a ON a.id = i.ad_id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
    GROUP BY i.date ORDER BY i.date
  `).all(params).map(r => ({ date: r.date, ...deriveKpis(r) }));

  const placements = db.prepare(`
    SELECT a.campaign, a.adset,
           SUM(i.spend) spend, SUM(i.impressions) impressions,
           SUM(i.clicks) clicks, SUM(i.purchases) purchases, SUM(i.revenue) revenue
    FROM ads a JOIN insights i ON i.ad_id = a.id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
    GROUP BY a.campaign, a.adset
  `).all(params).map(r => ({ campaign: r.campaign, adset: r.adset, ...deriveKpis(r) }));

  return { creative, tags, totals: deriveKpis(totalsRow), trend, placements };
}

// Fatigue: ROAS in last 7 days dropped >30% vs prior 7 days, with min spend gate.
function fatigueAlerts({ minSpend = 100 } = {}) {
  const rows = db.prepare(`
    WITH recent AS (
      SELECT a.creative_id,
             SUM(CASE WHEN i.date >= date('now','-7 days') THEN i.spend ELSE 0 END) s_now,
             SUM(CASE WHEN i.date >= date('now','-7 days') THEN i.revenue ELSE 0 END) r_now,
             SUM(CASE WHEN i.date < date('now','-7 days') AND i.date >= date('now','-14 days') THEN i.spend ELSE 0 END) s_prev,
             SUM(CASE WHEN i.date < date('now','-7 days') AND i.date >= date('now','-14 days') THEN i.revenue ELSE 0 END) r_prev
      FROM ads a JOIN insights i ON i.ad_id = a.id
      WHERE i.date >= date('now','-14 days')
      GROUP BY a.creative_id
    )
    SELECT c.id, c.name, c.thumbnail_url, s_now, r_now, s_prev, r_prev
    FROM recent JOIN creatives c ON c.id = recent.creative_id
    WHERE s_now >= @minSpend AND s_prev >= @minSpend
  `).all({ minSpend });

  return rows
    .map(r => {
      const roasNow = safe(r.r_now, r.s_now);
      const roasPrev = safe(r.r_prev, r.s_prev);
      const drop = roasPrev > 0 ? (roasPrev - roasNow) / roasPrev : 0;
      return { id: r.id, name: r.name, thumbnail_url: r.thumbnail_url,
               roas_now: roasNow, roas_prev: roasPrev, drop };
    })
    .filter(r => r.drop > 0.30)
    .sort((a, b) => b.drop - a.drop);
}

// Win Rate Analysis — funnel-aware creative scoring.
//
// Scoring rules by funnel stage:
//   TOF (awareness)    → engagement score: CTR weight
//   MOF (consideration)→ consideration: CTR + CPC efficiency
//   BOF (conversion)   → conversion:    ROAS >= threshold
//   Unknown / all      → blended ROAS vs threshold
//
// A creative is a "winner" when its funnel-appropriate score beats
// the relevant threshold. The API returns per-creative verdicts plus
// aggregate summary stats.

function winRateAnalysis({ from, to, roasThreshold } = {}) {
  const settings = require('./settings');
  const threshold = roasThreshold ?? settings.get('winner_roas_threshold');

  const { where, params } = dateClause(from, to);

  // Pull every creative that had delivery in the window.
  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           c.funnel_stage, c.asset_type, c.messaging_angle,
           SUM(i.spend)       spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks)      clicks,
           SUM(i.purchases)   purchases,
           SUM(i.revenue)     revenue
    FROM creatives c
    JOIN ads a ON a.creative_id = c.id
    JOIN insights i ON i.ad_id = a.id
    ${where}
    GROUP BY c.id
    HAVING spend > 0
  `).all(params);

  // Derive full KPIs for each creative and assign funnel-aware win status.
  const creatives = rows.map(r => {
    const kpis = deriveKpis(r);
    const funnel = (r.funnel_stage || 'unknown').toLowerCase();
    let score, scoreLabel, isWinner;

    if (funnel === 'awareness') {
      // TOF: engagement-based — CTR above median is a win.
      // We use a fixed CTR threshold of 1% as the engagement bar.
      score = kpis.ctr;
      scoreLabel = 'CTR';
      isWinner = kpis.ctr >= 0.01;
    } else if (funnel === 'consideration') {
      // MOF: consideration efficiency — good CTR AND reasonable CPC.
      // Win if CTR >= 0.8% AND CPC is under the overall average CPC
      // (we approximate with a $3 CPC ceiling as a sensible default).
      score = kpis.ctr;
      scoreLabel = 'CTR + CPC';
      isWinner = kpis.ctr >= 0.008 && (kpis.cpc <= 3 || kpis.clicks === 0);
    } else if (funnel === 'conversion' || funnel === 'retention') {
      // BOF: hard ROAS gate.
      score = kpis.roas;
      scoreLabel = 'ROAS';
      isWinner = kpis.roas >= threshold;
    } else {
      // Unknown funnel stage → fall back to blended ROAS threshold.
      score = kpis.roas;
      scoreLabel = 'ROAS';
      isWinner = kpis.roas >= threshold;
    }

    return {
      ...r, ...kpis,
      funnel, score, scoreLabel, isWinner,
    };
  });

  // Aggregate summaries.
  const winners = creatives.filter(c => c.isWinner);
  const losers  = creatives.filter(c => !c.isWinner);

  const sumField = (arr, f) => arr.reduce((s, r) => s + (r[f] || 0), 0);
  const safeAvg  = (arr, f) => arr.length ? sumField(arr, f) / arr.length : 0;

  const totalSpend   = sumField(creatives, 'spend');
  const totalRevenue = sumField(creatives, 'revenue');

  // Per-funnel breakdown.
  const funnels = {};
  for (const c of creatives) {
    if (!funnels[c.funnel]) funnels[c.funnel] = { total: 0, winners: 0, spend: 0, revenue: 0 };
    funnels[c.funnel].total++;
    funnels[c.funnel].spend += c.spend;
    funnels[c.funnel].revenue += c.revenue;
    if (c.isWinner) funnels[c.funnel].winners++;
  }
  for (const f of Object.values(funnels)) {
    f.winRate = safe(f.winners, f.total);
    f.roas    = safe(f.revenue, f.spend);
  }

  return {
    summary: {
      total:        creatives.length,
      winners:      winners.length,
      losers:       losers.length,
      winRate:      safe(winners.length, creatives.length),
      totalSpend:   totalSpend,
      totalRevenue: totalRevenue,
      blendedRoas:  safe(totalRevenue, totalSpend),
      avgRoasWinners: safeAvg(winners, 'roas'),
      avgRoasLosers:  safeAvg(losers, 'roas'),
      roasThreshold:  threshold,
    },
    funnels,
    creatives,
  };
}

// Stop / Scale Recommendations — funnel-aware action cards.
//
// Each creative with delivery gets bucketed into one of:
//   Scale  — performing well for its funnel, increase budget
//   Watch  — borderline or early signal, monitor closely
//   Stop   — underperforming, cut spend
//
// The logic mirrors the win-rate scoring thresholds but adds a
// middle "Watch" band and generates a short rationale string
// explaining the verdict.

function recommendations({ from, to, roasThreshold, minSpend } = {}) {
  const settings = require('./settings');
  const threshold = roasThreshold ?? settings.get('winner_roas_threshold');
  const spendFloor = minSpend ?? settings.get('iteration_spend_threshold');

  const { where, params } = dateClause(from, to);

  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           c.funnel_stage, c.asset_type, c.messaging_angle, c.hook_tactic,
           SUM(i.spend)       spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks)      clicks,
           SUM(i.purchases)   purchases,
           SUM(i.revenue)     revenue
    FROM creatives c
    JOIN ads a ON a.creative_id = c.id
    JOIN insights i ON i.ad_id = a.id
    ${where}
    GROUP BY c.id
    HAVING spend > 0
  `).all(params);

  const creatives = rows.map(r => {
    const kpis = deriveKpis(r);
    const funnel = (r.funnel_stage || 'unknown').toLowerCase();
    let action, rationale;

    if (funnel === 'awareness') {
      // TOF — engagement driven
      if (kpis.ctr >= 0.015) {
        action = 'scale';
        rationale = `Strong engagement at ${(kpis.ctr * 100).toFixed(2)}% CTR — well above the 1% TOF bar. Increase budget to maximize reach.`;
      } else if (kpis.ctr >= 0.008) {
        action = 'watch';
        rationale = `CTR of ${(kpis.ctr * 100).toFixed(2)}% is decent but below the 1.5% scale threshold. Test new hooks or audiences before scaling.`;
      } else {
        action = 'stop';
        rationale = `Low engagement at ${(kpis.ctr * 100).toFixed(2)}% CTR — below the 0.8% floor. Creative is not resonating with the audience.`;
      }
    } else if (funnel === 'consideration') {
      // MOF — CTR + CPC efficiency
      const goodCtr = kpis.ctr >= 0.01;
      const goodCpc = kpis.cpc > 0 && kpis.cpc <= 2;
      const okCtr   = kpis.ctr >= 0.006;
      const okCpc   = kpis.cpc > 0 && kpis.cpc <= 4;

      if (goodCtr && goodCpc) {
        action = 'scale';
        rationale = `Efficient consideration driver — ${(kpis.ctr * 100).toFixed(2)}% CTR with ${fmt_money(kpis.cpc)} CPC. Scale budget to capture more intent.`;
      } else if (okCtr && okCpc) {
        action = 'watch';
        rationale = `Moderate consideration metrics — ${(kpis.ctr * 100).toFixed(2)}% CTR, ${fmt_money(kpis.cpc)} CPC. Refine targeting or copy to improve efficiency.`;
      } else {
        action = 'stop';
        const reason = !okCtr ? `CTR too low at ${(kpis.ctr * 100).toFixed(2)}%` : `CPC too high at ${fmt_money(kpis.cpc)}`;
        rationale = `${reason}. Not driving cost-effective consideration. Reallocate budget.`;
      }
    } else if (funnel === 'conversion' || funnel === 'retention') {
      // BOF — hard ROAS gate
      if (kpis.roas >= threshold * 1.5) {
        action = 'scale';
        rationale = `Top performer at ${kpis.roas.toFixed(2)}x ROAS — ${((kpis.roas / threshold - 1) * 100).toFixed(0)}% above the ${threshold}x threshold. Maximize budget allocation.`;
      } else if (kpis.roas >= threshold * 0.7) {
        action = 'watch';
        if (kpis.roas >= threshold) {
          rationale = `ROAS of ${kpis.roas.toFixed(2)}x meets the ${threshold}x threshold but lacks headroom. Monitor for fatigue before scaling.`;
        } else {
          rationale = `ROAS of ${kpis.roas.toFixed(2)}x is close to the ${threshold}x threshold. May improve with audience or bid optimization.`;
        }
      } else {
        action = 'stop';
        rationale = `ROAS of ${kpis.roas.toFixed(2)}x is well below the ${threshold}x target. Burning budget without adequate return.`;
      }
    } else {
      // Unknown funnel — fall back to ROAS
      if (kpis.roas >= threshold * 1.5) {
        action = 'scale';
        rationale = `Strong ${kpis.roas.toFixed(2)}x ROAS despite no funnel tag. Classify the funnel stage and scale.`;
      } else if (kpis.roas >= threshold * 0.7) {
        action = 'watch';
        rationale = `${kpis.roas.toFixed(2)}x ROAS is borderline. Assign a funnel stage for more precise scoring, then re-evaluate.`;
      } else {
        action = 'stop';
        rationale = `Low ${kpis.roas.toFixed(2)}x ROAS with no funnel classification. Pause and analyze before continuing spend.`;
      }
    }

    // Insufficient-spend override: if below the spend floor, downgrade
    // scale→watch with a "low sample" caveat (never override stop).
    if (r.spend < spendFloor && action === 'scale') {
      action = 'watch';
      rationale = `Metrics look promising but only ${fmt_money(r.spend)} spent (below ${fmt_money(spendFloor)} floor). Let it run longer before scaling.`;
    }

    return { ...r, ...kpis, funnel, action, rationale };
  });

  // Sort: scale first, then watch, then stop. Within each bucket, by spend desc.
  const ORDER = { scale: 0, watch: 1, stop: 2 };
  creatives.sort((a, b) => (ORDER[a.action] - ORDER[b.action]) || (b.spend - a.spend));

  const scale = creatives.filter(c => c.action === 'scale');
  const watch = creatives.filter(c => c.action === 'watch');
  const stop  = creatives.filter(c => c.action === 'stop');

  const sumField = (arr, f) => arr.reduce((s, r) => s + (r[f] || 0), 0);

  return {
    summary: {
      total:     creatives.length,
      scale:     scale.length,
      watch:     watch.length,
      stop:      stop.length,
      scaleSpend: sumField(scale, 'spend'),
      watchSpend: sumField(watch, 'spend'),
      stopSpend:  sumField(stop, 'spend'),
      totalSpend: sumField(creatives, 'spend'),
      totalRevenue: sumField(creatives, 'revenue'),
      blendedRoas: safe(sumField(creatives, 'revenue'), sumField(creatives, 'spend')),
      roasThreshold: threshold,
      spendFloor,
    },
    creatives,
  };
}

// Tiny helper — format dollars without needing the browser's fmt object.
function fmt_money(n) { return '$' + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

module.exports = { deriveKpis, totals, creativeLeaderboard, creativeDetail, fatigueAlerts, winRateAnalysis, recommendations };
