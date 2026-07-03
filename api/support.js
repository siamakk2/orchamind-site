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
    if (action === 'create') {
      var sess = verify(cookie());
      if (!sess) return res.status(200).json({ ok: false, error: 'Please log in again to contact support.' });
      var msg = clip(body.message || '', 2000).trim();
      if (!msg) return res.status(200).json({ ok: false, error: 'Please enter a message.' });
      var company = clip(body.company || '', 120);
      var row = { username: sess.username, company: company, message: msg, status: 'open' };
      var r = await fetch(rest + '/support_tickets', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify(row) });
      if (!r.ok) { var t = await r.text(); return res.status(200).json({ ok: false, error: 'Could not send. ' + t.slice(0, 120) }); }
      try { await fetch(rest + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ type: 'support', username: sess.username, detail: (company || sess.username) + ': ' + msg.slice(0, 90) }) }); } catch (e) {}
      return res.status(200).json({ ok: true });
    }
    if (action === 'list') {
      var s2 = verify(cookie());
      if (!s2 || s2.username !== ADMIN) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var lr = await fetch(rest + '/support_tickets?select=id,ts,username,company,message,status,reply&order=ts.desc&limit=100', { headers: H });
      var la = await lr.json();
      var open = Array.isArray(la) ? la.filter(function (x) { return x.status !== 'resolved'; }).length : 0;
      return res.status(200).json({ ok: true, tickets: Array.isArray(la) ? la : [], open: open });
    }
    if (action === 'resolve') {
      var s3 = verify(cookie());
      if (!s3 || s3.username !== ADMIN) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var id = clip(body.id || '', 60);
      if (!id) return res.status(200).json({ ok: false, error: 'Missing ticket.' });
      var newStatus = (body.status === 'open') ? 'open' : 'resolved';
      var patch = { status: newStatus };
      if (typeof body.reply === 'string') patch.reply = clip(body.reply, 2000);
      var pr = await fetch(rest + '/support_tickets?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify(patch) });
      if (!pr.ok) { var pt = await pr.text(); return res.status(200).json({ ok: false, error: 'Could not update. ' + pt.slice(0, 120) }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) { return res.status(200).json({ ok: false, error: 'Server error.' }); }
};
