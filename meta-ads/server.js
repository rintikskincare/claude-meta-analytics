const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Main entry view lives in views/. Static assets (css/js) still come from public/.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.use('/api/settings', require('./routes/settings'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/creatives', require('./routes/creatives'));
app.use('/api/metrics', require('./routes/metrics'));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Meta Ads Analytics running on http://localhost:${PORT}`));
}

module.exports = app;
