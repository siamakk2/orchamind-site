// Funnel tracking: fires for real customers, never for the operator, crew,
// demo or support view, and wraps the real functions without changing what
// they return. The block is extracted from demo.html, not copied.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
var m = html.match(/\/\* ---- Funnel: where do trial users actually go[\s\S]*?\n\}\)\(\);\n/);
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
console.log('\nfunnel tracking');
check('funnel block is present in demo.html', !!m);
if (!m) { console.error('cannot continue'); process.exit(1); }

function boot(opts) {
  var dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://orchamind.com/app' });
  var w = dom.window;
  w.eval('var IS_REAL_APP=' + (opts.real !== false) + ';');
  w.eval('window.SUPPORT_VIEW=' + (!!opts.support) + ';');
  w.eval('function isAdmin(){return ' + (!!opts.admin) + ';}');
  w.eval('function isCrew(){return ' + (!!opts.crew) + ';}');
  w.eval('var _events=[];function logEvent(t,d){_events.push([t,d]);}');
  w.eval('var _planStaged=[{},{}];var _planDraft=null;window._planExtracted={totalPrintedSqft:1};');
  w.eval('function goTab(n){return "went:"+n;}');
  w.eval('function _planAnalyzeStaged(){return "analyzing";}');
  w.eval('function _planApply(text){ if(text==="good"){ window._planDraft={items:[1,2,3]}; } return "applied"; }');
  w.eval(m[0]);
  return w;
}

// real customer
var w = boot({});
check('wrapped goTab still returns the original result', w.eval('goTab("estimates")') === 'went:estimates');
w.eval('goTab("estimates"); goTab("jobs");');
var views = w.eval('_events.filter(function(e){return e[0]==="view"})');
check('each screen is logged once per session, not every click', views.length === 2, JSON.stringify(views));
check('the screen name is recorded', views.some(function (e) { return e[1] === 'estimates'; }));

check('plan read start is logged with file count', (w.eval('_planAnalyzeStaged()') === 'analyzing') &&
  w.eval('_events.some(function(e){return e[0]==="plan_read_start"&&/2 file/.test(e[1])})'));
check('wrapped _planApply still returns the original result', w.eval('_planApply("good")') === 'applied');
check('a successful read logs plan_read_ok with item count',
  w.eval('_events.some(function(e){return e[0]==="plan_read_ok"&&/^3 items/.test(e[1])})'));
check('it records whether the transcription reached the takeoff',
  w.eval('_events.some(function(e){return e[0]==="plan_read_ok"&&/with transcription/.test(e[1])})'));
w.eval('_planApply("bad")');
check('a failed read logs plan_read_fail', w.eval('_events.some(function(e){return e[0]==="plan_read_fail"})'));

// people who must never be counted
[['operator', { admin: true }], ['crew', { crew: true }], ['support view', { support: true }], ['demo mode', { real: false }]]
  .forEach(function (c) {
    var x = boot(c[1]);
    x.eval('goTab("estimates"); _planAnalyzeStaged(); _planApply("good");');
    check('nothing is logged for ' + c[0], x.eval('_events.length') === 0, x.eval('JSON.stringify(_events)'));
  });

var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
check('demo.html and demo-test.html are identical', html === test);

if (failures.length) {
  console.error('\n❌  funnel FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1);
}
console.log('✅  funnel: real customers counted, we are not.\n');
