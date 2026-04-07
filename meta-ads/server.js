const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
