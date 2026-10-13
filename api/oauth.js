// Sign in with Google, Facebook, or a one-time email link.
//
//   GET  /auth/google            -> /api/oauth?provider=google&step=start   (vercel.json rewrite)
//   GET  /auth/google/callback   -> /api/oauth?provider=google&step=callback
//   GET  /auth/facebook[...]     -> same for Facebook
//   GET  /api/oauth?config=1     -> which buttons the login screen should show
//   POST {action:'sendLink', email}            email a one-time sign-in link
//   GET  /api/oauth?step=link&u=&n=            a page with a "Sign in" button
//   POST {action:'useLink', u, n} (form post)  spends the link, signs in
//
// Accounts are matched by email, exactly like the password login. Someone with
// no account is sent to the signup form with their verified email filled in
// (a signed token proves it; see 'register' in api/accounts.js). Accounts with
// two-factor login still get the emailed code; paused accounts still get the
// renew screen and no session.
//
// Keys (Vercel env): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//                    FACEBOOK_APP_ID, FACEBOOK_APP_SECRET.
// A provider without keys is simply not offered.

var crypto = require('crypto');
var tokens = require('../lib/auth-tokens.js');

var ORIGIN = 'https://orchamind.com';
var REST = 'https://yqbprvyhzugdmavvurqb.supabase.co/rest/v1';
var LINK_TTL = 15 * 60 * 1000;

var PROVIDERS = {
  google: {
    label: 'Google',
    id: function () { return process.env.GOOGLE_CLIENT_ID; },
    secret: function () { return process.env.GOOGLE_CLIENT_SECRET; },
    authUrl: function (id, redirect, state) {
      return 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=' + encodeURIComponent(id)
        + '&redirect_uri=' + encodeURIComponent(redirect) + '&scope=' + encodeURIComponent('openid email profile')
        + '&state=' + encodeURIComponent(state) + '&prompt=select_account';
    },
    profile: async function (code, id, secret, redirect) {
      var t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&client_id=' + encodeURIComponent(id)
          + '&client_secret=' + encodeURIComponent(secret) + '&redirect_uri=' + encodeURIComponent(redirect) });
      var tj = await t.json();
      if (!t.ok || !tj.access_token) return null;
      var u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tj.access_token } });
      var uj = await u.json();
      if (!u.ok || !uj) return null;
      return { email: uj.email || '', verified: uj.email_verified === true || uj.email_verified === 'true', name: uj.name || uj.given_name || '' };
    }
  },
  facebook: {
    label: 'Facebook',
    id: function () { return process.env.FACEBOOK_APP_ID; },
    secret: function () { return process.env.FACEBOOK_APP_SECRET; },
    authUrl: function (id, redirect, state) {
      return 'https://www.facebook.com/dialog/oauth?response_type=code&client_id=' + encodeURIComponent(id)
        + '&redirect_uri=' + encodeURIComponent(redirect) + '&scope=' + encodeURIComponent('email,public_profile')
        + '&state=' + encodeURIComponent(state);
    },
    profile: async function (code, id, secret, redirect) {
      var t = await fetch('https://graph.facebook.com/oauth/access_token?client_id=' + encodeURIComponent(id) + '&client_secret=' + encodeURIComponent(secret)
        + '&redirect_uri=' + encodeURIComponent(redirect) + '&code=' + encodeURIComponent(code));
      var tj = await t.json();
      if (!t.ok || !tj.access_token) return null;
      var u = await fetch('https://graph.facebook.com/me?fields=id,name,email&access_token=' + encodeURIComponent(tj.access_token));
      var uj = await u.json();
      if (!u.ok || !uj) return null;
      // Facebook only returns an email the person has confirmed with Facebook.
      return { email: uj.email || '', verified: !!uj.email, name: uj.name || '' };
    }
  }
};

