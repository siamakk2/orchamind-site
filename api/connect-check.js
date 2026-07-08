// TEMPORARY diagnostic: /api/connect-check?u=YOURUSERNAME  (payout-account state + recent charges + balance on the connected account). Remove once confirmed.
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  var STRIPE = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_TEST;
  var SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var mode = STRIPE ? (STRIPE.indexOf('sk_live') === 0 ? 'LIVE' : (STRIPE.indexOf('sk_test') === 0 ? 'TEST' : '?')) : 'none';
  var out = { key_mode: mode };
  if (!STRIPE || !SVC) { out.verdict = 'PROBLEM: Stripe or Supabase key missing.'; return res.status(200).json(out); }
  var u = (req.query && (req.query.u || req.query.username)) ? String(req.query.u || req.query.username).toLowerCase() : '';
  if (!u) { out.verdict = 'Add ?u=YOURUSERNAME'; return res.status(200).json(out); }
  out.username = u;
  var SH = { 'apikey': SVC, 'Authorization': 'Bearer ' + SVC };
  try {
    var ar = await fetch(SUPABASE_URL + '/rest/v1/accounts?username=eq.' + encodeURIComponent(u) + '&select=stripe_connect_id', { headers: SH });
    var aj = await ar.json();
    var cid = (Array.isArray(aj) && aj[0]) ? aj[0].stripe_connect_id : null;
    out.connect_account_id = cid || null;
    if (!cid) { out.verdict = 'No payout account for "' + u + '" yet.'; return res.status(200).json(out); }
    var SA = { 'Authorization': 'Bearer ' + STRIPE, 'Stripe-Account': cid };
    // recent charges ON the connected account
    var chr = await fetch('https://api.stripe.com/v1/charges?limit=5', { headers: SA });
    var chj = await chr.json();
    out.recent_charges = ((chj && chj.data) || []).map(function (c) { return { amount: '$' + (c.amount / 100).toFixed(2), status: c.status, paid: c.paid, when: new Date(c.created * 1000).toISOString().slice(0, 16).replace('T', ' ') }; });
    // balance on the connected account
    var br = await fetch('https://api.stripe.com/v1/balance', { headers: SA });
    var bj = await br.json();
    out.balance_available = ((bj && bj.available) || []).map(function (b) { return '$' + (b.amount / 100).toFixed(2) + ' ' + b.currency; });
    out.balance_pending = ((bj && bj.pending) || []).map(function (b) { return '$' + (b.amount / 100).toFixed(2) + ' ' + b.currency; });
    var n = out.recent_charges.length;
    if (n > 0) {
      out.verdict = 'FOUND IT \u2014 there ' + (n === 1 ? 'is 1 payment' : 'are ' + n + ' payments') + ' on your connected account (most recent: ' + out.recent_charges[0].amount + ', ' + out.recent_charges[0].status + '). It is NOT in your main Payments list because it belongs to the connected account. See it in Stripe under Connect > Connected accounts > this account, or via the app "Manage payout account" link. Pending balance will pay out to your bank on schedule.';
    } else {
      out.verdict = 'The connected account is set up, but NO charges are recorded on it yet. If you paid and saw a success page, the charge may still be settling \u2014 refresh in a minute. If it still shows nothing, the payment link may have been created on the wrong account.';
    }
    return res.status(200).json(out);
  } catch (e) { out.error = String((e && e.message) || e); out.verdict = 'Exception. See error.'; return res.status(200).json(out); }
};
