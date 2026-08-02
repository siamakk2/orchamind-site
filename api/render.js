// Photoreal property render for Orchamind estimates.
// Front end (demo.html epvRenderReal) POSTs { prompt, geometry }.
// Server calls the image model (Arcads Seedream) and returns { url }.
// Cost-protected: origin allowlist + per-IP rate limit. Paid-tier feature.
var BUCKET = {};
var WINDOW_MS = 10 * 60 * 1000;
var MAX_PER_WINDOW = 6; // renders are expensive — cap hard per IP

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

    var apiKey = process.env.ARCADS_API_KEY;
    var base = process.env.ARCADS_API_BASE || 'https://api.arcads.ai';
    if (!apiKey) {
      // Not yet configured — front end shows a graceful retry state.
      return res.status(200).json({ error: 'Live render is not configured yet.' });
    }
    if (!take(clientIp(req))) {
      return res.status(429).json({ error: 'Render limit reached — give it a few minutes.' });
    }

    // Kick off a Seedream image generation.
    var genRes = await fetch(base + '/v1/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'seedream_5_pro', prompt: prompt, aspectRatio: '16:9', nbGenerations: 1 })
    });
    var gen = await genRes.json();
    // Endpoint may return a ready URL, or an asset id to poll.
    var url = gen && (gen.url || (gen.images && gen.images[0] && gen.images[0].url) ||
               (gen.data && gen.data[0] && gen.data[0].url));
    var assetId = gen && (gen.id || gen.assetId || (gen.asset && gen.asset.id));

    if (!url && assetId) {
      // Poll up to ~50s for completion.
      for (var i = 0; i < 20 && !url; i++) {
        await new Promise(function (r) { setTimeout(r, 2500); });
        var pr = await fetch(base + '/v1/assets/' + assetId, {
          headers: { 'Authorization': 'Bearer ' + apiKey }
        });
        var pd = await pr.json();
        url = pd && (pd.url || (pd.output && pd.output.url) ||
              (pd.assets && pd.assets[0] && pd.assets[0].url));
        if (pd && (pd.status === 'failed' || pd.error)) break;
      }
    }

    if (!url) return res.status(200).json({ error: 'Render did not complete — please try again.' });
    return res.status(200).json({ url: url });
  } catch (err) {
    return res.status(200).json({ error: 'Render error: ' + err.message });
  }
};
