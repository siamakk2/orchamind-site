// TEMPORARY diagnostic: /api/connect-check?u=YOURUSERNAME  (shows the exact state of a contractor's payout account). Remove once payments confirmed.
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  var STRIPE = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_TEST;
  var SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var mode = STRIPE ? (STRIPE.indexOf('sk_live') === 0 ? 'LIVE' : (STRIPE.indexOf('sk_test') === 0 ? 'TEST' : '?')) : 'none';
  var out = { stripe_key_present: !!STRIPE, key_mode: mode };
  if (!STRIPE || !SVC) { out.verdict = 'PROBLEM: Stripe or Supabase key missing in Vercel.'; return res.status(200).json(out); }
  var u = (req.query && (req.query.u || req.query.username)) ? String(req.query.u || req.query.username).toLowerCase() : '';
  if (!u) { out.verdict = 'Add your username to the URL: /api/connect-check?u=YOURUSERNAME'; return res.status(200).json(out); }
  out.username = u;
  var SH = { 'apikey': SVC, 'Authorization': 'Bearer ' + SVC };
  try {
    var ar = await fetch(SUPABASE_URL + '/rest/v1/accounts?username=eq.' + encodeURIComponent(u) + '&select=stripe_connect_id', { headers: SH });
    var aj = await ar.json();
    var cid = (Array.isArray(aj) && aj[0]) ? aj[0].stripe_connect_id : null;
    out.connect_account_id = cid || null;
    if (!cid) { out.verdict = 'No payout account exists yet for "' + u + '". In the app: Company Profile > Online Payments > "Set up online payments" to create one.'; return res.status(200).json(out); }
    var sr = await fetch('https://api.stripe.com/v1/accounts/' + cid, { headers: { 'Authorization': 'Bearer ' + STRIPE } });
    var acc = await sr.json();
    if (acc.error) { out.stripe_error = acc.error.message; out.verdict = 'The stored payout account cannot be read with the ' + mode + ' key \u2014 it was likely created in the other mode. Fix: in the app click "Set up online payments" (the code now auto-recreates it in ' + mode + '), finish onboarding, then re-check.'; return res.status(200).json(out); }
    out.charges_enabled = !!acc.charges_enabled;
    out.payouts_enabled = !!acc.payouts_enabled;
    out.details_submitted = !!acc.details_submitted;
    var ext = (acc.external_accounts && acc.external_accounts.data) || [];
    out.bank_attached = ext.length > 0;
    var due = (acc.requirements && (acc.requirements.currently_due || [])) || [];
    out.still_needed = due;
    if (out.charges_enabled && out.payouts_enabled) { out.verdict = 'OK \u2014 this account is FULLY set up. Charges and payouts are enabled. You can take payments now.'; }
    else if (!out.bank_attached) { out.verdict = 'ALMOST THERE: onboarding is not finished \u2014 no payout bank is attached. In the app click "Set up online payments" and complete Stripe onboarding (it asks for a bank). Still needed: ' + (due.join(', ') || 'bank account'); }
    else { out.verdict = 'ALMOST THERE: Stripe still needs \u2014 ' + (due.join(', ') || 'verification') + '. Click "Set up online payments" in the app to finish.'; }
    return res.status(200).json(out);
  } catch (e) { out.error = String((e && e.message) || e); out.verdict = 'Exception. See error.'; return res.status(200).json(out); }
};
