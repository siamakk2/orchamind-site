// Daily trial-expiry reminders. Called by Supabase pg_cron with ?key=SECRET.
// Finds accounts whose trial ends within 5 days, emails them via Resend
// (from info@orchamind.com, replies to info@siamakkalhor.com), and records
// each send in trial_reminders so nobody is ever emailed twice.
//
// Extra modes:
//   ?key=SECRET               -> config status (no sends)
//   ?key=SECRET&run=1         -> process due reminders
//   ?key=SECRET&test_to=EMAIL -> send one sample email, touch nothing else

var CRON_KEY = 'orcha_trialcron_5Hn8Kd2wQx7Vp3Mz';
var FROM = 'Siamak at Orchamind <info@orchamind.com>';
var REPLY_TO = 'info@siamakkalhor.com';

function esc(x) { return String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function emailHtml(name, company, dateStr) {
  return '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#0A1628;line-height:1.6;max-width:560px;">' +
    '<p>Hi ' + esc(name || 'there') + ',</p>' +
    '<p>Just a heads-up: your Orchamind free trial for <strong>' + esc(company || 'your business') + '</strong> ends on <strong>' + esc(dateStr) + '</strong> &mdash; 5 days from now.</p>' +
    '<p>To keep your estimates, invoices, job photos, and client portal running without interruption, add a payment method in the app before then (Settings &rarr; Billing).</p>' +
    '<p>Questions, or want a quick walkthrough of anything before you decide? Just reply to this email &mdash; I read every message personally.</p>' +
    '<p style="margin-top:22px;">Siamak Kalhor<br><span style="color:#5A6B7D;">Orchamind &middot; <a href="https://orchamind.com" style="color:#2D7FF9;">orchamind.com</a></span></p>' +
    '</div>';
}

async function sendResend(RESEND, to, subject, html) {
  var r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: subject, html: html })
  });
  var body = await r.text();
  return { ok: r.ok, body: body.slice(0, 300) };
}

module.exports = async function handler(req, res) {
  var q = req.query || {};
  if ((q.key || '') !== CRON_KEY) return res.status(401).json({ ok: false, error: 'bad key' });

  var RESEND = process.env.RESEND_API_KEY;
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var rest = 'https://yqbprvyhzugdmavvurqb.supabase.co/rest/v1';
  var H = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  // Config check
  if (!q.run && !q.test_to) {
    return res.status(200).json({ ok: true, resend: !!RESEND, supabase: !!KEY, from: FROM, reply_to: REPLY_TO });
  }
  if (!RESEND) return res.status(200).json({ ok: false, error: 'RESEND_API_KEY missing in Vercel env' });
  if (!KEY) return res.status(200).json({ ok: false, error: 'Supabase key missing in Vercel env' });

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  }

  // Single test send
  if (q.test_to) {
    var demoDate = fmtDate(new Date(Date.now() + 5 * 864e5).toISOString());
    var t = await sendResend(RESEND, String(q.test_to), '[TEST] Your Orchamind trial ends ' + demoDate, emailHtml('Payman', 'payman fabric inc.', demoDate));
    return res.status(200).json({ ok: t.ok, test: t.ok ? 'sent' : 'error', to: q.test_to, detail: t.ok ? undefined : t.body });
  }

  // Real run
  try {
    var now = new Date().toISOString();
    var cut = new Date(Date.now() + 5 * 864e5).toISOString();
    var ra = await fetch(rest + '/accounts?select=username,name,company,trial_end,profile&stripe_status=eq.trialing&username=neq.siamakk2&trial_end=gt.' + encodeURIComponent(now) + '&trial_end=lte.' + encodeURIComponent(cut), { headers: H });
    var due = await ra.json();
    if (!Array.isArray(due)) return res.status(200).json({ ok: false, error: 'accounts query failed' });

    var results = [];
    for (var i = 0; i < due.length; i++) {
      var a = due[i];
      var email = ((a.profile && a.profile.email) || '').trim();

      // dedupe: skip if already sent for this trial period
      var rq = await fetch(rest + '/trial_reminders?select=status&username=eq.' + encodeURIComponent(a.username) + '&trial_end=eq.' + encodeURIComponent(a.trial_end), { headers: H });
      var prev = await rq.json();
      if (Array.isArray(prev) && prev.length && prev[0].status === 'sent') continue;

      var status = 'pending', errMsg = null, sentAt = null;
      if (!email) {
        status = 'skipped_no_email';
      } else {
        var dateStr = fmtDate(a.trial_end);
        var s = await sendResend(RESEND, email, 'Your Orchamind trial ends ' + dateStr, emailHtml(a.name, a.company, dateStr));
        if (s.ok) { status = 'sent'; sentAt = new Date().toISOString(); }
        else { status = 'error'; errMsg = s.body; }
      }

      await fetch(rest + '/trial_reminders?on_conflict=username,trial_end', {
        method: 'POST',
        headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ username: a.username, email: email, trial_end: a.trial_end, status: status, error: errMsg, sent_at: sentAt })
      });
      results.push({ username: a.username, status: status });
    }
    return res.status(200).json({ ok: true, checked: due.length, results: results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e).slice(0, 200) });
  }
};
