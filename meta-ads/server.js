const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());
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
  app.listen(PORT, HOST, () => console.log(`Meta Ads Analytics running on http://${HOST}:${PORT}`));
}

module.exports = app;
