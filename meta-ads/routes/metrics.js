const express = require('express');
const { totals, creativeLeaderboard, fatigueAlerts, winRateAnalysis, recommendations, iterationPriorities } = require('../services/metrics');

const router = express.Router();

router.get('/totals', (req, res) => {
  res.json(totals({ from: req.query.from, to: req.query.to }));
});

router.get('/leaderboard', (req, res) => {
  const { from, to, sort, dir, tag } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(creativeLeaderboard({ from, to, sort, dir, tag, limit }));
});

router.get('/fatigue', (req, res) => {
  const minSpend = parseFloat(req.query.min_spend) || 100;
  res.json(fatigueAlerts({ minSpend }));
});

router.get('/win-rate', (req, res) => {
  const { from, to } = req.query;
  const roasThreshold = req.query.threshold != null ? parseFloat(req.query.threshold) : undefined;
  res.json(winRateAnalysis({ from, to, roasThreshold }));
});

router.get('/recommendations', (req, res) => {
  const { from, to } = req.query;
  const roasThreshold = req.query.threshold != null ? parseFloat(req.query.threshold) : undefined;
  const minSpend = req.query.min_spend != null ? parseFloat(req.query.min_spend) : undefined;
  res.json(recommendations({ from, to, roasThreshold, minSpend }));
});

router.get('/iterations', (req, res) => {
  const { from, to } = req.query;
  const roasThreshold = req.query.threshold != null ? parseFloat(req.query.threshold) : undefined;
  const minSpend = req.query.min_spend != null ? parseFloat(req.query.min_spend) : undefined;
  res.json(iterationPriorities({ from, to, roasThreshold, minSpend }));
});

module.exports = router;
