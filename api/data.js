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
      var body = readBody(req);
      // Public customer booking request from /book — no session required.
      if (body && body.booking) {
        if (!SUPABASE_URL || !KEY) return res.status(200).json({ ok: true, queued: false });
        try {
          var bk = body.booking;
          var row = {
            account: (bk.account || null), name: (bk.name||'').slice(0,120), phone: (bk.phone||'').slice(0,40),
            email: (bk.email||'').slice(0,120), service: (bk.service||'').slice(0,120), date: bk.date||null,
            slot: (bk.slot||'').slice(0,40), notes: (bk.notes||'').slice(0,1000),
            status: 'requested', source: 'public_book_page', created_at: new Date().toISOString()
          };
          var ins = await fetch(base + '/bookings', {
            method: 'POST',
            headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }),
            body: JSON.stringify(row)
          });
          if (!ins.ok) {
            var errTxt = await ins.text();
            return res.status(200).json({ ok: false, queued: false, error: errTxt.slice(0, 200) });
          }

          // Stored is not the same as seen. Tell someone, or the lead still dies.
          var notified = false;
          try {
            var RESEND = process.env.RESEND_API_KEY;
            if (RESEND) {
              var e = function (x) { return String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
              var line = function (k, v) { return v ? ('<tr><td style="padding:6px 12px 6px 0;color:#5A6B7D;">' + e(k) + '</td><td style="padding:6px 0;font-weight:600;">' + e(v) + '</td></tr>') : ''; };
              var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#0A1628;">'
                + '<h2 style="margin:0 0 4px;">New booking request</h2>'
                + '<p style="margin:0 0 14px;color:#5A6B7D;font-size:14px;">Submitted from the public booking page.</p>'
                + '<table style="font-size:14px;border-collapse:collapse;">'
                + line('Name', row.name) + line('Phone', row.phone) + line('Email', row.email)
                + line('Service', row.service) + line('Date', row.date) + line('Time', row.slot)
                + line('Notes', row.notes)
                + '</table>'
                + (row.phone ? '<p style="margin-top:16px;"><a href="tel:' + e(row.phone) + '" style="background:#1565C0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Call ' + e(row.name) + '</a></p>' : '')
                + '</div>';
              var bccRaw = (process.env.SALES_BCC || '').trim();
              var mail = {
                from: 'Orchamind <info@orchamind.com>',
                to: [process.env.BOOKINGS_TO || 'siamakk2@gmail.com'],
                reply_to: row.email || 'info@siamakkalhor.com',
                subject: 'New booking request - ' + (row.name || 'unknown') + (row.date ? (' - ' + row.date) : ''),
                html: html
              };
              if (bccRaw) mail.bcc = bccRaw.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
              var mr = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
                body: JSON.stringify(mail)
              });
              notified = mr.ok;
            }
          } catch (e2) {}

          return res.status(200).json({ ok: true, queued: true, notified: notified });
        } catch (e) { return res.status(200).json({ ok: false, queued: false, error: String(e && e.message || e).slice(0,200) }); }
      }
      // Demo or signed-out users: accept but don't persist.
      if (!sess || sess.role === 'demo') return res.status(200).json({ ok: true, skipped: true });
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
