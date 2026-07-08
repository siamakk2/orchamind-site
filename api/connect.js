var crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var STRIPE = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_TEST;
  var SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var SUPABASE_URL = 'https://yqbprvyhzugdmavvurqb.supabase.co';
  if (!STRIPE) return res.status(200).json({ ok: false, error: 'Payments not configured (missing Stripe key).' });
  if (!SVC) return res.status(200).json({ ok: false, error: 'Server not configured.' });
  var rest = SUPABASE_URL + '/rest/v1';
  var SH = { 'apikey': SVC, 'Authorization': 'Bearer ' + SVC, 'Content-Type': 'application/json' };

  function sign(p) { return crypto.createHmac('sha256', SVC).update(p).digest('hex'); }
  function verify(tok) {
    if (!tok) return null;
    var p = String(tok).split('|');
    if (p.length !== 4) return null;
    if (sign(p[0] + '|' + p[1] + '|' + p[2]) !== p[3]) return null;
    if (Date.now() > Number(p[2])) return null;
    return { username: p[0], role: p[1] };
  }
  function cookie() { var c = req.headers.cookie || ''; var m = c.match(/(?:^|;\s*)orcha_sess=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  function form(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  async function stripe(path, method, params) {
    var opt = { method: method, headers: { 'Authorization': 'Bearer ' + STRIPE } };
    if (params) { opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opt.body = form(params); }
    var r = await fetch('https://api.stripe.com' + path, opt);
    return await r.json();
  }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var action = body.action;

  try {
    var sess = verify(cookie());
    if (!sess || sess.role === 'demo') return res.status(200).json({ ok: false, error: 'Please log in again.' });

    var ar = await fetch(rest + '/accounts?username=eq.' + encodeURIComponent(sess.username) + '&select=stripe_connect_id', { headers: SH });
    var aj = await ar.json();
    var row = (Array.isArray(aj) && aj[0]) ? aj[0] : null;
    var connectId = row ? row.stripe_connect_id : null;

    if (action === 'status') {
      if (!connectId) return res.status(200).json({ ok: true, connected: false, started: false });
      var acc0 = await stripe('/v1/accounts/' + connectId, 'GET');
      if (acc0 && acc0.error) return res.status(200).json({ ok: true, connected: false, started: true });
      var connected = !!(acc0.charges_enabled && acc0.payouts_enabled);
      return res.status(200).json({ ok: true, connected: connected, started: true });
    }

    if (action === 'onboard') {
      if (!connectId) {
        var acc = await stripe('/v1/accounts', 'POST', {
          'type': 'express',
          'capabilities[card_payments][requested]': 'true',
          'capabilities[transfers][requested]': 'true'
        });
        if (!acc || acc.error || !acc.id) {
          var em = (acc && acc.error && acc.error.message) ? acc.error.message : 'Could not create payout account. Make sure Stripe Connect is enabled on your Stripe account.';
          return res.status(200).json({ ok: false, error: em });
        }
        connectId = acc.id;
        await fetch(rest + '/accounts?username=eq.' + encodeURIComponent(sess.username), {
          method: 'PATCH', headers: Object.assign({}, SH, { 'Prefer': 'return=minimal' }),
          body: JSON.stringify({ stripe_connect_id: connectId })
        });
      }
      var link = await stripe('/v1/account_links', 'POST', {
        'account': connectId,
        'refresh_url': 'https://orchamind.com/app?pay=refresh',
        'return_url': 'https://orchamind.com/app?pay=done',
        'type': 'account_onboarding'
      });
      if (!link || link.error || !link.url) {
        return res.status(200).json({ ok: false, error: (link && link.error && link.error.message) || 'Could not start setup.' });
      }
      return res.status(200).json({ ok: true, url: link.url });
    }

    if (action === 'dashboard') {
      if (!connectId) return res.status(200).json({ ok: false, error: 'No payout account yet. Set up online payments first.' });
      var ll = await stripe('/v1/accounts/' + connectId + '/login_links', 'POST', {});
      if (ll && ll.url) return res.status(200).json({ ok: true, url: ll.url });
      return res.status(200).json({ ok: false, error: (ll && ll.error && ll.error.message) || 'Could not open your Stripe payout dashboard.' });
    }

    if (action === 'payLink') {
      if (!connectId) return res.status(200).json({ ok: false, error: 'Set up your payout account first, then you can create payment links.' });
      var amount = Math.round(Number(body.amount) * 100);
      if (!amount || amount < 50) return res.status(200).json({ ok: false, error: 'Enter a valid amount of at least $0.50.' });
      var desc = String(body.description || 'Payment').slice(0, 250) || 'Payment';
      var params = {
        'mode': 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][price_data][product_data][name]': desc,
        'line_items[0][quantity]': '1',
        'success_url': 'https://orchamind.com/paid.html',
        'cancel_url': 'https://orchamind.com/paid.html?canceled=1'
      };
      if (body.email) params['customer_email'] = String(body.email);
      var por = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + STRIPE, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Account': connectId }, body: form(params) });
      var pcs = await por.json();
      if (pcs && pcs.url) return res.status(200).json({ ok: true, url: pcs.url });
      return res.status(200).json({ ok: false, error: (pcs && pcs.error && pcs.error.message) || 'Could not create the payment link.' });
    }

    return res.status(200).json({ ok: false, error: 'Unknown action.' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) });
  }
};
