// The admin "Trial check-in emails" panel: renders the queue, previews a letter
// in a sandboxed frame, and only sends after a confirm. Real functions from demo.html.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');
var html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
function fn(name) { var m = html.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}')); return m ? m[0] : ''; }

console.log('\nadmin check-in panel');
check('panel markup is on the admin page', /id="outreachCard"/.test(html) && /id="outreachTable"/.test(html));
check('loadUsers also loads the check-ins', /if\(typeof loadOutreach==='function'\) loadOutreach\(\);/.test(html));
var names = ['_oPost', 'loadOutreach', 'renderOutreach', '_oKind', 'outreachPreview', 'outreachSend', 'outreachOptout'];
var parts = names.map(function (n) { return html.match(new RegExp('function ' + n + '\\([^)]*\\)\\{[^\\n]*\\}\\n|function ' + n + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}')); });
check('all panel functions found', parts.every(Boolean), names.filter(function (n, i) { return !parts[i]; }).join(','));

var DAY = 864e5, now = Date.now();
var queue = { ok: true, labels: { welcome: 'Getting started', checkin: '1 week left', ending: 'Ends in 2 days', winback: 'Feedback after trial' }, rows: [
  { username: 'heiserhac', name: 'Dusty heiser', company: 'Heiser heating', email: 'heiserhac@hotmail.com', trial_end: new Date(now + 6.6 * DAY).toISOString(), stripe_status: 'trialing', no_outreach: false, usage: { total: 0 }, due: 'checkin', suggest: 'checkin', log: [] },
  { username: 'oberonsky', name: 'Hesham Laz', company: 'Apex', email: 'h@x.com', trial_end: new Date(now - 29 * DAY).toISOString(), stripe_status: 'paused', no_outreach: false, usage: { total: 0 }, due: 'winback', suggest: 'winback', log: [] },
  { username: 'mattministri', name: 'Matt', company: 'Matt <b>x</b>', email: 'm@x.com', trial_end: new Date(now + 4 * DAY).toISOString(), stripe_status: 'trialing', no_outreach: true, usage: { total: 2, jobs: 2 }, due: null, suggest: 'checkin', log: [{ kind: 'welcome', status: 'sent', sent_at: '2026-09-20T16:00:00Z' }] },
  { username: 'payer', name: 'P', company: 'Paid Co', email: 'p@x.com', trial_end: new Date(now - 5 * DAY).toISOString(), stripe_status: 'active', usage: { total: 9 }, log: [] },
  { username: 'old', name: 'O', company: 'Long Gone', email: 'o@x.com', trial_end: new Date(now - 90 * DAY).toISOString(), stripe_status: 'paused', usage: { total: 0 }, log: [] }
] };

var dom = new JSDOM('<!doctype html><body><div id="outreachTable"></div><div id="outreachPreview" style="display:none"></div></body>', { runScripts: 'outside-only' });
var w = dom.window;
w.eval('function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}');
w.eval('var _posts=[]; var _confirm=false; window.confirm=function(){return _confirm;}; window.alert=function(){};');
w.__queue = queue;
w.eval('window.fetch=function(u,o){var b=JSON.parse(o.body);_posts.push(b);var r=b.action==="queue"?window.__queue:(b.action==="preview"?{ok:true,to:"heiserhac@hotmail.com",subject:"How is Orchamind working?",html:"<p>Hi Dusty</p>"}:{ok:true});return Promise.resolve({json:function(){return Promise.resolve(r);}});};');
parts.forEach(function (p) { w.eval(p[0]); });

function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }
(async function () {
  w.eval('loadOutreach()'); await tick();
  var t = w.document.getElementById('outreachTable').innerHTML;
  check('shows trials and recently ended trials', /Heiser heating/.test(t) && /Apex/.test(t));
  check('hides paying customers', !/Paid Co/.test(t));
  check('hides trials that ended over 60 days ago', !/Long Gone/.test(t));
  check('soonest-ending trial is listed first', t.indexOf('Heiser') < t.indexOf('Apex'));
  check('says what the next automatic run will send', /Next run: 1 week left/.test(t));
  check('flags people who have not used the product', /nothing yet/.test(t));
  check('shows switched-off accounts and offers to turn back on', /Emails off/.test(t) && /Turn emails on/.test(t));
  check('no Send button for switched-off accounts', !/onclick="outreachSend\('mattministri'\)"/.test(t));
  check('shows emails already sent', /Getting started · 09-20/.test(t));
  check('company names are escaped', /Matt &lt;b&gt;x&lt;\/b&gt;/.test(t));
  check('the kind picker defaults to the suggested note', w.document.getElementById('oKind_oberonsky').value === 'winback');

  w.eval('outreachPreview("heiserhac")'); await tick();
  var pv = w.document.getElementById('outreachPreview');
  check('preview opens with recipient and subject', pv.style.display === 'block' && /heiserhac@hotmail.com/.test(pv.innerHTML) && /How is Orchamind working/.test(pv.innerHTML));
  check('preview renders inside a sandboxed frame', w.document.getElementById('oFrame').getAttribute('sandbox') === '');

  var before = w.eval('_posts.filter(function(p){return p.action==="send"}).length');
  w.eval('outreachSend("heiserhac")'); await tick();
  check('Send does nothing if you cancel the confirm', w.eval('_posts.filter(function(p){return p.action==="send"}).length') === before);
  w.eval('_confirm=true; outreachSend("heiserhac")'); await tick();
  var sends = w.eval('JSON.stringify(_posts.filter(function(p){return p.action==="send"}))');
  check('Send after confirm posts the chosen note', /"username":"heiserhac","kind":"checkin"/.test(sends), sends);

  var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
  check('demo.html and demo-test.html are identical', html === test);

  if (failures.length) { console.error('\n❌  outreach panel FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
  console.log('✅  outreach panel: see who is due, preview, send on confirm.\n');
})();
