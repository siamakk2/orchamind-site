// TEMPORARY billing diagnostic. Visit /api/billing-check in a browser.
// Tells you if Stripe is wired for the trial-subscription signup. Remove once confirmed.
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const SK = process.env.STRIPE_SECRET_KEY;
  const SKT = process.env.STRIPE_SECRET_KEY_TEST;
  const PRICE = process.env.STRIPE_PRICE_ID;
  const keyMode = SK ? (SK.indexOf('sk_live') === 0 ? 'LIVE' : (SK.indexOf('sk_test') === 0 ? 'TEST' : 'unknown')) : (SKT ? 'TEST (test key only)' : 'none');
  const out = {
    stripe_secret_key_present: !!SK,
    stripe_secret_key_test_present: !!SKT,
    stripe_price_id_present: !!PRICE,
    stripe_price_id_preview: PRICE ? (PRICE.slice(0, 10) + '\u2026') : null,
    key_mode: keyMode
  };
  const useKey = SK || SKT;
  if (!useKey) { out.verdict = 'PROBLEM: No Stripe secret key is set in Vercel. Add STRIPE_SECRET_KEY and redeploy.'; return res.status(200).json(out); }
  if (!PRICE) { out.verdict = 'PROBLEM: STRIPE_PRICE_ID is NOT set on this deployment. Either it was not saved to the orchamind-site project, or you have not redeployed since adding it. New signups create a free account but no Stripe subscription until this is fixed.'; return res.status(200).json(out); }
  try {
    const pr = await fetch('https://api.stripe.com/v1/prices/' + encodeURIComponent(PRICE), { headers: { 'Authorization': 'Bearer ' + useKey } });
    const pj = await pr.json();
    if (!pr.ok || pj.error) {
      out.price_lookup_error = pj.error ? pj.error.message : ('HTTP ' + pr.status);
      out.verdict = 'PROBLEM: Stripe could not find this price using your key. This is almost always a TEST-vs-LIVE mismatch: your key is ' + keyMode + ', so the STRIPE_PRICE_ID must also be from ' + keyMode + ' mode. Re-copy the price ID with the Stripe dashboard in the SAME mode as your key, update it in Vercel, and redeploy.';
      return res.status(200).json(out);
    }
    out.price_found = true;
    out.price_amount = (pj.unit_amount != null ? (pj.unit_amount / 100) : null);
    out.price_currency = pj.currency;
    out.price_interval = pj.recurring ? pj.recurring.interval : 'ONE-TIME (not a subscription)';
    out.price_mode = pj.livemode ? 'LIVE' : 'TEST';
    out.price_active = pj.active;
    const keyLive = keyMode === 'LIVE';
    if (pj.livemode !== keyLive && keyMode !== 'unknown') {
      out.verdict = 'PROBLEM: Mode mismatch. Your key is ' + keyMode + ' but this price is ' + out.price_mode + '. They must be the same mode.';
    } else if (!pj.recurring) {
      out.verdict = 'PROBLEM: This price is ONE-TIME, not monthly. You need a recurring $500/month price for a subscription.';
    } else if (!pj.active) {
      out.verdict = 'PROBLEM: This price is archived/inactive in Stripe. Use an active $500/month price.';
    } else {
      out.verdict = 'OK \u2014 billing is wired correctly. Price is ' + out.price_amount + ' ' + (out.price_currency || '').toUpperCase() + '/' + out.price_interval + ' in ' + out.price_mode + ' mode. New signups will now create a 30-day trial subscription in Stripe.';
    }
    return res.status(200).json(out);
  } catch (e) {
    out.error = String((e && e.message) || e);
    out.verdict = 'PROBLEM: Exception while calling Stripe. See error above.';
    return res.status(200).json(out);
  }
};
