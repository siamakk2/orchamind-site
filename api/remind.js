var crypto = require('crypto');
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var RESEND = process.env.RESEND_API_KEY;
  var rest = 'https://yqbprvyhzugdmavvurqb.supabase.co/rest/v1';
  var H = KEY ? { apikey: KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' } : null;
  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
  function esc(x) { return String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function sign(p) { return crypto.createHmac('sha256', KEY || 'x').update(p).digest('hex'); }
  function verify(tok) { if (!tok || !KEY) return null; var p = String(tok).split('|'); if (p.length !== 4) return null; if (sign(p[0] + '|' + p[1] + '|' + p[2]) !== p[3]) return null; if (Date.now() > Number(p[2])) return null; return { username: p[0], role: p[1] }; }
  function cookie() { var c = req.headers.cookie || ''; var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

  var sess = verify(cookie());
  if (!sess) return res.status(200).json({ ok: false, error: 'Please log in again.' });
  if (!RESEND) return res.status(200).json({ ok: false, error: 'Email is not set up yet (RESEND_API_KEY missing).' });

  var body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  var to = clip(body.to || '', 140).trim();
  var company = clip(body.company || '', 120).trim() || 'Your contractor';
  var clientName = clip(body.clientName || '', 120).trim();
  var kind = (body.kind === 'appt') ? 'appt' : 'otw';
  var when = clip(body.when || '', 80).trim();
  var phone = clip(body.contractorPhone || '', 40).trim();
  var replyTo = clip(body.contractorEmail || '', 140).trim() || 'siamakk2@gmail.com';
  if (!to || to.indexOf('@') < 0) return res.status(200).json({ ok: false, error: 'This customer has no email on file.' });

  var greeting = clientName ? ('Hi ' + esc(clientName) + ',') : 'Hi there,';
  var headline, msg;
  if (kind === 'otw') { headline = 'We\u2019re on the way! \uD83D\uDE90'; msg = '<b style="color:#0A1628;">' + esc(company) + '</b> is heading to you now and will arrive shortly.'; }
  else { headline = 'Appointment reminder \uD83D\uDCC5'; msg = 'This is a friendly reminder that <b style="color:#0A1628;">' + esc(company) + '</b> is scheduled to visit' + (when ? (' on <b style="color:#0A1628;">' + esc(when) + '</b>') : ' soon') + '. We look forward to seeing you!'; }
  var callLine = phone ? ('<p style="font-size:13px;color:#8090A0;margin:14px 0 0;">Questions? Call us at <b>' + esc(phone) + '</b>.</p>') : '';

  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0A1628;">'
    + '<div style="background:#0A1628;padding:22px;border-radius:12px 12px 0 0;text-align:center;"><span style="color:#F9A825;font-size:20px;font-weight:bold;">' + esc(company) + '</span></div>'
    + '<div style="background:#ffffff;border:1px solid #E1E8F0;border-top:none;padding:28px;border-radius:0 0 12px 12px;">'
    + '<h1 style="font-size:21px;margin:0 0 12px;color:#0A1628;">' + headline + '</h1>'
    + '<p style="font-size:15px;line-height:1.6;color:#0A1628;margin:0 0 6px;">' + greeting + '</p>'
    + '<p style="font-size:15px;line-height:1.6;color:#5A6B7D;margin:0;">' + msg + '</p>'
    + callLine + '</div></div>';

  try {
    var subject = (kind === 'otw') ? (company + ' is on the way') : ('Reminder: your appointment with ' + company);
    var r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: esc(company) + ' <welcome@orchamind.com>', to: [to], reply_to: replyTo, subject: subject, html: html }) });
    if (!r.ok) { var t = await r.text(); return res.status(200).json({ ok: false, error: 'Could not send: ' + t.slice(0, 160) }); }
    if (H) { try { await fetch(rest + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }), body: JSON.stringify({ type: 'reminder', username: sess.username, detail: company + (kind === 'otw' ? ' sent an on-my-way to ' : ' sent an appointment reminder to ') + (clientName || to) }) }); } catch (e) {} }
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(200).json({ ok: false, error: 'Server error sending the email.' }); }
};
