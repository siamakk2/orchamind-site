// Runs the real api/outreach.js handler against a fake Supabase and a fake
// Resend, so we know exactly who would be emailed before anything goes live.

var crypto = require('crypto');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.RESEND_API_KEY = 're_test';
process.env.OUTREACH_CRON_KEY = 'cron-test';
var handler = require('../api/outreach.js');

var DAY = 864e5, NOW = Date.now();
function iso(d) { return new Date(NOW + d * DAY).toISOString(); }
var db;
function reset() {
  db = {
    accounts: [
      { username: 'siamakk2', name: 'Siamak', company: 'Orchamind', created_at: iso(-90), trial_end: iso(-50), stripe_status: 'paused', no_outreach: true, profile: { email: '' } },
      { username: 'heiserhac', name: 'Dusty heiser', company: 'Heiser heating', created_at: iso(-23), trial_end: iso(6.6), stripe_status: 'trialing', no_outreach: false, profile: { email: 'heiserhac@hotmail.com' } },
      { username: 'raymabadi', name: 'Reza Mabadi', company: 'Archscape', created_at: iso(-6), trial_end: iso(23), stripe_status: 'trialing', no_outreach: false, profile: { email: 'raymabadi@gmail.com' } },
      { username: 'gioc249', name: 'Gio Chavez', company: 'Alexander Custom Tile & Stone', created_at: iso(-2), trial_end: iso(28), stripe_status: 'trialing', no_outreach: false, profile: { email: 'gioc249@gmail.com' } },
      { username: 'mattministri', name: 'Matt', company: 'Matt', created_at: iso(-26), trial_end: iso(4), stripe_status: 'trialing', no_outreach: true, profile: { email: 'm@x.com' } },
      { username: 'oberonsky', name: 'Hesham Laz', company: 'Apex', created_at: iso(-59), trial_end: iso(-29), stripe_status: 'paused', no_outreach: false, profile: { email: 'hesham.laz@outlook.com' } },
      { username: 'payer', name: 'Pat', company: 'Paid Co', created_at: iso(-40), trial_end: iso(-10), stripe_status: 'active', no_outreach: false, profile: { email: 'p@x.com' } }
    ],
    outreach_log: [], app_data: [], activity_log: [], sent: []
  };
}
global.fetch = async function (url, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  function json(x) { return { ok: true, json: async function () { return x; }, text: async function () { return JSON.stringify(x); } }; }
  if (url.indexOf('api.resend.com') > -1) { db.sent.push(JSON.parse(opts.body)); return json({ id: 'x' }); }
  var u = new URL(url), table = u.pathname.split('/').pop();
  var eq = {}; u.searchParams.forEach(function (v, k) { if (/^eq\./.test(v)) eq[k] = v.slice(3); });
  if (method === 'GET') {
    var rows = (db[table] || []).filter(function (r) { return Object.keys(eq).every(function (k) { return String(r[k]) === eq[k]; }); });
    return json(rows);
  }
  if (method === 'PATCH') { db[table].forEach(function (r) { if (Object.keys(eq).every(function (k) { return String(r[k]) === eq[k]; })) Object.assign(r, JSON.parse(opts.body)); }); return json([]); }
  if (method === 'POST') {
    var row = JSON.parse(opts.body);
    if (table === 'outreach_log') {
      db.outreach_log = db.outreach_log.filter(function (l) { return !(l.username === row.username && l.kind === row.kind && l.trial_end === row.trial_end); });
      row.created_at = new Date().toISOString();
    }
    db[table].push(row); return json([]);
  }
  return json([]);
};
function call(method, query, body, cookie) {
  return new Promise(function (resolve) {
    var res = { code: 200, headers: {}, setHeader: function (k, v) { this.headers[k] = v; }, status: function (c) { this.code = c; return this; },
      json: function (x) { resolve({ code: this.code, body: x }); }, send: function (x) { resolve({ code: this.code, body: x }); } };
    handler({ method: method, query: query || {}, body: body, headers: { cookie: cookie || '' } }, res);
  });
}
function adminCookie(user) {
  var p = (user || 'siamakk2') + '|owner|' + (Date.now() + 1e6);
  return 'orcha_sess=' + encodeURIComponent(p + '|' + crypto.createHmac('sha256', 'test-key').update(p).digest('hex'));
}

