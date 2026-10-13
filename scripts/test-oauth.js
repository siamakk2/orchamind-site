// Sign in with Google / Facebook / email link, end to end, against fake
// providers, a fake database and a fake mailer. Runs the real api/oauth.js and
// api/accounts.js handlers.

var crypto = require('crypto');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.RESEND_API_KEY = 're_test';
delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY_TEST; delete process.env.STRIPE_PRICE_ID;
var oauth = require('../api/oauth.js');
var accounts = require('../api/accounts.js');

var db, mail, provider;
function reset() {
  db = { accounts: [
    { username: 'gioc249', name: 'Gio Chavez', role: 'owner', owner: 'gioc249', company: 'Alexander Tile', status: 'active', profile: { email: 'Gioc249@Gmail.com' }, created_at: '2026-10-02' },
    { username: 'axb', name: 'Other', role: 'owner', owner: 'axb', company: 'Other Co', status: 'active', profile: { email: 'axb@x.com' }, created_at: '2026-09-01' },
    { username: 'paused1', name: 'P', role: 'owner', company: 'Paused Co', status: 'paused', stripe_customer: '', profile: { email: 'p@x.com' }, created_at: '2026-08-01' },
    { username: 'mfa1', name: 'M', role: 'owner', company: 'MFA Co', status: 'active', mfa_enabled: true, profile: { email: 'm@x.com' }, created_at: '2026-08-01' }
  ], activity_log: [] };
  mail = [];
  provider = { google: { email: 'gioc249@gmail.com', email_verified: true, name: 'Gio Chavez' }, facebook: { id: '1', name: 'F', email: 'f@x.com' } };
}
function json(x, ok) { return { ok: ok !== false, status: ok === false ? 400 : 200, json: async function () { return x; }, text: async function () { return JSON.stringify(x); } }; }
global.fetch = async function (url, opts) {
  opts = opts || {}; var method = opts.method || 'GET';
  if (url.indexOf('api.resend.com') > -1) { mail.push(JSON.parse(opts.body)); return json({ id: 'm' }); }
  if (url.indexOf('oauth2.googleapis.com/token') > -1) return /code=good/.test(opts.body) ? json({ access_token: 'g-at' }) : json({ error: 'bad' }, false);
  if (url.indexOf('openidconnect.googleapis.com') > -1) return json(provider.google);
  if (url.indexOf('graph.facebook.com/oauth/access_token') > -1) return /code=good/.test(url) ? json({ access_token: 'f-at' }) : json({ error: 'bad' }, false);
  if (url.indexOf('graph.facebook.com/me') > -1) return json(provider.facebook);
  var u = new URL(url), table = u.pathname.split('/').pop();
  var rows = db[table] || (db[table] = []);
  var match = function (r) {
    var ok = true;
    u.searchParams.forEach(function (v, k) {
      if (k === 'select' || k === 'order' || k === 'limit') return;
      if (k === 'profile->>email' && /^ilike\./.test(v)) {
        // real ilike: _ and % are wildcards
        var re = new RegExp('^' + v.slice(6).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/%/g, '.*') + '$', 'i');
        ok = ok && re.test(String((r.profile || {}).email || ''));
      } else if (/^eq\./.test(v)) ok = ok && String(r[k]) === v.slice(3);
    });
    return ok;
  };
  if (method === 'GET') return json(rows.filter(match));
  if (method === 'PATCH') { var f = JSON.parse(opts.body); rows.filter(match).forEach(function (r) { Object.assign(r, f); }); return json([]); }
  if (method === 'POST') { rows.push(JSON.parse(opts.body)); return json([]); }
  return json([]);
};

