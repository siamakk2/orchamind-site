var crypto = require('crypto');

function readBody(req) {
  var b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var STRIPE = process.env.STRIPE_SECRET_KEY;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not set up: add SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  if (!STRIPE) return res.status(200).json({ ok: false, error: 'Payment check not set up yet: add STRIPE_SECRET_KEY in Vercel, then redeploy.' });
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function hashPw(pw) {
    var salt = crypto.randomBytes(16).toString('hex');
    var h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
    return salt + ':' + h;
  }
  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function makeToken(username, role) {
    var exp = Date.now() + 30 * 24 * 3600 * 1000;
    var p = username + '|' + role + '|' + exp;
    return p + '|' + sign(p);
  }
  function setSess(username, role) {
    var tok = makeToken(username, role);
    res.setHeader('Set-Cookie', 'orcha_sess=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30 * 24 * 3600));
  }
  async function getUser(username) {
    var r = await fetch(base + '/accounts?username=eq.' + encodeURIComponent(username) + '&select=username', { headers: H });
    var a = await r.json();
    return (Array.isArray(a) && a[0]) ? a[0] : null;
  }

  var body = readBody(req);
  var sessionId = (body.sessionId || '').trim();
  var company = (body.company || '').trim();
  var username = (body.username || '').toLowerCase().trim();
  var name = body.name || '';
  var pass = body.password || '';

  try {
    if (!sessionId) return res.status(200).json({ ok: false, error: 'We could not find your payment. Please use the link from your email receipt.' });
    if (!company || !username || String(pass).length < 6) return res.status(200).json({ ok: false, error: 'Company name, a username, and a 6+ character password are required.' });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(200).json({ ok: false, error: 'Username can use only letters, numbers, and underscores.' });

    // 1) Verify the Stripe checkout session is real and completed
    var sr = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), { headers: { 'Authorization': 'Bearer ' + STRIPE } });
    var s = await sr.json();
    if (!sr.ok || !s || s.error) return res.status(200).json({ ok: false, error: 'We could not verify your payment. Please contact support.' });
    var paid = (s.status === 'complete') && (s.mode === 'subscription') && !!s.subscription;
    if (!paid) return res.status(200).json({ ok: false, error: 'Your subscription has not completed yet. If you just paid, wait a few seconds and try again.' });

    // 2) One workspace per subscription — block reuse of the same payment
    var clr = await fetch(base + '/accounts?stripe_session=eq.' + encodeURIComponent(sessionId) + '&select=username', { headers: H });
    var cl = await clr.json();
    if (Array.isArray(cl) && cl.length) return res.status(200).json({ ok: false, error: 'This subscription already has a workspace. Please log in instead.' });

    // 3) Username available?
    var ex = await getUser(username);
    if (ex) return res.status(200).json({ ok: false, error: 'That username is taken — please pick another.' });

    var subId = (typeof s.subscription === 'string') ? s.subscription : ((s.subscription && s.subscription.id) || '');
    var custId = (typeof s.customer === 'string') ? s.customer : ((s.customer && s.customer.id) || '');

    // 4) Create the owner workspace
    var ins = await fetch(base + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ username: username, name: name, role: 'owner', owner: username, company: company, pass: hashPw(pass), must_change: false, stripe_session: sessionId, stripe_customer: custId, stripe_subscription: subId }) });
    if (!ins.ok) { var e = await ins.text(); return res.status(200).json({ ok: false, error: 'Could not create your workspace. ' + e.slice(0, 140) }); }

    setSess(username, 'owner');
    return res.status(200).json({ ok: true, user: { username: username, name: name, role: 'owner', company: company } });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
