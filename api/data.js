var crypto = require('crypto');

function readBody(req) {
  var b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) {
    // Don't block the app — just behave like "no saved data yet"
    if (req.method === 'GET') return res.status(200).json({ ok: true, data: null });
    return res.status(200).json({ ok: true, skipped: true });
  }
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function verifyToken(tok) {
    if (!tok) return null;
    var parts = String(tok).split('|');
    if (parts.length !== 4) return null;
    var u = parts[0], role = parts[1], exp = parts[2], sig = parts[3];
    if (sign(u + '|' + role + '|' + exp) !== sig) return null;
    if (Date.now() > Number(exp)) return null;
    return { username: u, role: role };
  }
  function readCookie() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var sess = verifyToken(readCookie());

  try {
    if (req.method === 'GET') {
      // No session (or demo) => no saved data; app falls back to its seed.
      if (!sess || sess.role === 'demo') return res.status(200).json({ ok: true, data: null });
      var r = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(sess.username) + '&select=data', { headers: H });
      var a = await r.json();
      var row = (Array.isArray(a) && a[0]) ? a[0] : null;
      return res.status(200).json({ ok: true, data: row ? row.data : null });
    }

    if (req.method === 'POST') {
      // Demo or signed-out users: accept but don't persist.
      if (!sess || sess.role === 'demo') return res.status(200).json({ ok: true, skipped: true });
      var body = readBody(req);
      var data = body.data || {};
      var up = await fetch(base + '/app_data', {
        method: 'POST',
        headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ username: sess.username, data: data, updated_at: new Date().toISOString() })
      });
      if (!up.ok) { var et = await up.text(); return res.status(200).json({ ok: false, error: et.slice(0, 160) }); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