function call(h, method, query, body, cookie) {
  return new Promise(function (resolve) {
    var res = { code: 200, headers: {}, setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; }, status: function (c) { this.code = c; return this; },
      json: function (x) { resolve({ code: this.code, body: x, headers: this.headers }); }, send: function (x) { resolve({ code: this.code, body: x, headers: this.headers }); },
      end: function () { resolve({ code: this.code, headers: this.headers }); } };
    h({ method: method, query: query || {}, body: body, headers: { cookie: cookie || '' } }, res);
  });
}
function setCookies(r) { var c = r.headers['set-cookie']; return Array.isArray(c) ? c : (c ? [c] : []); }
function cookieVal(r, name) { var m = setCookies(r).map(function (c) { return c.match(new RegExp('^' + name + '=([^;]*)')); }).filter(Boolean)[0]; return m ? decodeURIComponent(m[1]) : null; }
function sessUser(r) {
  var v = cookieVal(r, 'orcha_sess'); if (!v) return null;
  var p = v.split('|'); if (p.length !== 4) return null;
  return crypto.createHmac('sha256', 'test-key').update(p[0] + '|' + p[1] + '|' + p[2]).digest('hex') === p[3] ? p[0] : 'BAD-SIGNATURE';
}
async function googleRound(code, tamper) {
  var s = await call(oauth, 'GET', { provider: 'google', step: 'start' });
  var state = new URL(s.headers.location).searchParams.get('state');
  var nonce = cookieVal(s, 'orcha_oauth');
  return call(oauth, 'GET', { provider: 'google', step: 'callback', code: code || 'good', state: (tamper && tamper.state) || state }, null, 'orcha_oauth=' + ((tamper && tamper.nonce) || nonce));
}

