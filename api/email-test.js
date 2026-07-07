// TEMPORARY email diagnostic. Visit /api/email-test?to=you@example.com in a browser.
// Shows which domains Resend has verified + attempts a real send. Remove once email works.
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const RESEND = process.env.RESEND_API_KEY;
  const to = (req.query && req.query.to) ? String(req.query.to) : 'delivered@resend.dev';
  const from = (req.query && req.query.from) ? String(req.query.from) : 'Orchamind <welcome@orchamind.com>';
  const out = { resend_key_present: !!RESEND, from: from, attempted_to: to };
  if (!RESEND) { out.verdict = 'PROBLEM: RESEND_API_KEY is not set in Vercel. Add it and redeploy.'; return res.status(200).json(out); }
  // 1) Which domains are verified?
  try {
    const dr = await fetch('https://api.resend.com/domains', { headers: { 'Authorization': 'Bearer ' + RESEND } });
    const dj = await dr.json();
    if (dj && Array.isArray(dj.data)) out.domains = dj.data.map(function (d) { return { name: d.name, status: d.status, region: d.region }; });
    else out.domains_raw = dj;
  } catch (e) { out.domains_error = String((e && e.message) || e); }
  // 2) Attempt a real send
  try {
    const er = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: from, to: [to], subject: 'Orchamind email test', html: '<p>This is a test from the Orchamind email diagnostic. If you can read this, sending works.</p>' }) });
    out.send_http_status = er.status;
    let body; try { body = await er.json(); } catch (e) { body = await er.text(); }
    out.send_response = body;
    if (er.ok) {
      out.verdict = 'The email service ACCEPTED the message (id: ' + ((body && body.id) || '?') + '). If the inbox for ' + to + ' received nothing, the config is fine and this is a deliverability/spam issue \u2014 check Resend dashboard > Emails for the delivery status of that message.';
    } else {
      const msg = (body && body.message) || JSON.stringify(body);
      out.verdict = 'PROBLEM: the send was REJECTED \u2014 "' + msg + '". The usual cause is that the sending domain (orchamind.com) is not verified in Resend. Look at the "domains" list above: if orchamind.com is not "verified", either verify it, or tell me and I will switch the sender to a domain that IS verified (e.g. siamakkalhor.com).';
    }
  } catch (e) { out.send_error = String((e && e.message) || e); out.verdict = 'PROBLEM: exception while sending. See send_error above.'; }
  return res.status(200).json(out);
};
