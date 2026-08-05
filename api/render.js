// Photoreal property render for Orchamind estimates — geometry-anchored.
// Front end POSTs { prompt, geometry, reference (massing-model snapshot data URL) }.
// Server calls Google's image model (gemini-2.5-flash-image) with the snapshot as
// an image input, so the output follows the verified massing instead of guessing.
// Single-call generation: no asset polling, no third-party render fees.
var BUCKET = {};
var WINDOW_MS = 10 * 60 * 1000;
var MAX_PER_WINDOW = 6; // renders are cost-capped hard per IP

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
    if (!apiKey) return res.status(200).json({ error: 'Live render is not configured yet.' });
    if (!take(clientIp(req))) {
      return res.status(429).json({ error: 'Render limit reached — give it a few minutes.' });
    }

    // Geometry anchor: massing-model snapshot (data URL) or a public reference URL.
    var parts = [];
    var anchored = false;
    var refData = (body.reference || '').toString();
    var refUrl = (body.referenceUrl || '').toString();
    if (refData.indexOf('data:image') === 0 && refData.length <= 2500000) {
      var comma = refData.indexOf(',');
      var mime = refData.substring(5, refData.indexOf(';'));
      parts.push({ inlineData: { mimeType: mime || 'image/jpeg', data: refData.substring(comma + 1) } });
      anchored = true;
    } else if (/^https:\/\//.test(refUrl) && refUrl.length < 500) {
      var rf = await fetch(refUrl);
      if (rf.ok) {
        var buf = Buffer.from(await rf.arrayBuffer());
        if (buf.length <= 3000000) {
          parts.push({ inlineData: { mimeType: rf.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') } });
          anchored = true;
        }
      }
    }
    parts.push({ text: (anchored
      ? 'The attached image is the verified massing model of the building — its exact volumes, proportions, roof forms, glazing bands and porch. Generate a photorealistic render of THIS building, matching the massing precisely. '
      : '') + prompt });

    console.log('[render] req; anchored:', anchored, 'prompt chars:', prompt.length);
    var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });
    var data = await r.json();
    if (data && data.error) {
      console.error('[render] api error:', (data.error.message || JSON.stringify(data.error)).slice(0, 300));
      return res.status(200).json({ error: 'Render error: ' + (data.error.message || 'API error').slice(0, 200) });
    }
    var outParts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var img = null;
    for (var i = 0; i < outParts.length; i++) {
      var p = outParts[i];
      var inl = p.inlineData || p.inline_data;
      if (inl && inl.data) { img = 'data:' + (inl.mimeType || inl.mime_type || 'image/png') + ';base64,' + inl.data; break; }
    }
    if (!img) {
      console.error('[render] no image in response; finish:', data && data.candidates && data.candidates[0] && data.candidates[0].finishReason);
      return res.status(200).json({ error: 'Render did not complete — please try again.' });
    }
    console.log('[render] ok; anchored:', anchored, 'bytes:', img.length);
    return res.status(200).json({ url: img, anchored: anchored });
  } catch (err) {
    console.error('[render] exception:', err.message);
    return res.status(200).json({ error: 'Render error: ' + err.message });
  }
};