function cookies(req) {
  var out = {}; String(req.headers.cookie || '').split(/;\s*/).forEach(function (c) { var i = c.indexOf('='); if (i > 0) out[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1)); });
  return out;
}
function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  var KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  var H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  var q = req.query || {};
  var setCookies = [];

  function go(url) {
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    res.setHeader('Location', url);
    return res.status(303).end();
  }
  function fail(code) { return go(ORIGIN + '/app?autherr=' + encodeURIComponent(code)); }
  function sessionCookie(username, role) {
    var exp = Date.now() + 30 * 24 * 3600 * 1000;
    var p = username + '|' + (role || 'member') + '|' + exp;
    var tok = p + '|' + crypto.createHmac('sha256', KEY).update(p).digest('hex');
    setCookies.push('orcha_sess=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30 * 24 * 3600));
  }
  async function patch(username, fields) {
    return fetch(REST + '/accounts?username=eq.' + encodeURIComponent(username), { method: 'PATCH', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify(fields) });
  }
  async function logEvent(type, username, detail) {
    try { await fetch(REST + '/activity_log', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ type: type, username: username, detail: detail }) }); } catch (e) {}
  }
  // Same rule as the password login, but an exact address match: ilike treats
  // "_" and "%" in an address as wildcards.
  async function byEmail(email) {
    var e = String(email || '').toLowerCase().trim();
    if (!e || e.indexOf('@') < 1) return null;
    var r = await fetch(REST + '/accounts?profile->>email=ilike.' + encodeURIComponent(e) + '&select=*', { headers: H });
    var a = await r.json();
    if (!Array.isArray(a)) return null;
    a = a.filter(function (x) { return String((x.profile && x.profile.email) || '').toLowerCase().trim() === e; });
    if (!a.length) return null;
    var rank = function (row) { if (row.status === 'paused') return 3; if (row.stripe_status === 'active') return 0; if (row.status === 'active' || !row.status) return 1; return 2; };
    a.sort(function (x, y) { return (rank(x) - rank(y)) || String(y.created_at || '').localeCompare(String(x.created_at || '')); });
    return a[0];
  }
  // Signed in by Google/Facebook/email link: finish exactly as the password login would.
  async function finish(row, how) {
    if (row.status === 'paused' && row.username !== 'siamakk2') {
      // No session for a paused workspace; a short pass lets the app show the renew screen.
      setCookies.push('orcha_pending=' + encodeURIComponent(tokens.make(KEY, 'paused', { u: row.username }, 10 * 60 * 1000)) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
      return go(ORIGIN + '/app?signedin=1');
    }
    var mfaEmail = (row.profile && row.profile.email) || '';
    if (row.mfa_enabled && mfaEmail && how !== 'email link') {
      var code = String(crypto.randomInt(100000, 1000000));
      await patch(row.username, { mfa_code: code, mfa_code_exp: Date.now() + 10 * 60 * 1000 });
      var RS = process.env.RESEND_API_KEY;
      if (RS) {
        try {
          await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'Orchamind <welcome@orchamind.com>', to: [mfaEmail], subject: 'Your Orchamind login code: ' + code,
              html: '<div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto;color:#0A1628;text-align:center;padding:20px;"><div style="font-size:13px;color:#5A6B7D;letter-spacing:.1em;text-transform:uppercase;font-weight:700;">Your login code</div><div style="font-size:40px;font-weight:800;letter-spacing:.15em;margin:14px 0;color:#0A1628;">' + code + '</div><p style="font-size:13.5px;color:#5A6B7D;">Enter this code to finish signing in. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p></div>' }) });
        } catch (e) {}
      }
      return go(ORIGIN + '/app?mfa=' + encodeURIComponent(row.username));
    }
    sessionCookie(row.username, row.role);
    await logEvent('login', row.username, (row.company || row.name || row.username) + ' logged in (' + how + ')');
    return go(ORIGIN + '/app?signedin=1');
  }

  try {
    if (!KEY) return res.status(200).json({ ok: false, error: 'Server not configured.' });

    if (req.method === 'GET' && q.config) {
      return res.status(200).json({ ok: true, google: !!(PROVIDERS.google.id() && PROVIDERS.google.secret()),
        facebook: !!(PROVIDERS.facebook.id() && PROVIDERS.facebook.secret()), emailLink: !!process.env.RESEND_API_KEY });
    }

    // ---- Google / Facebook ----
    var P = PROVIDERS[q.provider];
    if (req.method === 'GET' && P && (q.step === 'start' || q.step === 'callback')) {
      var id = P.id(), secret = P.secret();
      if (!id || !secret) return fail('notset');
      var redirect = ORIGIN + '/auth/' + q.provider + '/callback';

      if (q.step === 'start') {
        var nonce = crypto.randomBytes(16).toString('hex');
        var state = tokens.make(KEY, 'oauth-state', { p: q.provider, n: nonce, ref: String(q.ref || '').slice(0, 40) }, 10 * 60 * 1000);
        setCookies.push('orcha_oauth=' + nonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
        return go(P.authUrl(id, redirect, state));
      }

      setCookies.push('orcha_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      if (q.error) return fail('cancelled');
      var st = tokens.read(KEY, 'oauth-state', String(q.state || ''));
      if (!st || st.p !== q.provider || !st.n || st.n !== cookies(req).orcha_oauth) return fail('expired');
      if (!q.code) return fail('failed');
      var who = await P.profile(String(q.code), id, secret, redirect);
      if (!who) return fail('failed');
      if (!who.email) return fail('noemail');
      if (!who.verified) return fail('unverified');

      var row = await byEmail(who.email);
      if (row) return finish(row, P.label);
      // New here: on to signup with the verified email filled in.
      var sso = tokens.make(KEY, 'sso-signup', { email: who.email.toLowerCase().trim(), name: who.name, p: q.provider }, 30 * 60 * 1000);
      return go(ORIGIN + '/app?signup=1&sso=' + encodeURIComponent(sso) + '&email=' + encodeURIComponent(who.email) + '&name=' + encodeURIComponent(who.name || '')
        + (st.ref ? '&ref=' + encodeURIComponent(st.ref) : ''));
    }

    // ---- Email link ----
    var body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = require('querystring').parse(body); } } body = body || {};

    if (req.method === 'POST' && body.action === 'sendLink') {
      var email = String(body.email || '').trim();
      // Same answer whether or not the address has an account, so this cannot be
      // used to find out who our customers are.
      var answer = { ok: true, message: 'If that email has an Orchamind account, a sign-in link is on its way. It works for 15 minutes.' };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(200).json({ ok: false, error: 'Enter the email address you use for Orchamind.' });
      var acc = await byEmail(email);
      if (!acc) return res.status(200).json(answer);
      if (acc.link_exp && Number(acc.link_exp) - LINK_TTL + 60 * 1000 > Date.now()) return res.status(200).json(answer); // one per minute
      var n = crypto.randomBytes(24).toString('hex');
      await patch(acc.username, { link_nonce: n, link_exp: Date.now() + LINK_TTL });
      var url = ORIGIN + '/api/oauth?step=link&u=' + encodeURIComponent(acc.username) + '&n=' + n;
      var RS2 = process.env.RESEND_API_KEY;
      if (RS2) {
        await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RS2, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Orchamind <welcome@orchamind.com>', to: [email], reply_to: 'siamakk2@gmail.com', subject: 'Your Orchamind sign-in link',
            text: 'Tap this link to sign in to Orchamind:\n\n' + url + '\n\nIt works once, for the next 15 minutes. If you did not ask for it, you can ignore this email.',
            html: '<div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto;color:#0A1628;text-align:center;padding:20px;"><div style="font-size:22px;font-weight:800;margin-bottom:14px;">Orchamind</div><a href="' + esc(url) + '" style="display:inline-block;background:#1565C0;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:9px;font-size:16px;">Sign in to Orchamind</a><p style="font-size:13.5px;color:#5A6B7D;margin-top:18px;">This link works once, for the next 15 minutes. If you did not ask for it, you can ignore this email.</p></div>' }) });
      }
      return res.status(200).json(answer);
    }

    if (req.method === 'GET' && q.step === 'link') {
      // Mail scanners (Outlook, Gmail) open links to check them. A GET must
      // never spend the link, so this page asks for one tap.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sign in to Orchamind</title>'
        + '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:380px;margin:18vh auto;padding:0 16px;text-align:center;color:#0A1628;">'
        + '<div style="font-size:24px;font-weight:900;margin-bottom:18px;">Orchamind</div>'
        + '<form method="post" action="/api/oauth"><input type="hidden" name="action" value="useLink"><input type="hidden" name="u" value="' + esc(q.u) + '"><input type="hidden" name="n" value="' + esc(q.n) + '">'
        + '<button style="width:100%;background:#1565C0;color:#fff;border:none;border-radius:10px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;">Sign in</button></form>'
        + '<p style="font-size:13px;color:#5A6B7D;margin-top:14px;">This link works once, for 15 minutes.</p></div>');
    }

    if (req.method === 'POST' && body.action === 'useLink') {
      var lu = String(body.u || ''), ln = String(body.n || '');
      if (!lu || !/^[a-f0-9]{48}$/.test(ln)) return fail('expired');
      var lr = await fetch(REST + '/accounts?username=eq.' + encodeURIComponent(lu) + '&select=*', { headers: H });
      var la = await lr.json();
      var lrow = Array.isArray(la) ? la[0] : null;
      if (!lrow || !lrow.link_nonce || lrow.link_nonce.length !== ln.length || !crypto.timingSafeEqual(Buffer.from(lrow.link_nonce), Buffer.from(ln))) return fail('expired');
      var stillValid = Number(lrow.link_exp) > Date.now();
      await patch(lu, { link_nonce: null, link_exp: null });   // works once, valid or not
      if (!stillValid) return fail('expired');
      return finish(lrow, 'email link');
    }

    return res.status(400).json({ ok: false, error: 'Unknown request.' });
  } catch (e) {
    return fail('failed');
  }
};
