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

      // Support view: the operator may READ another account's workspace to help
      // them. Authorisation comes from the signed session cookie, never from a
      // client-supplied flag, and this path can only ever read.
      var asUser = (req.query && (req.query.as || req.query.support_view)) || null;
      if (asUser) {
        if (sess.username !== 'siamakk2') {
          return res.status(403).json({ ok: false, error: 'Not authorised to view other accounts.' });
        }
        var target = String(asUser).toLowerCase().trim();
        var sr = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(target) + '&select=data', { headers: H });
        var sa = await sr.json();
        var srow = (Array.isArray(sa) && sa[0]) ? sa[0] : null;
        return res.status(200).json({ ok: true, data: srow ? srow.data : null, supportView: true, account: target });
      }

      var r = await fetch(base + '/app_data?username=eq.' + encodeURIComponent(sess.username) + '&select=data', { headers: H });
      var a = await r.json();
      var row = (Array.isArray(a) && a[0]) ? a[0] : null;
      return res.status(200).json({ ok: true, data: row ? row.data : null });
    }

    // ---- spam screening for the two public, unauthenticated forms ----------
    function _clientIp() {
      var h = req.headers || {};
      var f = (h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
      return f || (req.socket && req.socket.remoteAddress) || '';
    }
    function _ipHash() {
      var ip = _clientIp();
      if (!ip) return null;
      try { return crypto.createHmac('sha256', KEY).update('ip:' + ip).digest('hex').slice(0, 32); }
      catch (e) { return null; }
    }
    // Returns a score. 0 = clean. >=5 is stored but never emailed.
    function _spamCheck(b, text) {
      var reasons = [], score = 0;
      // 1. Honeypot - a hidden field only a bot fills in.
      if (String(b.hp || '').trim()) { score += 10; reasons.push('honeypot'); }
      // 2. Humans do not complete a form in under three seconds.
      var el = Number(b.elapsed || 0);
      if (el > 0 && el < 3000) { score += 5; reasons.push('submitted in ' + el + 'ms'); }
      var blob = String(text || '').toLowerCase();
      // 3. Link farming - the single strongest signal on a contact form.
      var links = (blob.match(/https?:\/\/|www\.|\[url|<a\s/g) || []).length;
      if (links >= 3) { score += 6; reasons.push(links + ' links'); }
      else if (links === 2) { score += 3; reasons.push('2 links'); }
      // 4. SEO/crypto/pharma boilerplate.
      var bait = ['seo service','backlink','guest post','crypto','bitcoin','forex','casino',
                  'viagra','cialis','loan offer','work from home','click here now','buy followers',
                  'rank #1','increase your traffic','web design service','make money online'];
      for (var i = 0; i < bait.length; i++) {
        if (blob.indexOf(bait[i]) !== -1) { score += 5; reasons.push('phrase: ' + bait[i]); break; }
      }
      // 5. Cyrillic or CJK in a US contractor enquiry.
      // Soft signal only. A Chinese- or Russian-speaking contractor writing in
      // their own language is a real customer; this must never block on its own,
      // only tip an already-suspicious message over the line.
      if (/[\u0400-\u04FF\u4E00-\u9FFF]/.test(String(text || ''))) { score += 4; reasons.push('non-latin script'); }
      // 6. Throwaway mailboxes.
      var em = String(b.email || '').toLowerCase();
      var burner = ['mailinator.com','guerrillamail','10minutemail','tempmail','yopmail','trashmail','sharklasers'];
      for (var j = 0; j < burner.length; j++) {
        if (em.indexOf(burner[j]) !== -1) { score += 5; reasons.push('disposable email'); break; }
      }
      // 7. A name that is a URL.
      if (/https?:|www\./i.test(String(b.name || ''))) { score += 5; reasons.push('url in name'); }
      return { score: score, reasons: reasons.join('; ') };
    }
    // Too many submissions from one address in an hour.
    async function _ipFlood(table, hash) {
      if (!hash) return 0;
      try {
        var since = new Date(Date.now() - 3600000).toISOString();
        var r = await fetch(base + '/' + table + '?ip_hash=eq.' + encodeURIComponent(hash) +
          '&created_at=gte.' + encodeURIComponent(since) + '&select=id', { headers: H });
        var a = await r.json();
        return Array.isArray(a) ? a.length : 0;
      } catch (e) { return 0; }
    }

    if (req.method === 'POST') {
      var body = readBody(req);
      // Public customer booking request from /book — no session required.
      if (body && body.booking) {
        if (!SUPABASE_URL || !KEY) return res.status(200).json({ ok: true, queued: false });
        try {
          var bk = body.booking;
          var bHash = _ipHash();
          var bChk = _spamCheck(bk, [bk.name, bk.email, bk.notes].join(' '));
          var bFlood = await _ipFlood('bookings', bHash);
          if (bFlood >= 5) { bChk.score += 6; bChk.reasons = (bChk.reasons ? bChk.reasons + '; ' : '') + bFlood + ' in the last hour'; }
          if (bFlood >= 12) return res.status(200).json({ ok: true, queued: true });
          var bSpam = bChk.score >= 5;
          var row = {
            ip_hash: bHash, spam_score: bChk.score, spam_reasons: bChk.reasons || null,
            account: (bk.account || null), name: (bk.name||'').slice(0,120), phone: (bk.phone||'').slice(0,40),
            email: (bk.email||'').slice(0,120), service: (bk.service||'').slice(0,120), date: bk.date||null,
            slot: (bk.slot||'').slice(0,40), notes: (bk.notes||'').slice(0,1000),
            status: bSpam ? 'spam' : 'requested', source: 'public_book_page', created_at: new Date().toISOString()
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
            if (RESEND && !bSpam) {
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
                reply_to: row.email || 'siamakk2@gmail.com',
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
      // Public contact-form message from /contact — no session required.
      if (body && body.contact) {
        try {
          var cm = body.contact;
          if (!String(cm.name || '').trim()) return res.status(200).json({ ok: false, queued: false, error: 'name required' });
          var cHash = _ipHash();
          var cChk = _spamCheck(cm, [cm.name, cm.company, cm.email, cm.message].join(' '));
          var cFlood = await _ipFlood('contact_messages', cHash);
          if (cFlood >= 5) { cChk.score += 6; cChk.reasons = (cChk.reasons ? cChk.reasons + '; ' : '') + cFlood + ' in the last hour'; }
          // Hard stop: a flooding address gets a success response and nothing is
          // written, so a bot learns nothing from the difference.
          if (cFlood >= 12) return res.status(200).json({ ok: true, queued: true });
          var cSpam = cChk.score >= 5;
          var crow = {
            name: (cm.name||'').slice(0,120), email: (cm.email||'').slice(0,140), phone: (cm.phone||'').slice(0,40),
            company: (cm.company||'').slice(0,140), topic: (cm.topic||'').slice(0,80),
            message: (cm.message||'').slice(0,4000), source: 'contact_page',
            page: (cm.page||'').slice(0,200), status: cSpam ? 'spam' : 'new',
            ip_hash: cHash, spam_score: cChk.score, spam_reasons: cChk.reasons || null,
            created_at: new Date().toISOString()
          };
          var cins = await fetch(base + '/contact_messages', {
            method: 'POST',
            headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }),
            body: JSON.stringify(crow)
          });
          if (!cins.ok) {
            var cerr = await cins.text();
            return res.status(200).json({ ok: false, queued: false, error: cerr.slice(0, 200) });
          }
          var cnotified = false;
          try {
            var CRESEND = process.env.RESEND_API_KEY;
            // Spam is kept for review but never emailed - the inbox stays trustworthy.
            if (CRESEND && !cSpam) {
              var ce = function (x) { return String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
              var cline = function (k, v) { return v ? ('<tr><td style="padding:6px 12px 6px 0;color:#5A6B7D;white-space:nowrap;">' + ce(k) + '</td><td style="padding:6px 0;font-weight:600;">' + ce(v) + '</td></tr>') : ''; };
              var chtml = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#0A1628;">'
                + '<h2 style="margin:0 0 4px;">New message from the website</h2>'
                + '<p style="margin:0 0 14px;color:#5A6B7D;font-size:14px;">Sent from the Contact page.</p>'
                + '<table style="font-size:14px;border-collapse:collapse;">'
                + cline('Name', crow.name) + cline('Company', crow.company) + cline('Email', crow.email)
                + cline('Phone', crow.phone) + cline('Topic', crow.topic)
                + '</table>'
                + (crow.message ? ('<div style="margin-top:14px;padding:14px;background:#F4F6F9;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.55;">' + ce(crow.message) + '</div>') : '')
                + (crow.phone ? '<p style="margin-top:16px;"><a href="tel:' + ce(crow.phone) + '" style="background:#1565C0;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Call ' + ce(crow.name) + '</a></p>' : '')
                + '</div>';
              var cbcc = (process.env.SALES_BCC || '').trim();
              var cmail = {
                from: 'Orchamind <info@orchamind.com>',
                to: [process.env.CONTACT_TO || process.env.BOOKINGS_TO || 'siamakk2@gmail.com'],
                reply_to: crow.email || 'siamakk2@gmail.com',
                subject: 'Website message - ' + (crow.name || 'unknown') + (crow.company ? (' (' + crow.company + ')') : ''),
                html: chtml
              };
              if (cbcc) cmail.bcc = cbcc.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
              var cmr = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + CRESEND, 'Content-Type': 'application/json' },
                body: JSON.stringify(cmail)
              });
              cnotified = cmr.ok;
            }
          } catch (ce2) {}
          return res.status(200).json({ ok: true, queued: true, notified: cnotified });
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
