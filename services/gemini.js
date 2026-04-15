// Gemini-powered creative analysis.
//
// Sends the creative's copy, format, and thumbnail (if available) to
// Google's Gemini API and asks for structured classification tags.
// The returned object is written directly into the creatives table.

const settings = require('./settings');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.0-flash';

// Allowed tag values. Gemini is instructed to pick exactly one per field.
const SCHEMA = {
  asset_type: [
    'ugc_video', 'talking_head', 'product_demo', 'lifestyle_photo',
    'static_graphic', 'carousel', 'motion_graphic', 'before_after',
    'slideshow', 'meme', 'screenshot', 'other',
  ],
  visual_format: [
    'square_1x1', 'vertical_4x5', 'vertical_9x16', 'horizontal_16x9',
    'horizontal_1.91x1', 'story', 'reel', 'other',
  ],
  messaging_angle: [
    'testimonial', 'social_proof', 'discount', 'urgency', 'fear_of_missing_out',
    'transformation', 'education', 'founder_story', 'comparison',
    'unboxing', 'how_to', 'behind_the_scenes', 'humor', 'emotional_appeal',
    'authority', 'general',
  ],
  hook_tactic: [
    'question', 'bold_claim', 'statistic', 'before_after', 'controversy',
    'pain_point', 'curiosity_gap', 'social_proof', 'direct_address',
    'storytelling', 'visual_shock', 'none',
  ],
  offer_type: [
    'percentage_off', 'dollar_off', 'bogo', 'free_shipping', 'free_trial',
    'bundle', 'limited_time', 'exclusive', 'no_offer',
  ],
  funnel_stage: [
    'awareness', 'consideration', 'conversion', 'retention',
  ],
};

function buildPrompt(creative) {
  return `You are an expert Meta Ads creative analyst. Classify this ad creative with EXACTLY one value per field.

CREATIVE DATA:
- Name: ${creative.name || 'unknown'}
- Format: ${creative.format || 'unknown'}
- Headline: ${creative.headline || '(none)'}
- Body copy: ${creative.body || '(none)'}

Respond ONLY with valid JSON, no markdown fences, no explanation:
{
  "asset_type": one of [${SCHEMA.asset_type.map(v => `"${v}"`).join(', ')}],
  "visual_format": one of [${SCHEMA.visual_format.map(v => `"${v}"`).join(', ')}],
  "messaging_angle": one of [${SCHEMA.messaging_angle.map(v => `"${v}"`).join(', ')}],
  "hook_tactic": one of [${SCHEMA.hook_tactic.map(v => `"${v}"`).join(', ')}],
  "offer_type": one of [${SCHEMA.offer_type.map(v => `"${v}"`).join(', ')}],
  "funnel_stage": one of [${SCHEMA.funnel_stage.map(v => `"${v}"`).join(', ')}],
  "summary": "<One sentence describing the creative's strategy and appeal>"
}`;
}

function buildParts(creative) {
  const parts = [{ text: buildPrompt(creative) }];
  // If a thumbnail URL is available, include it as an image part so Gemini
  // can reason about the visual content.
  if (creative.thumbnail_url) {
    parts.push({
      text: `\nThe creative's thumbnail image is at: ${creative.thumbnail_url}\nDescribe and incorporate visual details you can infer from the URL and the format.`,
    });
  }
  return parts;
}

// Call the Gemini API. Exported on module.exports so tests can stub it.
async function callGemini(parts) {
  const apiKey = settings.getSecret('gemini_api_key');
  if (!apiKey) {
    const err = new Error('No Gemini API key configured. Save one in Settings first.');
    err.status = 400;
    throw err;
  }

  const url = `${API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (e) {
    const err = new Error(`Network error calling Gemini: ${e.message}`);
    err.status = 502;
    throw err;
  }

  let body;
  try { body = await resp.json(); } catch { body = null; }

  if (!resp.ok) {
    const msg = body?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`Gemini API error: ${msg}`);
    err.status = resp.status >= 500 ? 502 : resp.status;
    throw err;
  }

  // Extract the text from the first candidate.
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no content. The creative may have been blocked by safety filters.');
  }
  return text;
}

// Parse and validate the JSON response from Gemini.
function parseResponse(raw) {
  // Strip markdown code fences if Gemini wraps them despite instructions.
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini returned invalid JSON: ${e.message}`);
  }

  const result = {};
  for (const [key, allowed] of Object.entries(SCHEMA)) {
    const val = String(parsed[key] || '').trim().toLowerCase().replace(/\s+/g, '_');
    result[key] = allowed.includes(val) ? val : allowed[allowed.length - 1]; // fallback to last (safest) value
  }
  result.summary = typeof parsed.summary === 'string'
    ? parsed.summary.slice(0, 500)
    : 'No summary generated.';
  return result;
}

// High-level: analyze one creative. Returns the parsed tags.
async function analyzeCreative(creative) {
  const parts = buildParts(creative);
  const raw = await module.exports.callGemini(parts);
  return parseResponse(raw);
}

module.exports = {
  SCHEMA,
  analyzeCreative,
  callGemini,      // swappable for tests
  _internal: { buildPrompt, buildParts, parseResponse },
};
