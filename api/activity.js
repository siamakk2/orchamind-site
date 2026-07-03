var crypto = require('crypto');
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not configured.' });
  var rest = SUPABASE_URL + '/rest/v1';
  var H = { apikey: KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  var ADMIN = 'siamakk2';
  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function verify(tok) { if (!tok) return null; var p = String(tok).split('|'); if (p.length !== 4) return null; if (sign(p[0] + '|' + p[1] + '|' + p[2]) !== p[3]) return null; if (Date.now() > Number(p[2])) return null; return { username: p[0], role: p[1] }; }
  function cookie() { var c = req.headers.cookie || ''; var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

  var body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  var action = body.action;
  try {
    if (action === 'log') {
      var type = clip(body.type || '', 40).trim();
      if (!type) return res.status(200).json({ ok: false, error: 'Missing type.' });
      var row = { type: type, username: clip(body.username || '', 80), detail: clip(body.detail || '', 400) };
      await fetch(rest + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify(row) });
      return res.status(200).json({ ok: true });
    }
    if (action === 'list') {
      var sess = verify(cookie());
      if (!sess || sess.username !== ADMIN) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var lim = Math.min(parseInt(body.limit, 10) || 80, 200);
      var ft = clip(body.type || '', 40).trim();
      var url = rest + '/activity_log?select=ts,type,username,detail&order=ts.desc&limit=' + lim;
      if (ft && ft !== 'all') url += '&type=eq.' + encodeURIComponent(ft);
      var r = await fetch(url, { headers: H });
      var a = await r.json();
      // counts for the last ~1000 events (today-ish) per type
      var cr = await fetch(rest + '/activity_log?select=type&order=ts.desc&limit=1000', { headers: H });
      var ca = await cr.json();
      var counts = {};
      if (Array.isArray(ca)) ca.forEach(function (x) { counts[x.type] = (counts[x.type] || 0) + 1; });
      return res.status(200).json({ ok: true, events: Array.isArray(a) ? a : [], counts: counts });
    }
    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) { return res.status(200).json({ ok: false, error: 'Server error.' }); }
};
