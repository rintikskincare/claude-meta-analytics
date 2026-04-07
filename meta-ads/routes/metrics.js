const express = require('express');
const { totals, creativeLeaderboard, fatigueAlerts } = require('../services/metrics');

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

module.exports = router;
