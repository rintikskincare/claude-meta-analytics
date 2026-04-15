const path = require('path');
const express = require('express');
const { gate, isAuthEnabled } = require('./services/auth');

const app = express();
app.use(express.json());

// Auth gate: runs before any static/route handler. When APP_PASSWORD is set,
// this redirects unauthenticated page requests to /login.html and returns
// 401 for API calls. Public paths (login page, its JS/CSS, /api/auth/*) pass
// through untouched.
app.use(gate);

// Auth endpoints — mounted after the gate (the gate exempts /api/auth/*).
app.use('/api/auth', require('./routes/auth'));

// Static assets (including login.html) served from public/.
app.use(express.static(path.join(__dirname, 'public')));

// Main entry view lives in views/. Static assets (css/js) still come from public/.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/accounts.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'accounts.html')));
app.get('/creatives.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'creatives.html')));
app.get('/analytics.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'analytics.html')));
app.get('/reports.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'reports.html')));
app.get('/settings.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'settings.html')));

app.use('/api/settings', require('./routes/settings'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/creatives', require('./routes/creatives'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/reports', require('./routes/reports'));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Meta Ads Analytics running on http://${HOST}:${PORT}`);
    if (!isAuthEnabled()) {
      console.log('Auth: DISABLED (set APP_PASSWORD env var to enable login).');
    } else {
      console.log('Auth: enabled. Visit /login.html to sign in.');
    }
  });
}

module.exports = app;
