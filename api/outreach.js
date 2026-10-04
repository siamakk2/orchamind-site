// Trial check-in emails: the daily automation and the admin panel behind it.
//
//   GET  ?key=OUTREACH_CRON_KEY&run=1   daily run (Supabase pg_cron), sends what is due
//   GET  ?key=OUTREACH_CRON_KEY&dry=1   same, but only reports who would get what
//   GET  ?unsub=<username>&s=<sig>      one-click "stop these emails" from the footer
//   POST {action:'queue'}               admin: every account, what is due, history
//   POST {action:'preview',username,kind}
//   POST {action:'send',username,kind}  admin: send now (also logged, so the
//                                       automation will not repeat it)
//   POST {action:'optout',username,value}
//
// Who gets what, and the wording, live in lib/outreach.js (unit tested).

var crypto = require('crypto');
var o = require('../lib/outreach.js');

var FROM = 'Siamak at Orchamind <info@orchamind.com>';
var REPLY_TO = 'siamakk2@gmail.com';
var COPY_TO = 'siamakk2@gmail.com';   // Siamak sees every note that goes out
var ADMIN = 'siamakk2';
var REST = 'https://yqbprvyhzugdmavvurqb.supabase.co/rest/v1';
var KINDS = ['welcome', 'checkin', 'ending', 'winback'];

