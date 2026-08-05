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

    // Geometry anchor: the client sends a snapshot of the verified massing model
    // (data URL) and/or a public reference URL. With a reference we use
    // nano-banana-2 (reference-conditioned); without, Seedream text-to-image.
    var refs = [];
    var refUrl = (body.referenceUrl || '').toString();
    if (/^https:\/\//.test(refUrl) && refUrl.length < 500) refs.push(refUrl);
    var refData = (body.reference || '').toString();
    if (refs.length === 0 && refData.indexOf('data:image') === 0 && refData.length <= 2000000) refs.push(refData);
    console.log('[render] req; refs:', refs.length, 'prompt chars:', prompt.length);

    async function generate(useRefs) {
      var payload = { prompt: prompt, aspectRatio: '16:9', nbGenerations: 1 };
      if (useRefs && refs.length) { payload.model = 'nano-banana-2'; payload.referenceImages = refs; }
      else { payload.model = 'seedream_5_pro'; }
      var genRes = await fetch(base + '/v1/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(payload)
      });
      var gen = await genRes.json();
      var url = gen && (gen.url || (gen.images && gen.images[0] && gen.images[0].url) ||
                 (gen.data && gen.data[0] && gen.data[0].url));
      var assetId = gen && (gen.id || gen.assetId || (gen.asset && gen.asset.id) ||
                    (gen.assets && gen.assets[0] && gen.assets[0].id) ||
                    (gen.data && gen.data[0] && gen.data[0].id));
      if (!url && assetId) {
        // Poll up to ~90s — reference-conditioned generation takes about a minute.
        for (var i = 0; i < 36 && !url; i++) {
          await new Promise(function (r) { setTimeout(r, 2500); });
          var pr = await fetch(base + '/v1/assets/' + assetId, {
            headers: { 'Authorization': 'Bearer ' + apiKey }
          });
          var pd = await pr.json();
          url = pd && (pd.url || (pd.output && pd.output.url) ||
                (pd.assets && pd.assets[0] && pd.assets[0].url));
          if (pd && (pd.status === 'failed' || pd.error)) {
            console.error('[render] asset failed:', (pd.error && (pd.error.message || JSON.stringify(pd.error)) || pd.status || '').toString().slice(0, 200));
            break;
          }
        }
      }
      if (!url && gen && gen.error) console.error('[render] generate error (refs=' + (useRefs && refs.length) + '):', (gen.error.message || JSON.stringify(gen.error)).slice(0, 300));
      return url;
    }

    var url = await generate(true);
    if (!url && refs.length) {
      // Reference path failed — fall back to text-only so the user still gets an image.
      console.log('[render] reference attempt failed; retrying text-only');
      url = await generate(false);
    }

    if (!url) return res.status(200).json({ error: 'Render did not complete — please try again.' });
    console.log('[render] ok; anchored:', refs.length > 0);
    return res.status(200).json({ url: url, anchored: refs.length > 0 });
  } catch (err) {
    return res.status(200).json({ error: 'Render error: ' + err.message });
  }
};
