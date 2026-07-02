var crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not set up (missing service key).' });
  var BUCKET = 'job-photos';

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function verifyToken(tok) {
    if (!tok) return null;
    var parts = String(tok).split('|');
    if (parts.length < 4) return null;
    var sig = parts.pop();
    var payload = parts.join('|');
    if (sign(payload) !== sig) return null;
    var exp = parseInt(parts[2], 10);
    if (!exp || Date.now() > exp) return null;
    return { username: parts[0], role: parts[1] };
  }
  function readCookie() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'job'; }

  try {
    var sess = verifyToken(readCookie());
    if (!sess) return res.status(200).json({ ok: false, error: 'Please log in again.' });

    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var dataUrl = body.dataUrl || '';
    var job = body.job || 'general';

    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return res.status(200).json({ ok: false, error: 'Bad image data.' });
    var mime = m[1], b64 = m[2];
    if (!/^image\//.test(mime)) return res.status(200).json({ ok: false, error: 'Only image files are allowed.' });
    var buf = Buffer.from(b64, 'base64');
    if (buf.length > 6 * 1024 * 1024) return res.status(200).json({ ok: false, error: 'Image too large. Please use a smaller photo.' });

    var ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = slug(sess.username) + '/' + slug(job) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    var up = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': mime, 'x-upsert': 'true' },
      body: buf
    });
    if (!up.ok) {
      var t = '';
      try { t = await up.text(); } catch (e) {}
      var hint = (up.status === 404 || /bucket/i.test(t)) ? ' The "job-photos" storage bucket may not exist yet — create it in Supabase (Storage → New bucket → name it job-photos → Public).' : '';
      return res.status(200).json({ ok: false, error: 'Upload failed (' + up.status + ').' + hint });
    }
    var publicUrl = SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/' + BUCKET + '/' + path;
    return res.status(200).json({ ok: true, url: publicUrl });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
