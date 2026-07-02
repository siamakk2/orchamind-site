var crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not set up.' });
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function verifyToken(tok) {
    if (!tok) return null;
    var parts = String(tok).split('|');
    if (parts.length !== 4) return null;
    if (sign(parts[0] + '|' + parts[1] + '|' + parts[2]) !== parts[3]) return null;
    if (Date.now() > Number(parts[2])) return null;
    return { username: parts[0], role: parts[1] };
  }
  function readCookie() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function genCode() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
    for (var i = 0; i < 6; i++) o += s[Math.floor(Math.random() * s.length)];
    return o;
  }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var action = body.action;

  try {
    if (action === 'create') {
      var sess = verifyToken(readCookie());
      if (!sess || sess.role === 'demo') return res.status(200).json({ ok: false, error: 'Please log in again.' });
      var jobId = String(body.jobId || '');
      if (!jobId) return res.status(200).json({ ok: false, error: 'Missing job.' });
      var email = String(body.email || '').toLowerCase().trim();

      var gr = await fetch(base + '/portal_grants?owner=eq.' + encodeURIComponent(sess.username) + '&job_id=eq.' + encodeURIComponent(jobId) + '&select=code,email', { headers: H });
      var ga = await gr.json();
      if (Array.isArray(ga) && ga[0] && ga[0].code) {
        var ecode = ga[0].code;
        if (email && email !== (ga[0].email || '')) {
          await fetch(base + '/portal_grants?code=eq.' + encodeURIComponent(ecode), { method: 'PATCH', headers: H, body: JSON.stringify({ email: email }) });
        }
        return res.status(200).json({ ok: true, code: ecode, url: 'https://orchamind.com/portal' });
      }

      var code = genCode();
      var ins = await fetch(base + '/portal_grants', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ code: code, owner: sess.username, job_id: jobId, email: email }) });
      if (!ins.ok) {
        code = genCode();
        ins = await fetch(base + '/portal_grants', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ code: code, owner: sess.username, job_id: jobId, email: email }) });
        if (!ins.ok) {
          var et = await ins.text();
          var hint = /relation|portal_grants|does not exist/i.test(et) ? ' The portal_grants table may not exist yet.' : '';
          return res.status(200).json({ ok: false, error: 'Could not create access.' + hint });
        }
      }
      return res.status(200).json({ ok: true, code: code, url: 'https://orchamind.com/portal' });
    }

    if (action === 'view') {
      var vcode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      var vemail = String(body.email || '').toLowerCase().trim();
      if (!vcode) return res.status(200).json({ ok: false, error: 'Enter your access code.' });
      var r = await fetch(base + '/portal_grants?code=eq.' + encodeURIComponent(vcode) + '&select=owner,job_id,email', { headers: H });
      var a = await r.json();
      var g = (Array.isArray(a) && a[0]) ? a[0] : null;
      if (!g) return res.status(200).json({ ok: false, error: 'That access code was not found.' });
      if (g.email && g.email !== vemail) return res.status(200).json({ ok: false, error: 'That email does not match this code.' });

      var dr = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(g.owner) + '&select=data', { headers: H });
      var da = await dr.json();
      var data = (Array.isArray(da) && da[0] && da[0].data) ? da[0].data : null;
      if (!data) return res.status(200).json({ ok: false, error: 'Project not available yet.' });
      var jobs = Array.isArray(data.jobs) ? data.jobs : [];
      var job = null;
      for (var i = 0; i < jobs.length; i++) { if (jobs[i].id === g.job_id) { job = jobs[i]; break; } }
      if (!job) return res.status(200).json({ ok: false, error: 'Project not found.' });
      var logs = Array.isArray(data.logs) ? data.logs : [];
      var updates = logs.filter(function (L) { return L.jobId === g.job_id || L.job === job.name; })
        .map(function (L) { return { date: L.date, note: L.note, photos: (L.photos || []).map(function (p) { return { url: p.url }; }) }; });

      var company = '';
      try {
        var cr = await fetch(base + '/accounts?username=eq.' + encodeURIComponent(g.owner) + '&select=company,name', { headers: H });
        var ca = await cr.json();
        if (Array.isArray(ca) && ca[0]) company = ca[0].company || ca[0].name || '';
      } catch (e) {}

      return res.status(200).json({ ok: true, project: { name: job.name, status: job.status, progress: job.progress || 0, location: job.location || '', date: job.date || '', client: job.client || '', company: company, updates: updates } });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