(async function () {
  console.log('\ndaily automation');
  reset();
  var r = await call('GET', { run: '1', key: 'wrong' });
  check('wrong key is refused', r.code === 401);
  r = await call('GET', { dry: '1', key: 'cron-test' });
  var plan = {}; (r.body.results || []).forEach(function (x) { plan[x.username] = x.kind; });
  check('dry run sends nothing', db.sent.length === 0);
  check('Dusty (7 days left) is due the 1-week check-in', plan.heiserhac === 'checkin', JSON.stringify(plan));
  check('Reza (day 6) is due the getting-started note', plan.raymabadi === 'welcome');
  check('Gio (day 2) is not due yet', !plan.gioc249);
  check('Hesham (ended 29 days ago) is due the feedback note', plan.oberonsky === 'winback');
  check('Matt (switched off) is never emailed', !plan.mattministri);
  check('paying customer is never emailed', !plan.payer);
  check('the admin account is never emailed', !plan.siamakk2);

  r = await call('GET', { run: '1', key: 'cron-test' });
  check('real run sends exactly the 3 due notes', db.sent.length === 3, db.sent.length + ' sent');
  var toDusty = db.sent.find(function (m) { return m.to[0] === 'heiserhac@hotmail.com'; }) || {};
  check('email is from Siamak, replies go to Siamak', /Siamak/.test(toDusty.from) && toDusty.reply_to === 'siamakk2@gmail.com');
  check('Siamak gets a copy', (toDusty.bcc || [])[0] === 'siamakk2@gmail.com');
  check('the unsubscribe header is set', /unsub=heiserhac/.test((toDusty.headers || {})['List-Unsubscribe'] || ''));
  check('each send is logged', db.outreach_log.filter(function (l) { return l.status === 'sent'; }).length === 3);
  check('each send shows in the activity feed', db.activity_log.filter(function (a) { return a.type === 'outreach'; }).length === 3);

  r = await call('GET', { run: '1', key: 'cron-test' });
  check('running again the same day sends nothing more', db.sent.length === 3, db.sent.length + ' sent');

  console.log('\nunsubscribe');
  r = await call('GET', { unsub: 'raymabadi', s: 'forged' });
  check('a forged unsubscribe link changes nothing', r.code === 400 && !db.accounts.find(function (a) { return a.username === 'raymabadi'; }).no_outreach);
  var link = /unsub=raymabadi&s=([a-f0-9]+)/.exec(db.sent.find(function (m) { return m.to[0] === 'raymabadi@gmail.com'; }).text)[1];
  r = await call('GET', { unsub: 'raymabadi', s: link });
  check('the link in the email turns their emails off', r.code === 200 && db.accounts.find(function (a) { return a.username === 'raymabadi'; }).no_outreach === true);

  console.log('\nadmin panel');
  r = await call('POST', {}, { action: 'queue' }, '');
  check('not logged in: refused', r.body.ok === false);
  r = await call('POST', {}, { action: 'queue' }, adminCookie('heiserhac'));
  check('a customer cannot see the queue', r.body.ok === false);
  r = await call('POST', {}, { action: 'queue' }, adminCookie());
  check('admin sees the queue', r.body.ok === true && r.body.rows.length === 6);
  r = await call('POST', {}, { action: 'preview', username: 'gioc249', kind: 'welcome' }, adminCookie());
  check('preview returns the letter without sending', r.body.ok && /Gio/.test(r.body.html) && db.sent.length === 3);
  r = await call('POST', {}, { action: 'send', username: 'mattministri', kind: 'checkin' }, adminCookie());
  check('send-now respects "emails off"', r.body.ok === false && db.sent.length === 3);
  r = await call('POST', {}, { action: 'send', username: 'gioc249', kind: 'welcome' }, adminCookie());
  check('send-now sends one email', r.body.ok === true && db.sent.length === 4);
  r = await call('GET', { dry: '1', key: 'cron-test' });
  check('the automation will not repeat what admin just sent', !(r.body.results || []).some(function (x) { return x.username === 'gioc249'; }));

  if (failures.length) { console.error('\n❌  outreach API FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
  console.log('✅  outreach API: the right people, once, with a working way out.\n');
})();
