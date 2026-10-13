// Login screen: Google/Facebook buttons appear only when switched on, people
// coming back from Google land in the right place, and the email link form
// works. Real markup and functions from demo.html.

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
console.log('\nlogin screen');
var a = html.indexOf('<div id="authWrap"'), b = html.indexOf('<div class="topbar">');
var authHtml = html.slice(a, b);
check('auth screen markup found', a > 0 && b > a);
var names = ['bootAuth', 'loadSsoButtons', 'ssoStart', '_ssoClean', 'ssoReturn', 'sendSignInLink', 'showForm', 'authErr', 'authRegister'];
var parts = names.map(fn);
check('all sign-in functions found', parts.every(Boolean), names.filter(function (n, i) { return !parts[i]; }).join(','));
var errMap = (html.match(/var _SSO_ERR=\{[^\n]*\};/) || [])[0];
check('friendly error messages defined', !!errMap);

function tick() { return new Promise(function (r) { setTimeout(r, 30); }); }
function boot(cfg, search) {
  var dom = new JSDOM('<!doctype html><body>' + authHtml + '</body>', { runScripts: 'outside-only', url: 'https://orchamind.com/app' + (search || '') });
  var w = dom.window;
  w.__cfg = cfg;
  w.eval('var CURRENT_USER=null, _posts=[], _entered=false, _wall=null; function enterApp(){_entered=true;} function showRenewWall(u){_wall=u;} function omStageDemoCarry(){} function demoEnter(){}');
  w.eval('window.fetch=function(u,o){ var b=o&&o.body?JSON.parse(o.body):null; _posts.push({u:u,b:b}); var r;'
    + ' if(/config=1/.test(u)) r=window.__cfg;'
    + ' else if(b&&b.action==="whoami") r=window.__who||{ok:true,user:{username:"gioc249",name:"Gio",role:"owner",company:"Alexander Tile"}};'
    + ' else if(b&&b.action==="sendLink") r={ok:true,message:"If that email has an Orchamind account, a sign-in link is on its way."};'
    + ' else if(b&&b.action==="register") r={ok:true,user:{username:"newco",role:"owner"}};'
    + ' else if(b&&b.action==="status") r={ok:true,hasUsers:true};'
    + ' else r={ok:true}; return Promise.resolve({json:function(){return Promise.resolve(r);}}); };');
  w.eval(errMap);
  parts.forEach(function (p) { w.eval(p); });
  return w;
}
function shown(w, sel) { return Array.prototype.every.call(w.document.querySelectorAll(sel), function (e) { return e.style.display === 'flex'; }); }
function hidden(w, sel) { return Array.prototype.every.call(w.document.querySelectorAll(sel), function (e) { return e.style.display === 'none'; }); }

