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

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) {
    return res.status(200).json({ ok: false, error: 'Server not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' });
  }
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  var STRIPE = process.env.STRIPE_SECRET_KEY;
  var STRIPE_TEST = process.env.STRIPE_SECRET_KEY_TEST;
  async function stripePortal(cust, ret) {
    if (!cust) return '';
    var keys = [STRIPE, STRIPE_TEST];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]; if (!k) continue;
      try {
        var r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'customer=' + encodeURIComponent(cust) + '&return_url=' + encodeURIComponent(ret) });
        var d = await r.json();
        if (r.ok && d && d.url) return d.url;
      } catch (e) {}
    }
    return '';
  }

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
      var ins = await sbFetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: u, name: name, role: 'owner', owner: u, company: (body.company||''), pass: hashPw(pass), must_change: false }) });
      if (!ins.ok) { var e1 = await ins.text(); return res.status(200).json({ ok: false, error: 'Could not create owner. ' + e1.slice(0, 140) }); }
      setSess(u, 'owner');
      return res.status(200).json({ ok: true, user: { username: u, name: name, role: 'owner' } });
    }

    if (action === 'requestReset') {
      var ru = (body.username || '').toLowerCase().trim();
      if (ru) { try { await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(ru), { method: 'PATCH', headers: H, body: JSON.stringify({ reset_requested: true }) }); } catch (e) {} }
      return res.status(200).json({ ok: true });
    }

    if (action === 'login') {
      var lu = (body.username || '').toLowerCase().trim();
      var lp = body.password || '';
      var row = await getUser(lu);
      if (!row || !verifyPw(lp, row.pass)) return res.status(200).json({ ok: false, error: 'Wrong username or password.' });
      if (row.status === 'paused' && row.username !== 'siamakk2') { var pauUrl = await stripePortal(row.stripe_customer, 'https://orchamind.com/app'); return res.status(200).json({ ok: true, paused: true, user: { username: row.username, name: row.name, role: row.role || 'member', company: row.company || '', paused: true, portalUrl: pauUrl } }); }
      setSess(lu, row.role || 'member');
      var brandRow = row;
      if (row.owner && row.owner !== row.username) { try { var orow = await getUser(row.owner); if (orow) brandRow = orow; } catch (e) {} }
      var co = row.company || brandRow.company || '';
      try { await sbFetch(base + '/activity_log', { method: 'POST', headers: H, body: JSON.stringify({ type: 'login', username: row.username, detail: (row.company || row.name || row.username) + ' logged in' }) }); } catch (e) {}
      return res.status(200).json({ ok: true, user: { username: row.username, name: row.name, role: row.role || 'member', company: co, profile: brandRow.profile || null, mustChange: !!row.must_change, billing: !!row.stripe_customer } });
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
    var ADMIN = 'siamakk2';
    var isAdmin = !!(sess && sess.username === ADMIN);

    if (action === 'list') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var r3 = await sbFetch(base + '/accounts?select=username,name,role,company,owner,must_change,reset_requested,status,stripe_customer,created_at&order=created_at.asc', { headers: H });
      var a3 = await r3.json();
      return res.status(200).json({ ok: true, users: Array.isArray(a3) ? a3 : [] });
    }

    if (action === 'add') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var au = (body.username || '').toLowerCase().trim();
      var an = body.name || '';
      var ar = body.role || 'member';
      var ap = body.password || '';
      if (!au || String(ap).length < 6) return res.status(200).json({ ok: false, error: 'Username and a 6+ character temporary password are required.' });
      var ex = await getUser(au);
      if (ex) return res.status(200).json({ ok: false, error: 'That username already exists.' });
      var ins2 = await sbFetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: au, name: an, role: ar, owner: sess.username, pass: hashPw(ap), must_change: true }) });
      if (!ins2.ok) { var e2 = await ins2.text(); return res.status(200).json({ ok: false, error: 'Could not add user. ' + e2.slice(0, 140) }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var ru = (body.username || '').toLowerCase().trim();
      if (sess.username === ru) return res.status(200).json({ ok: false, error: "You can't remove your own admin account." });
      var trow = await getUser(ru);
      if (!trow) return res.status(200).json({ ok: false, error: 'No such account.' });
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(ru), { method: 'DELETE', headers: H });
      await sbFetch(base + '/app_data?username=eq.' + encodeURIComponent(ru), { method: 'DELETE', headers: H });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setPassword') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var pu = (body.username || '').toLowerCase().trim();
      var pp = body.password || '';
      if (!pu || String(pp).length < 6) return res.status(200).json({ ok: false, error: 'Pick a 6+ character temporary password.' });
      var prow = await getUser(pu);
      if (!prow) return res.status(200).json({ ok: false, error: 'No such account.' });
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(pu), { method: 'PATCH', headers: H, body: JSON.stringify({ pass: hashPw(pp), must_change: true, reset_requested: false }) });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setRole') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var su = (body.username || '').toLowerCase().trim();
      var sr = body.role || 'member';
      var srow = await getUser(su);
      if (!srow) return res.status(200).json({ ok: false, error: 'No such account.' });
      await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(su), { method: 'PATCH', headers: H, body: JSON.stringify({ role: sr }) });
      return res.status(200).json({ ok: true });
    }

    if (action === 'saveProfile') {
      if (!isOwner) return res.status(200).json({ ok: false, error: 'Owner only.' });
      var pf = body.profile || {};
      var clean = { logo: String(pf.logo || ''), phone: String(pf.phone || ''), email: String(pf.email || ''), address: String(pf.address || ''), license: String(pf.license || ''), website: String(pf.website || '') };
      if (clean.logo.length > 900000) return res.status(200).json({ ok: false, error: 'Logo image is too large — please use a smaller one.' });
      var patch = { profile: clean };
      var pco = (body.company || '').trim();
      if (pco) patch.company = pco;
      var pr = await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(sess.username), { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
      if (!pr.ok) { var pe = await pr.text(); return res.status(200).json({ ok: false, error: 'Could not save. ' + pe.slice(0, 140) }); }
      return res.status(200).json({ ok: true, company: pco, profile: clean });
    }

    if (action === 'createCompany') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var cc = (body.company || '').trim();
      var cu2 = (body.username || '').toLowerCase().trim();
      var cn = body.name || '';
      var cp = body.password || '';
      if (!cc || !cu2 || String(cp).length < 6) return res.status(200).json({ ok: false, error: 'Company name, owner username, and a 6+ character temporary password are required.' });
      var cex = await getUser(cu2);
      if (cex) return res.status(200).json({ ok: false, error: 'That username is already taken — pick another.' });
      var ci = await sbFetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: cu2, name: cn, role: 'owner', owner: cu2, company: cc, pass: hashPw(cp), must_change: true }) });
      if (!ci.ok) { var ce = await ci.text(); return res.status(200).json({ ok: false, error: 'Could not create company. ' + ce.slice(0, 140) }); }
      try { await sbFetch(base + '/activity_log', { method: 'POST', headers: H, body: JSON.stringify({ type: 'signup', username: cu2, detail: 'New company created: ' + cc }) }); } catch (e) {}
      var _emailed = false; var _emailErr = '';
      try {
        var RESEND = process.env.RESEND_API_KEY;
        var toEmail = String(body.email || '').trim();
        if (RESEND && toEmail) {
          var _esc = function (x) { return String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
          var whtml = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0A1628;">'
            + '<div style="background:#0A1628;padding:24px;border-radius:12px 12px 0 0;text-align:center;"><span style="color:#F9A825;font-size:22px;font-weight:bold;">Orchamind</span></div>'
            + '<div style="background:#ffffff;border:1px solid #E1E8F0;border-top:none;padding:28px;border-radius:0 0 12px 12px;">'
            + '<h1 style="font-size:20px;margin:0 0 12px;color:#0A1628;">Welcome to Orchamind, ' + _esc(cn || 'there') + '!</h1>'
            + '<p style="font-size:15px;line-height:1.6;color:#5A6B7D;margin:0 0 18px;">Your workspace for <b style="color:#0A1628;">' + _esc(cc) + '</b> is ready \u2014 manage jobs, estimates, crews and invoices just by talking to it.</p>'
            + '<div style="background:#F7FAFD;border:1px solid #E1E8F0;border-radius:10px;padding:16px 18px;margin:0 0 20px;">'
            + '<div style="font-size:13px;color:#5A6B7D;margin-bottom:10px;font-weight:700;">Your login details</div>'
            + '<div style="font-size:14px;color:#0A1628;line-height:1.9;"><b>Website:</b> orchamind.com/app<br><b>Username:</b> ' + _esc(cu2) + '<br><b>Temporary password:</b> ' + _esc(cp) + '</div></div>'
            + '<a href="https://orchamind.com/app" style="display:inline-block;background:#F9A825;color:#0A1628;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:8px;font-size:15px;">Log in &amp; get started &rarr;</a>'
            + '<p style="font-size:13px;line-height:1.6;color:#8090A0;margin:20px 0 0;">For your security you\u2019ll set your own password the first time you log in. Questions? Just reply to this email.</p>'
            + '</div></div>';
          var er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Orchamind <welcome@orchamind.com>', to: [toEmail], reply_to: 'siamakk2@gmail.com', subject: 'Welcome to Orchamind \u2014 your ' + cc + ' workspace is ready', html: whtml }) });
          _emailed = er.ok;
          if (!er.ok) { try { var _et = await er.text(); _emailErr = _et.slice(0, 200); } catch (e3) { _emailErr = 'HTTP ' + er.status; } }
        } else if (!RESEND) { _emailErr = 'RESEND_API_KEY is not set in this project'; } else if (!toEmail) { _emailErr = 'no email entered';
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, company: cc, username: cu2, emailed: _emailed, emailError: _emailErr });
    }

    if (action === 'setStatus') {
      if (!isAdmin) return res.status(200).json({ ok: false, error: 'Admin only.' });
      var su = String(body.username || '').trim().toLowerCase();
      var newStatus = (body.status === 'paused') ? 'paused' : 'active';
      if (!su) return res.status(200).json({ ok: false, error: 'Missing account.' });
      if (su === ADMIN) return res.status(200).json({ ok: false, error: "You can't pause your own admin account." });
      var sr = await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(su) + '&select=username', { headers: H });
      var sa = await sr.json();
      if (!Array.isArray(sa) || !sa[0]) return res.status(200).json({ ok: false, error: 'No such account.' });
      var pr2 = await sbFetch(base + '/accounts?username=eq.' + encodeURIComponent(su), { method: 'PATCH', headers: H, body: JSON.stringify({ status: newStatus }) });
      if (!pr2.ok) { var pe2 = await pr2.text(); return res.status(200).json({ ok: false, error: 'Could not update status. ' + pe2.slice(0,120) }); }
      return res.status(200).json({ ok: true, status: newStatus });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};