(async function () {
  console.log('\nwhich buttons show');
  reset();
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.FACEBOOK_APP_ID; delete process.env.FACEBOOK_APP_SECRET;
  var r = await call(oauth, 'GET', { config: '1' });
  check('no keys yet: Google and Facebook buttons stay hidden, email link is on', r.body.google === false && r.body.facebook === false && r.body.emailLink === true);
  r = await call(oauth, 'GET', { provider: 'google', step: 'start' });
  check('no keys: tapping Google lands on a friendly message, not an error page', r.code === 303 && /autherr=notset/.test(r.headers.location));
  process.env.GOOGLE_CLIENT_ID = 'gid'; process.env.GOOGLE_CLIENT_SECRET = 'gsec'; process.env.FACEBOOK_APP_ID = 'fid'; process.env.FACEBOOK_APP_SECRET = 'fsec';
  r = await call(oauth, 'GET', { config: '1' });
  check('with keys: both buttons show', r.body.google && r.body.facebook);
  check('answers are never cached', r.headers['cache-control'] === 'no-store, max-age=0');

  console.log('\nGoogle');
  r = await call(oauth, 'GET', { provider: 'google', step: 'start' });
  var loc = new URL(r.headers.location);
  check('sends the person to Google', loc.host === 'accounts.google.com');
  check('with the registered return address', loc.searchParams.get('redirect_uri') === 'https://orchamind.com/auth/google/callback');
  check('asks only for name and email', loc.searchParams.get('scope') === 'openid email profile');
  check('sets an anti-forgery cookie', !!cookieVal(r, 'orcha_oauth'));
  r = await googleRound();
  check('existing customer (email in different case) is signed in', sessUser(r) === 'gioc249', sessUser(r));
  check('and sent back to the app', /\/app\?signedin=1$/.test(r.headers.location));
  check('the sign-in shows in your activity feed as Google', db.activity_log.some(function (a) { return a.type === 'login' && /\(Google\)/.test(a.detail); }));
  r = await googleRound('good', { nonce: 'someone-elses' });
  check('a return link opened in a different browser is refused (anti-forgery)', !sessUser(r) && /autherr=expired/.test(r.headers.location));
  r = await googleRound('good', { state: 'forged.state' });
  check('a forged return link is refused', !sessUser(r) && /autherr=expired/.test(r.headers.location));
  r = await call(oauth, 'GET', { provider: 'google', step: 'callback', error: 'access_denied', state: 'x' });
  check('pressing Cancel at Google shows "cancelled"', /autherr=cancelled/.test(r.headers.location));
  r = await googleRound('bad-code');
  check('a bad code from Google fails safely', !sessUser(r) && /autherr=failed/.test(r.headers.location));
  provider.google = { email: 'gioc249@gmail.com', email_verified: false, name: 'x' };
  r = await googleRound();
  check('an unverified Google email never signs anyone in', !sessUser(r) && /autherr=unverified/.test(r.headers.location));
  provider.google = { email: 'a_b@x.com', email_verified: true, name: 'Wild Card' };
  r = await googleRound();
  check('"a_b@x.com" is NOT matched to "axb@x.com" (no wildcard takeover)', !sessUser(r) && /signup=1/.test(r.headers.location), r.headers.location);

  console.log('\npaused and two-factor accounts');
  provider.google = { email: 'p@x.com', email_verified: true, name: 'P' };
  r = await googleRound();
  check('paused workspace gets no session', !sessUser(r));
  var pending = cookieVal(r, 'orcha_pending');
  var w = await call(accounts, 'POST', {}, { action: 'whoami' }, 'orcha_pending=' + encodeURIComponent(pending));
  check('...and the app is told to show the renew screen', w.body.ok && w.body.paused === true && w.body.user.username === 'paused1');
  provider.google = { email: 'm@x.com', email_verified: true, name: 'M' };
  mail = [];
  r = await googleRound();
  check('two-factor account gets no session yet', !sessUser(r));
  check('...is sent to the code screen', /\/app\?mfa=mfa1$/.test(r.headers.location));
  var mrow = db.accounts.find(function (a) { return a.username === 'mfa1'; });
  check('...and the 6-digit code is emailed', mail.length === 1 && mail[0].subject.indexOf(mrow.mfa_code) > -1 && /^\d{6}$/.test(mrow.mfa_code));
  var v = await call(accounts, 'POST', {}, { action: 'mfaVerify', username: 'mfa1', code: mrow.mfa_code });
  check('the existing code screen finishes the sign-in', v.body.ok && sessUser(v) === 'mfa1');

  console.log('\nnew person signs up with Google');
  provider.google = { email: 'New.Person@Gmail.com', email_verified: true, name: 'New Person' };
  r = await googleRound();
  loc = new URL(r.headers.location);
  check('goes to signup with name and email filled in', loc.searchParams.get('signup') === '1' && loc.searchParams.get('email') === 'New.Person@Gmail.com' && loc.searchParams.get('name') === 'New Person');
  var sso = loc.searchParams.get('sso');
  var reg = await call(accounts, 'POST', {}, { action: 'register', company: 'New Co', name: 'New Person', email: 'attacker@evil.com', password: '', sso: sso });
  var made = db.accounts.find(function (a) { return a.company === 'New Co'; });
  check('account is created with no password typed', reg.body.ok === true && !!made, JSON.stringify(reg.body));
  check('the email is the one Google verified, even if the form was tampered with', made && made.profile.email === 'new.person@gmail.com');
  check('they are signed straight in', sessUser(reg) === (made && made.username));
  check('signup shows in your activity feed as Google', db.activity_log.some(function (a) { return a.type === 'signup' && /with Google/.test(a.detail); }));
  reg = await call(accounts, 'POST', {}, { action: 'register', company: 'X', email: 'x@x.com', sso: 'forged.token' });
  check('a forged signup token is refused', reg.body.ok === false && /expired/.test(reg.body.error));
  reg = await call(accounts, 'POST', {}, { action: 'register', company: 'Y', email: 'y@x.com', password: '123' });
  check('normal email signup still requires a 6+ character password', reg.body.ok === false);

  console.log('\nFacebook');
  provider.facebook = { id: '9', name: 'Gio', email: 'gioc249@gmail.com' };
  var fs1 = await call(oauth, 'GET', { provider: 'facebook', step: 'start' });
  check('sends the person to Facebook', new URL(fs1.headers.location).host === 'www.facebook.com');
  var fstate = new URL(fs1.headers.location).searchParams.get('state');
  r = await call(oauth, 'GET', { provider: 'facebook', step: 'callback', code: 'good', state: fstate }, null, 'orcha_oauth=' + cookieVal(fs1, 'orcha_oauth'));
  check('existing customer is signed in with Facebook', sessUser(r) === 'gioc249');
  var gstate = new URL((await call(oauth, 'GET', { provider: 'google', step: 'start' })).headers.location).searchParams.get('state');
  r = await call(oauth, 'GET', { provider: 'facebook', step: 'callback', code: 'good', state: gstate }, null, 'orcha_oauth=x');
  check('a Google return link cannot be replayed at Facebook', !sessUser(r));
  provider.facebook = { id: '9', name: 'No Email' };
  fs1 = await call(oauth, 'GET', { provider: 'facebook', step: 'start' });
  r = await call(oauth, 'GET', { provider: 'facebook', step: 'callback', code: 'good', state: new URL(fs1.headers.location).searchParams.get('state') }, null, 'orcha_oauth=' + cookieVal(fs1, 'orcha_oauth'));
  check('Facebook account with no email gets a clear message', /autherr=noemail/.test(r.headers.location));

  console.log('\nemail sign-in link');
  mail = [];
  r = await call(oauth, 'POST', {}, { action: 'sendLink', email: 'nobody@x.com' });
  var unknownMsg = r.body.message;
  check('unknown email: same answer, nothing sent (does not reveal who has an account)', r.body.ok && mail.length === 0);
  r = await call(oauth, 'POST', {}, { action: 'sendLink', email: 'GIOC249@gmail.com' });
  check('known email: same answer', r.body.message === unknownMsg);
  check('...and the link is emailed', mail.length === 1 && /step=link/.test(mail[0].text));
  r = await call(oauth, 'POST', {}, { action: 'sendLink', email: 'gioc249@gmail.com' });
  check('asking again within a minute does not send a second email', mail.length === 1);
  var link = new URL(/https:\/\/orchamind\.com\/api\/oauth\?[^\s]+/.exec(mail[0].text)[0]);
  var page = await call(oauth, 'GET', { step: 'link', u: link.searchParams.get('u'), n: link.searchParams.get('n') });
  check('opening the link shows a Sign in button', page.code === 200 && /Sign in<\/button>/.test(page.body));
  check('...and opening it does NOT sign in or spend it (Outlook link scanners)', !sessUser(page) && !!db.accounts.find(function (a) { return a.username === 'gioc249'; }).link_nonce);
  r = await call(oauth, 'POST', {}, 'action=useLink&u=' + link.searchParams.get('u') + '&n=' + link.searchParams.get('n'));
  check('tapping Sign in signs them in', sessUser(r) === 'gioc249' && /signedin=1/.test(r.headers.location), JSON.stringify([r.headers.location, sessUser(r), setCookies(r)]));
  r = await call(oauth, 'POST', {}, { action: 'useLink', u: link.searchParams.get('u'), n: link.searchParams.get('n') });
  check('the same link cannot be used twice', !sessUser(r) && /autherr=expired/.test(r.headers.location));
  r = await call(oauth, 'POST', {}, { action: 'useLink', u: 'gioc249', n: 'a'.repeat(48) });
  check('a guessed link is refused', !sessUser(r));
  db.accounts.find(function (a) { return a.username === 'gioc249'; }).link_exp = 0;
  await call(oauth, 'POST', {}, { action: 'sendLink', email: 'gioc249@gmail.com' });
  var row = db.accounts.find(function (a) { return a.username === 'gioc249'; }); var n2 = row.link_nonce; row.link_exp = Date.now() - 1;
  r = await call(oauth, 'POST', {}, { action: 'useLink', u: 'gioc249', n: n2 });
  check('an expired link is refused', !sessUser(r) && /autherr=expired/.test(r.headers.location));

  console.log('\nback in the app');
  r = await googleRound();
  provider.google = { email: 'gioc249@gmail.com', email_verified: true, name: 'Gio' };
  r = await googleRound();
  w = await call(accounts, 'POST', {}, { action: 'whoami' }, 'orcha_sess=' + encodeURIComponent(cookieVal(r, 'orcha_sess')));
  check('the app gets the same user details as a password login', w.body.ok && w.body.user.username === 'gioc249' && w.body.user.company === 'Alexander Tile' && w.body.user.role === 'owner');
  w = await call(accounts, 'POST', {}, { action: 'whoami' }, 'orcha_sess=gioc249|owner|9999999999999|forged');
  check('a forged session cookie is refused', w.body.ok === false);

  if (failures.length) { console.error('\n❌  sign-in FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
  console.log('✅  sign-in: Google, Facebook and email link are safe and land people in the right place.\n');
})();
