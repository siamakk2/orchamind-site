// TEMPORARY email diagnostic. Visit /api/email-test in a browser.
// Optional: /api/email-test?to=you@example.com to test delivery to a real inbox.
// Sends only fixed harmless test content. Remove this file once email is confirmed working.
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const to = (req.query && req.query.to) ? String(req.query.to) : 'delivered@resend.dev';
  const from = (req.query && req.query.from) ? String(req.query.from) : 'Orchamind <welcome@orchamind.com>';
  const RESEND = process.env.RESEND_API_KEY;
  const out = { resend_key_present: !!RESEND, from: from, attempted_to: to };
  if (!RESEND) {
    out.verdict = 'PROBLEM: RESEND_API_KEY is NOT set in this Vercel project. Add it in Vercel > orchamind-site > Settings > Environment Variables, then redeploy.';
    return res.status(200).json(out);
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from, to: [to], subject: 'Orchamind email test', html: '<p>This is a test from the Orchamind email diagnostic. If you can read this, sending works.</p>' })
    });
    out.resend_http_status = r.status;
    let body; try { body = await r.json(); } catch (e) { body = await r.text(); }
    out.resend_response = body;
    if (r.ok) {
      out.verdict = 'SUCCESS: the email service accepted the message. Check the inbox for ' + to + ' (and spam). If a real inbox got nothing, the issue is deliverability, not the code.';
    } else {
      out.verdict = 'PROBLEM: the email service rejected the send. See resend_response above. The most common cause is that the "from" domain (orchamind.com) is not verified in Resend, or the API key is wrong.';
    }
    return res.status(200).json(out);
  } catch (e) {
    out.error = String((e && e.message) || e);
    out.verdict = 'PROBLEM: exception while calling the email service. See error above.';
    return res.status(200).json(out);
  }
};
