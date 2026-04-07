const express = require('express');
const settings = require('../services/settings');

const router = express.Router();

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
