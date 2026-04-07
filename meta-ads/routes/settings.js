const express = require('express');
const settings = require('../services/settings');
const meta = require('../services/meta');

const router = express.Router();

// Test the stored Meta token (or one provided in the body for pre-save checks).
// Never echoes the token back in the response.
router.post('/test-meta', express.json(), async (req, res) => {
  const provided = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const isMasked = provided.startsWith('••••');
  const token = (provided && !isMasked) ? provided : settings.getSecret('meta_access_token');

  try {
    const result = await meta.testConnection(token);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({
      ok: false,
      error: e.message,
      ...(e.meta ? { meta: e.meta } : {}),
    });
  }
});

router.get('/', (req, res) => {
  res.json(settings.getAllPublic());
});

router.get('/schema', (req, res) => {
  // Expose schema (without defaults for secrets) so the UI can render a form.
  const out = {};
  for (const [k, def] of Object.entries(settings.SCHEMA)) {
    out[k] = {
      type: def.type,
      secret: !!def.secret,
      ...(def.values ? { values: def.values } : {}),
      ...(def.min != null ? { min: def.min } : {}),
      ...(def.max != null ? { max: def.max } : {}),
      ...(def.secret ? {} : { default: def.default }),
    };
  }
  res.json(out);
});

router.put('/', express.json(), (req, res) => {
  try {
    const applied = settings.setMany(req.body || {});
    res.json({ ok: true, applied, settings: settings.getAllPublic() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:key', express.json(), (req, res) => {
  try {
    settings.setOne(req.params.key, req.body && req.body.value);
    res.json({ ok: true, settings: settings.getAllPublic() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