module.exports = async function handler(req, res) {
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var RESEND = process.env.RESEND_API_KEY;
  var CRON = process.env.OUTREACH_CRON_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Supabase key missing in Vercel env' });
  var H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function unsubSig(u) { return sign('outreach-unsub|' + u).slice(0, 32); }
  function unsubUrl(u) { return 'https://orchamind.com/api/outreach?unsub=' + encodeURIComponent(u) + '&s=' + unsubSig(u); }
  function session() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    if (!m) return null;
    var p = decodeURIComponent(m[1]).split('|');
    if (p.length !== 4 || sign(p[0] + '|' + p[1] + '|' + p[2]) !== p[3] || Date.now() > Number(p[2])) return null;
    return { username: p[0], role: p[1] };
  }
  async function get(path) { var r = await fetch(REST + path, { headers: H }); var j = await r.json(); return Array.isArray(j) ? j : []; }

  async function loadAll(only) {
    var filt = only ? '&username=eq.' + encodeURIComponent(only) : '';
    var accts = await get('/accounts?select=username,name,company,created_at,trial_end,stripe_status,status,no_outreach,profile' + filt + '&order=trial_end.desc.nullslast');
    accts = accts.filter(function (a) { return a.username !== ADMIN; });
    var names = accts.map(function (a) { return '"' + String(a.username).replace(/"/g, '') + '"'; }).join(',');
    if (!names) return [];
    var inList = 'in.(' + encodeURIComponent(names) + ')';
    var logs = await get('/outreach_log?select=username,kind,trial_end,status,sent_at,subject,error,sent_by&username=' + inList + '&order=created_at.desc');
    var data = await get('/app_data?select=username,estimates:data->estimates,jobs:data->jobs,clients:data->clients,invoices:data->invoices&username=' + inList);
    var ev = await get('/activity_log?select=username,type&type=like.plan_read*&username=' + inList + '&limit=2000');
    return accts.map(function (a) {
      var d = data.find(function (x) { return x.username === a.username; }) || {};
      var mine = logs.filter(function (l) { return l.username === a.username; });
      return { acct: a, log: mine, usage: o.usage(d, ev.filter(function (e) { return e.username === a.username; })) };
    });
  }

  function letter(row, kind) {
    var a = row.acct;
    return o.compose(kind, { name: a.name, company: a.company, trial_end: a.trial_end, usage: row.usage, unsubUrl: unsubUrl(a.username) });
  }

  async function send(row, kind, by) {
    var a = row.acct;
    var email = String((a.profile && a.profile.email) || '').trim();
    var m = letter(row, kind);
    var status = 'error', err = null, at = null;
    if (!RESEND) err = 'RESEND_API_KEY missing in Vercel env';
    else if (!email) err = 'no email on file';
    else {
      var r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [email], bcc: [COPY_TO], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text,
          headers: { 'List-Unsubscribe': '<' + unsubUrl(a.username) + '>' } })
      });
      if (r.ok) { status = 'sent'; at = new Date().toISOString(); }
      else err = (await r.text()).slice(0, 300);
    }
    await fetch(REST + '/outreach_log?on_conflict=username,kind,trial_end', {
      method: 'POST', headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ username: a.username, kind: kind, trial_end: a.trial_end, email: email, subject: m.subject, status: status, error: err, sent_by: by, sent_at: at })
    });
    // Show up in the admin Activity feed too.
    try {
      await fetch(REST + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ type: 'outreach', username: a.username, detail: (status === 'sent' ? 'emailed: ' : 'email FAILED: ') + o.KIND_LABEL[kind] + (by === 'auto' ? ' (automatic)' : ' (sent by admin)') }) });
    } catch (e) {}
    return { username: a.username, kind: kind, status: status, error: err };
  }

  try {
    var q = req.query || {};

    // One-click unsubscribe from the email footer.
    if (req.method === 'GET' && q.unsub) {
      var u = String(q.unsub);
      var okSig = String(q.s || '') === unsubSig(u);
      if (okSig) {
        await fetch(REST + '/accounts?username=eq.' + encodeURIComponent(u), { method: 'PATCH', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ no_outreach: true }) });
        try { await fetch(REST + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ type: 'outreach', username: u, detail: 'unsubscribed from check-in emails' }) }); } catch (e) {}
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(okSig ? 200 : 400).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orchamind</title>'
        + '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:460px;margin:15vh auto;padding:0 16px;color:#0A1628;text-align:center;">'
        + (okSig ? '<h2>You will not get these check-ins again.</h2><p style="color:#5A6B7D;">Sorry for the bother. If you ever need anything, just email <a href="mailto:siamakk2@gmail.com">siamakk2@gmail.com</a>.</p>'
                 : '<h2>That link did not work.</h2><p style="color:#5A6B7D;">Reply to the email and we will take you off the list by hand.</p>')
        + '</div>');
    }

    // Daily automation.
    if (req.method === 'GET') {
      if (!CRON || String(q.key || '') !== CRON) return res.status(401).json({ ok: false, error: 'bad key' });
      // Proof copy: the exact letter a customer would get, sent only to test_to,
      // with nothing logged. ?test_to=EMAIL&username=U&kind=K
      if (q.test_to) {
        var tr = (await loadAll(String(q.username || '')))[0];
        if (!tr) return res.status(200).json({ ok: false, error: 'No such account.' });
        var tk = KINDS.indexOf(q.kind) > -1 ? q.kind : o.suggest(tr.acct);
        var tm = letter(tr, tk);
        var tres = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [String(q.test_to)], reply_to: REPLY_TO, subject: '[PROOF for ' + (tr.acct.company || tr.acct.username) + '] ' + tm.subject, html: tm.html, text: tm.text }) });
        return res.status(200).json({ ok: tres.ok, kind: tk, subject: tm.subject, detail: tres.ok ? undefined : (await tres.text()).slice(0, 200) });
      }
      var rows = await loadAll();
      var now = Date.now(), out = [];
      for (var i = 0; i < rows.length; i++) {
        var kind = o.due(rows[i].acct, rows[i].log, now);
        if (!kind) continue;
        if (q.run === '1' && !q.dry) out.push(await send(rows[i], kind, 'auto'));
        else out.push({ username: rows[i].acct.username, kind: kind, status: 'would send' });
      }
      return res.status(200).json({ ok: true, checked: rows.length, results: out, resend: !!RESEND });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    var s = session();
    if (!s || s.username !== ADMIN) return res.status(200).json({ ok: false, error: 'Admin only.' });
    var body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
    var action = body.action;

    if (action === 'queue') {
      var all = await loadAll(), t = Date.now();
      return res.status(200).json({ ok: true, resend: !!RESEND, labels: o.KIND_LABEL, rows: all.map(function (r) {
        var a = r.acct;
        return { username: a.username, name: a.name, company: a.company, email: (a.profile && a.profile.email) || '', trial_end: a.trial_end,
          stripe_status: a.stripe_status, no_outreach: !!a.no_outreach, usage: r.usage,
          due: o.due(a, r.log, t), suggest: o.suggest(a, t),
          log: r.log.slice(0, 8) };
      }) });
    }

    var user = String(body.username || '');
    var k = KINDS.indexOf(body.kind) > -1 ? body.kind : null;

    if (action === 'optout') {
      await fetch(REST + '/accounts?username=eq.' + encodeURIComponent(user), { method: 'PATCH', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ no_outreach: !!body.value }) });
      return res.status(200).json({ ok: true });
    }
    if (action === 'preview' || action === 'send') {
      var one = (await loadAll(user))[0];
      if (!one) return res.status(200).json({ ok: false, error: 'No such account.' });
      k = k || o.suggest(one.acct);
      if (action === 'preview') { var m = letter(one, k); return res.status(200).json({ ok: true, kind: k, to: (one.acct.profile && one.acct.profile.email) || '', subject: m.subject, html: m.html }); }
      if (one.acct.no_outreach) return res.status(200).json({ ok: false, error: 'This account is set to "no emails". Turn that off first.' });
      var r1 = await send(one, k, ADMIN);
      return res.status(200).json({ ok: r1.status === 'sent', result: r1, error: r1.error });
    }
    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e).slice(0, 200) });
  }
};
