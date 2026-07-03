// Stripe webhook for Orchamind: keeps each account's status in sync with its
// subscription. Secured by a secret in the URL (?key=...). To be safe against
// spoofing, we don't trust the event body's status — we re-fetch the real
// subscription from Stripe before pausing or reactivating anyone.

function readBody(req) {
  var b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, note: 'ready' });

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var STRIPE = process.env.STRIPE_SECRET_KEY;
  var STRIPE_TEST = process.env.STRIPE_SECRET_KEY_TEST;
  var HOOK = process.env.STRIPE_WEBHOOK_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'no supabase key' });

  // URL secret check
  var qkey = (req.query && (req.query.key || req.query.k)) || '';
  if (HOOK && qkey !== HOOK) return res.status(401).json({ ok: false, error: 'bad key' });

  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Prefer': 'return=minimal' };

  try {
    var evt = readBody(req);
    var obj = (evt && evt.data && evt.data.object) || {};
    var live = evt && evt.livemode !== false;
    var useKey = live ? STRIPE : STRIPE_TEST;

    var subId = (obj.object === 'subscription') ? obj.id : (obj.subscription || '');
    var custId = obj.customer || '';
    if (!subId && !custId) return res.status(200).json({ ok: true, skipped: 'no ids' });

    // Re-fetch authoritative subscription status from Stripe
    var status = '';
    if (subId && useKey) {
      var r = await fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subId), { headers: { 'Authorization': 'Bearer ' + useKey } });
      var sub = await r.json();
      if (r.ok && sub && sub.status) status = sub.status;
    }
    if (!status && evt && evt.type === 'customer.subscription.deleted') status = 'canceled';
    if (!status) return res.status(200).json({ ok: true, note: 'no status' });

    var pausedStates = ['canceled', 'unpaid', 'past_due', 'incomplete_expired', 'paused'];
    var activeStates = ['active', 'trialing'];
    var newStatus = pausedStates.indexOf(status) >= 0 ? 'paused' : (activeStates.indexOf(status) >= 0 ? 'active' : '');
    if (!newStatus) return res.status(200).json({ ok: true, note: 'ignored ' + status });

    var patch = JSON.stringify({ status: newStatus });
    var updated = false;
    if (subId) {
      var u1 = await fetch(base + '/accounts?stripe_subscription=eq.' + encodeURIComponent(subId), { method: 'PATCH', headers: H, body: patch });
      updated = u1.ok;
    }
    if (custId) {
      await fetch(base + '/accounts?stripe_customer=eq.' + encodeURIComponent(custId), { method: 'PATCH', headers: H, body: patch });
    }
    try {
      var _q = subId ? ('stripe_subscription=eq.' + encodeURIComponent(subId)) : ('stripe_customer=eq.' + encodeURIComponent(custId));
      var _ar = await fetch(base + '/accounts?' + _q + '&select=username,company,name', { headers: H });
      var _aa = await _ar.json();
      var _who = (Array.isArray(_aa) && _aa[0]) ? (_aa[0].company || _aa[0].name || _aa[0].username) : (custId || subId);
      var _un = (Array.isArray(_aa) && _aa[0]) ? _aa[0].username : '';
      var _det = (newStatus === 'active') ? (_who + (status === 'trialing' ? ' started a free trial' : ' subscription active (paid)')) : (_who + ' subscription lapsed (' + status + ')');
      await fetch(base + '/activity_log', { method: 'POST', headers: H, body: JSON.stringify({ type: 'payment', username: _un, detail: _det }) });
    } catch (e) {}
    return res.status(200).json({ ok: true, status: newStatus });
  } catch (e) {
    // Always 200 so Stripe doesn't hammer retries; log the message in the body
    return res.status(200).json({ ok: false, error: (e && e.message) ? e.message : String(e) });
  }
};
