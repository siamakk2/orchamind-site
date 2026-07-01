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
  var STRIPE_TEST = process.env.STRIPE_SECRET_KEY_TEST;
  if (!KEY) return res.status(200).json({ ok: false, error: 'Server not set up.' });
  var base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  var H = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

  function sign(p) { return crypto.createHmac('sha256', KEY).update(p).digest('hex'); }
  function verifyToken(tok) {
    if (!tok) return null;
    var parts = String(tok).split('|');
    if (parts.length < 4) return null;
    var sig = parts.pop();
    var payload = parts.join('|');
    if (sign(payload) !== sig) return null;
    var exp = parseInt(parts[2], 10);
    if (!exp || Date.now() > exp) return null;
    return { username: parts[0], role: parts[1] };
  }
  function readCookie() {
    var c = req.headers.cookie || '';
    var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  async function stripePortal(cust, ret) {
    var keys = [STRIPE, STRIPE_TEST];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]; if (!k) continue;
      try {
        var r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'customer=' + encodeURIComponent(cust) + '&return_url=' + encodeURIComponent(ret) });
        var d = await r.json();
        if (r.ok && d && d.url) return d.url;
      } catch (e) {}
    }
    return '';
  }

  try {
    var sess = verifyToken(readCookie());
    if (!sess) return res.status(200).json({ ok: false, error: 'Please log in again.' });
    var r = await fetch(base + '/accounts?username=eq.' + encodeURIComponent(sess.username) + '&select=stripe_customer', { headers: H });
    var a = await r.json();
    var cust = (Array.isArray(a) && a[0] && a[0].stripe_customer) || '';
    if (!cust) return res.status(200).json({ ok: false, error: 'No billing is set up on this account.' });
    var url = await stripePortal(cust, 'https://orchamind.com/app');
    if (!url) return res.status(200).json({ ok: false, error: 'Could not open billing right now. Make sure the Customer Portal is turned on in Stripe.' });
    return res.status(200).json({ ok: true, url: url });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
