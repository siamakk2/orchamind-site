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

      var allCos = Array.isArray(data.changeOrders) ? data.changeOrders : [];
      var cos = allCos.filter(function (c) { return (c.jobId === g.job_id || c.jobName === job.name) && (c.status === 'sent' || c.status === 'approved' || c.status === 'declined'); })
        .map(function (c) {
          var tot = 0; (c.items || []).forEach(function (it) { tot += (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0); });
          return { id: c.id, number: c.number, title: c.title, desc: c.desc, status: c.status, approvedBy: c.approvedBy || '', total: tot, items: (c.items || []).map(function (it) { return { desc: it.desc, qty: it.qty, price: it.price }; }) };
        });

      var company = '';
      try {
        var cr = await fetch(base + '/accounts?username=eq.' + encodeURIComponent(g.owner) + '&select=company,name', { headers: H });
        var ca = await cr.json();
        if (Array.isArray(ca) && ca[0]) company = ca[0].company || ca[0].name || '';
      } catch (e) {}

      return res.status(200).json({ ok: true, project: { name: job.name, status: job.status, progress: job.progress || 0, location: job.location || '', date: job.date || '', client: job.client || '', company: company, updates: updates, changeOrders: cos } });
    }

    if (action === 'co') {
      var ccode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      var cemail = String(body.email || '').toLowerCase().trim();
      var coId = String(body.coId || '');
      var decision = (body.decision === 'approved') ? 'approved' : (body.decision === 'declined' ? 'declined' : '');
      var signer = String(body.name || '').trim().slice(0, 80);
      if (!ccode || !coId || !decision) return res.status(200).json({ ok: false, error: 'Missing information.' });
      var gr = await fetch(base + '/portal_grants?code=eq.' + encodeURIComponent(ccode) + '&select=owner,job_id,email', { headers: H });
      var ga = await gr.json();
      var g2 = (Array.isArray(ga) && ga[0]) ? ga[0] : null;
      if (!g2) return res.status(200).json({ ok: false, error: 'Access code not found.' });
      if (g2.email && g2.email !== cemail) return res.status(200).json({ ok: false, error: 'That email does not match this code.' });
      var dr2 = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(g2.owner) + '&select=data', { headers: H });
      var da2 = await dr2.json();
      var data2 = (Array.isArray(da2) && da2[0] && da2[0].data) ? da2[0].data : null;
      if (!data2 || !Array.isArray(data2.changeOrders)) return res.status(200).json({ ok: false, error: 'Change order not found.' });
      var jobName2 = '';
      var jobs2 = Array.isArray(data2.jobs) ? data2.jobs : [];
      for (var k = 0; k < jobs2.length; k++) { if (jobs2[k].id === g2.job_id) { jobName2 = jobs2[k].name; break; } }
      var found = null;
      for (var jj = 0; jj < data2.changeOrders.length; jj++) { var cc = data2.changeOrders[jj]; if (cc.id === coId && (cc.jobId === g2.job_id || cc.jobName === jobName2)) { found = cc; break; } }
      if (!found) return res.status(200).json({ ok: false, error: 'Change order not found.' });
      if (found.status === 'approved') return res.status(200).json({ ok: false, error: 'This change order was already approved.' });
      found.status = decision; found.approvedBy = signer || 'Client'; found.approvedAt = new Date().toISOString();
      var upd = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(g2.owner), { method: 'PATCH', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ data: data2 }) });
      if (!upd.ok) return res.status(200).json({ ok: false, error: 'Could not save your decision. Please try again.' });
      return res.status(200).json({ ok: true, status: decision });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
