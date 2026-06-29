var crypto = require('crypto');

function readBody(req) {
  var b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) {
    return res.status(200).json({ ok: false, error: 'Server not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' });
  }
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function hashPw(pw) {
    var salt = crypto.randomBytes(16).toString('hex');
    var h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
    return salt + ':' + h;
  }
  function verifyPw(pw, stored) {
    try {
      var p = String(stored).split(':'); var salt = p[0], h = p[1];
      var c = crypto.scryptSync(String(pw), salt, 32).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(c, 'hex'));
    } catch (e) { return false; }
  }
  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function makeToken(username, role) {
    var exp = Date.now() + 30 * 24 * 3600 * 1000;
    var p = username + '|' + role + '|' + exp;
    return p + '|' + sign(p);
  }
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
  function setSess(username, role) {
    var tok = makeToken(username, role);
    res.setHeader('Set-Cookie', 'orcha_sess=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30 * 24 * 3600));
  }
  async function sbFetch(url, opts) { return fetch(url, opts); }
  async function getUser(username) {
    var r = await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(username) + '&select=*', { headers: H });
    var a = await r.json();
    return (Array.isArray(a) && a[0]) ? a[0] : null;
  }
  async function countUsers() {
    var r = await sbFetch(base + '/accounts?select=username', { headers: H });
    var a = await r.json();
    return Array.isArray(a) ? a.length : 0;
  }

  var body = readBody(req);
  var action = body.action;

  try {
    if (action === 'status') {
      var n = await countUsers();
      return res.status(200).json({ ok: true, hasUsers: n > 0 });
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', 'orcha_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return res.status(200).json({ ok: true });
    }

    if (action === 'seedOwner') {
      var n2 = await countUsers();
      if (n2 > 0) return res.status(200).json({ ok: false, error: 'Setup is already done — please log in.' });
      var u = (body.username || '').toLowerCase().trim();
      var name = body.name || '';
      var pass = body.password || '';
      if (!u || String(pass).length < 6) return res.status(200).json({ ok: false, error: 'Pick a username and a password (6+ characters).' });
      var ins = await sbFetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: u, name: name, role: 'owner', pass: hashPw(pass), must_change: false }) });
      if (!ins.ok) { var e1 = await ins.text(); return res.status(200).json({ ok: false, error: 'Could not create owner. ' + e1.slice(0, 140) }); }
      setSess(u, 'owner');
      return res.status(200).json({ ok: true, user: { username: u, name: name, role: 'owner' } });
    }

    if (action === 'login') {
      var lu = (body.username || '').toLowerCase().trim();
      var lp = body.password || '';
      var row = await getUser(lu);
      if (!row || !verifyPw(lp, row.pass)) return res.status(200).json({ ok: false, error: 'Wrong username or password.' });
      setSess(lu, row.role || 'member');
      return res.status(200).json({ ok: true, user: { username: row.username, name: row.name, role: row.role || 'member', mustChange: !!row.must_change } });
    }

    if (action === 'changePassword') {
      var sessC = verifyToken(readCookie());
      var cu = (body.username || '').toLowerCase().trim();
      if (!sessC || (sessC.username !== cu && sessC.role !== 'owner')) return res.status(200).json({ ok: false, error: 'Please log in again.' });
      var urow = await getUser(cu);
      if (!urow) return res.status(200).json({ ok: false, error: 'No such user.' });
      if (!urow.must_change) {
        if (!verifyPw(body.oldPassword || '', urow.pass)) return res.status(200).json({ ok: false, error: 'Current password is wrong.' });
      }
      var np = body.newPassword || '';
      if (String(np).length < 6) return res.status(200).json({ ok: false, error: 'New password must be 6+ characters.' });
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(cu), { method: 'PATCH', headers: H, body: JSON.stringify({ pass: hashPw(np), must_change: false }) });
      setSess(cu, urow.role || 'member');
      return res.status(200).json({ ok: true });
    }

    // ---- owner-only actions: role is verified from the signed cookie, NOT from the client ----
    var sess = verifyToken(readCookie());
    var isOwner = !!(sess && sess.role === 'owner');

    if (action === 'list') {
      if (!isOwner) return res.status(200).json({ ok: false, error: 'Owner only.' });
      var r3 = await sbFetch(base + '/accounts?select=username,name,role&order=created_at.asc', { headers: H });
      var a3 = await r3.json();
      return res.status(200).json({ ok: true, users: Array.isArray(a3) ? a3 : [] });
    }

    if (action === 'add') {
      if (!isOwner) return res.status(200).json({ ok: false, error: 'Owner only.' });
      var au = (body.username || '').toLowerCase().trim();
      var an = body.name || '';
      var ar = body.role || 'member';
      var ap = body.password || '';
      if (!au || String(ap).length < 6) return res.status(200).json({ ok: false, error: 'Username and a 6+ character temporary password are required.' });
      var ex = await getUser(au);
      if (ex) return res.status(200).json({ ok: false, error: 'That username already exists.' });
      var ins2 = await sbFetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: au, name: an, role: ar, pass: hashPw(ap), must_change: true }) });
      if (!ins2.ok) { var e2 = await ins2.text(); return res.status(200).json({ ok: false, error: 'Could not add user. ' + e2.slice(0, 140) }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove') {
      if (!isOwner) return res.status(200).json({ ok: false, error: 'Owner only.' });
      var ru = (body.username || '').toLowerCase().trim();
      if (sess.username === ru) return res.status(200).json({ ok: false, error: "You can't remove your own owner account." });
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(ru), { method: 'DELETE', headers: H });
      await sbFetch(base + '/app_data?username=eq.' + encodeURIComponent(ru), { method: 'DELETE', headers: H });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setRole') {
      if (!isOwner) return res.status(200).json({ ok: false, error: 'Owner only.' });
      var su = (body.username || '').toLowerCase().trim();
      var sr = body.role || 'member';
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(su), { method: 'PATCH', headers: H, body: JSON.stringify({ role: sr }) });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