(async function () {
  var w = boot({ ok: true, google: false, facebook: false, emailLink: true });
  w.eval('loadSsoButtons()'); await tick();
  check('no keys: Google, Facebook and the "or" divider stay hidden', hidden(w, '.sso-g') && hidden(w, '.sso-f') && hidden(w, '.sso-or'));
  w = boot({ ok: true, google: true, facebook: false });
  w.eval('loadSsoButtons()'); await tick();
  check('Google on, Facebook off: only Google shows, on login AND signup', w.document.querySelectorAll('.sso-g').length === 2 && shown(w, '.sso-g') && hidden(w, '.sso-f') && shown(w, '.sso-or'));
  check('buttons say "Continue with Google" and "Sign up with Google"', /Continue with Google/.test(authHtml) && /Sign up with Google/.test(authHtml) && /Continue with Facebook/.test(authHtml));

  w = boot({ ok: true }, '?signedin=1');
  check('back from Google: takes over the screen', w.eval('ssoReturn(new URLSearchParams(location.search))') === true); await tick();
  check('...asks the server who signed in and opens the app', w.eval('_entered') === true && w.eval('CURRENT_USER.username') === 'gioc249');
  check('...remembers them for this tab like a password login', JSON.parse(w.sessionStorage.getItem('hci_session')).username === 'gioc249');
  check('...and cleans the address bar', w.location.search === '');

  w = boot({ ok: true }, '?signedin=1');
  w.__who = { ok: true, paused: true, user: { username: 'p', paused: true, portalUrl: 'https://billing' } };
  w.eval('ssoReturn(new URLSearchParams(location.search))'); await tick();
  check('paused account: renew screen, not the app', w.eval('_entered') === false && w.eval('_wall&&_wall.username') === 'p');

  w = boot({ ok: true }, '?mfa=mfa1');
  w.eval('ssoReturn(new URLSearchParams(location.search))');
  check('two-factor account: code screen opens', w.document.getElementById('formMfa').style.display === 'block' && w.eval('window._mfaUser') === 'mfa1');
  w.eval('showForm("formLogin")');
  check('going back hides the code screen (it used to stay on screen)', w.document.getElementById('formMfa').style.display === 'none');

  w = boot({ ok: true }, '?autherr=cancelled');
  w.eval('ssoReturn(new URLSearchParams(location.search))');
  check('cancelled at Google: login screen with a plain message', w.document.getElementById('formLogin').style.display === 'block' && /cancelled/.test(w.document.getElementById('authError').textContent));

  w = boot({ ok: true }, '?signup=1&sso=TOKEN123&email=new%40x.com&name=New%20Person');
  w.eval('ssoReturn(new URLSearchParams(location.search))');
  var em = w.document.getElementById('suEmail');
  check('new person: signup form with name and email filled in', w.document.getElementById('formSignup').style.display === 'block' && em.value === 'new@x.com' && w.document.getElementById('suName').value === 'New Person');
  check('...email is locked to what Google verified', em.readOnly === true);
  check('...no password box to fill', w.document.getElementById('suPass').parentNode.style.display === 'none');
  w.document.getElementById('suCompany').value = 'New Co';
  w.eval('authRegister()'); await tick();
  var reg = w.eval('JSON.stringify(_posts.filter(function(p){return p.b&&p.b.action==="register"})[0].b)');
  check('..."Create my free account" works with only the company name', /"sso":"TOKEN123"/.test(reg) && /"company":"New Co"/.test(reg) && w.eval('_entered') === true, reg);

  w = boot({ ok: true });
  w.eval('showForm("formLink")');
  check('email link form opens', w.document.getElementById('formLink').style.display === 'block');
  w.document.getElementById('lkEmail').value = 'not-an-email';
  w.eval('sendSignInLink()');
  check('bad address: says so, sends nothing', /Enter the email/.test(w.document.getElementById('lkMsg').textContent) && w.eval('_posts.length') === 0);
  w.document.getElementById('lkEmail').value = 'gio@x.com';
  w.eval('sendSignInLink()'); await tick();
  check('good address: sends and says to check email', /sign-in link is on its way/.test(w.document.getElementById('lkMsg').textContent));

  console.log('\nstartup');
  check('the real startup uses bootAuth (it used to be dead code)', /if\(isApp\)\{ bootAuth\(\); return; \}/.test(html));
  w = boot({ ok: true }, '?signup=1&ref=gioc249');
  w.eval('bootAuth()');
  check('website "Start free" link (/app?signup=1) opens SIGNUP, not login', w.document.getElementById('formSignup').style.display === 'block' && w.document.getElementById('formLogin').style.display === 'none');
  check('...with a signup headline', w.document.getElementById('authSubtitle').textContent === 'Start your free month');
  check('...and the referral code is kept', w.eval('window._REFCODE') === 'gioc249');
  w = boot({ ok: true }, '?app=1');
  w.eval('bootAuth()'); await tick();
  check('plain /app opens the login form', w.document.getElementById('formLogin').style.display === 'block');
  w = boot({ ok: true }, '?app=1');
  w.sessionStorage.setItem('hci_session', JSON.stringify({ username: 'gioc249', role: 'owner' }));
  w.eval('bootAuth()');
  check('already signed in this tab: straight into the app', w.eval('_entered') === true);
  w = boot({ ok: true }, '?signedin=1');
  w.sessionStorage.setItem('hci_session', JSON.stringify({ username: 'olduser', role: 'owner' }));
  w.eval('bootAuth()'); await tick();
  check('back from Google beats an older saved login in the same tab', w.eval('CURRENT_USER.username') === 'gioc249');

  var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
  check('demo.html and demo-test.html are identical', html === test);
  if (failures.length) { console.error('\n❌  login screen FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
  console.log('✅  login screen: buttons, come-backs and email link all land in the right place.\n');
})();
