// Claude relay for the Orchamind DEMO (used by demo.html). Cost-protected:
// origin allowlist + per-IP weighted rate limit (vision costs more than text).
var BUCKET = {}; // ip -> [{t,w}] — per warm instance; cheap first line of defense
var WINDOW_MS = 5 * 60 * 1000;
var MAX_UNITS = 25;          // weighted units per IP per window
var MEDIA_WEIGHT = 5;        // an image/PDF request costs 5 units
var TEXT_WEIGHT = 1;
var MAX_MEDIA_BLOCKS = 5;    // max images/documents in one request

function allowedOrigin(o) {
  if (!o) return true; // same-origin/no-origin (server tools) — rate limit still applies
  try {
    var h = new URL(o).hostname;
    return h === 'orchamind.com' || h === 'www.orchamind.com' ||
           h === 'localhost' || /(^|\.)vercel\.app$/.test(h);
  } catch (e) { return false; }
}
function clientIp(req) {
  var f = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function countMedia(messages) {
  var n = 0;
  (messages || []).forEach(function (m) {
    if (Array.isArray(m.content)) m.content.forEach(function (b) {
      if (b && (b.type === 'image' || b.type === 'document')) n++;
    });
  });
  return n;
}
function takeUnits(ip, w) {
  var now = Date.now();
  var arr = (BUCKET[ip] || []).filter(function (e) { return now - e.t < WINDOW_MS; });
  var used = arr.reduce(function (s, e) { return s + e.w; }, 0);
  if (used + w > MAX_UNITS) { BUCKET[ip] = arr; return false; }
  arr.push({ t: now, w: w });
  BUCKET[ip] = arr;
  if (Object.keys(BUCKET).length > 5000) BUCKET = {}; // memory guard
  return true;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  var cors = allowedOrigin(origin) ? (origin || '*') : 'https://orchamind.com';
  res.setHeader('Access-Control-Allow-Origin', cors);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }
  if (!allowedOrigin(origin)) { return res.status(403).json({ error: 'Origin not allowed.' }); }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { return res.status(200).json({ error: 'Demo AI not configured.' }); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};

    const maxTokens = Math.min(body.max_tokens || 800, 8000);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = (body.system || '').toString().slice(0, 12000);

    const media = countMedia(messages);
    if (media > MAX_MEDIA_BLOCKS) {
      return res.status(200).json({ error: 'Too many images in one request — send up to ' + MAX_MEDIA_BLOCKS + ' plan pages at a time.' });
    }
    const weight = media > 0 ? MEDIA_WEIGHT : TEXT_WEIGHT;
    if (!takeUnits(clientIp(req), weight)) {
      return res.status(429).json({ error: 'Too many AI requests from your connection — give it a few minutes and try again.' });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: system, messages: messages })
    });
    const data = await r.json();
    if (media > 0) {
      // Plan reads are the expensive, failure-prone path — log enough to diagnose from Vercel logs.
      var _size = 0; try { _size = JSON.stringify(data.content || '').length; } catch (e) {}
      if (data && data.error) {
        console.error('[claude] media req FAILED:', media, 'blocks; anthropic error:', (data.error.message || JSON.stringify(data.error)).slice(0, 300));
      } else {
        console.log('[claude] media req ok:', media, 'blocks; stop:', data && data.stop_reason, '; content chars:', _size);
      }
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ error: 'Demo AI error: ' + err.message });
  }
};
