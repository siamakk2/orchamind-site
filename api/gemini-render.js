// Photoreal property render for Orchamind estimates — Gemini variant.
// Kept completely separate from render.js (Arcads/Seedream) so neither path
// can break the other. Front end (demo.html epvRenderReal) POSTs { prompt }.
// Gemini's image model returns the image inline (base64) — no polling needed.
var BUCKET = {};
var WINDOW_MS = 10 * 60 * 1000;
var MAX_PER_WINDOW = 6; // same cap as the Arcads path — renders are expensive either way

function allowedOrigin(o) {
  if (!o) return true;
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
function take(ip) {
  var now = Date.now();
  var arr = (BUCKET[ip] || []).filter(function (t) { return now - t < WINDOW_MS; });
  if (arr.length >= MAX_PER_WINDOW) { BUCKET[ip] = arr; return false; }
  arr.push(now); BUCKET[ip] = arr;
  if (Object.keys(BUCKET).length > 5000) BUCKET = {};
  return true;
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  var cors = allowedOrigin(origin) ? (origin || '*') : 'https://orchamind.com';
  res.setHeader('Access-Control-Allow-Origin', cors);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowedOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed.' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    var prompt = (body.prompt || '').toString().slice(0, 1500);
    if (!prompt) return res.status(200).json({ error: 'Nothing to render.' });

    var apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ error: 'Gemini render is not configured yet (GEMINI_API_KEY missing).' });
    }
    if (!take(clientIp(req))) {
      return res.status(429).json({ error: 'Render limit reached — give it a few minutes.' });
    }

    var model = 'gemini-2.5-flash-image';
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

    var genRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    var raw = await genRes.text();
    var data;
    try { data = JSON.parse(raw); } catch (e) { data = null; }

    if (!genRes.ok) {
      // Surface the real reason (bad key, wrong auth type, quota, etc.) rather than a generic failure —
      // this is exactly what we need to see in logs to confirm whether the provided key actually works.
      var reason = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + genRes.status + ': ' + raw.slice(0, 300));
      console.error('[gemini-render] API error:', genRes.status, reason);
      return res.status(200).json({ error: 'Gemini render failed: ' + reason });
    }

    var parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
    var imgPart = parts.find(function (p) { return p.inlineData || p.inline_data; });
    var inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
    if (!inline || !inline.data) {
      console.error('[gemini-render] No image in response:', JSON.stringify(data).slice(0, 500));
      return res.status(200).json({ error: 'Gemini did not return an image — try again.' });
    }
    var mime = inline.mimeType || inline.mime_type || 'image/png';
    var dataUrl = 'data:' + mime + ';base64,' + inline.data;
    return res.status(200).json({ url: dataUrl, provider: 'gemini' });
  } catch (err) {
    console.error('[gemini-render] error:', err.message);
    return res.status(200).json({ error: 'Gemini render error: ' + err.message });
  }
};
