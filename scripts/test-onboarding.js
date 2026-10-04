// First login: a brand-new customer must be pointed at the one thing that shows
// what Orchamind does -- drop a plan, get an estimate -- and the button must
// actually open the plan picker. Uses the real functions from demo.html.

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

console.log('\nfirst-login onboarding');
var parts = ['renderOnboarding', '_obState', 'obStartPlanEstimate', 'obStartTextEstimate'].map(fn);
check('all onboarding functions found in demo.html', parts.every(Boolean));

function boot(state) {
  var dom = new JSDOM('<!doctype html><body><div id="obCard"></div><div id="obRestore"></div>'
    + '<input type="file" id="estPlanFile"><textarea id="estAiScope"></textarea></body>',
    { runScripts: 'outside-only', url: 'https://orchamind.com/app' });
  var w = dom.window;
  w.eval('var IS_REAL_APP=true; var CURRENT_USER={name:"Gio Alexander",profile:{}};');
  w.eval('var jobs=' + JSON.stringify(state.jobs || []) + ', crew=[], logs=[], estimates=' + JSON.stringify(state.estimates || []) + ';');
  w.eval('function esc(s){return String(s);} function isCrew(){return false;}');
  w.eval('var _calls=[]; function goTab(t){_calls.push("tab:"+t);} function newEstimate(){_calls.push("newEstimate");} function _omTrack(t,d){_calls.push("track:"+d);}');
  w.eval('document.getElementById("estPlanFile").click=function(){_calls.push("filepicker");};');
  parts.forEach(function (p) { w.eval(p); });
  // renderOnboarding finds its container by id; give it the one the app uses.
  var cid = (html.match(/function renderOnboarding\(\)\{[\s\S]{0,300}?getElementById\('([a-zA-Z]+)'\)/) || [])[1];
  if (cid && cid !== 'obCard') w.document.getElementById('obCard').id = cid;
  w.eval('renderOnboarding()');
  return { w: w, card: w.document.getElementById(cid || 'obCard') };
}

var fresh = boot({});
var h = fresh.card.innerHTML;
check('a fresh account sees the plan-upload hero', /Start here: your first estimate/.test(h));
check('the hero promises a realistic time, not "instant"', /about 3 minutes/.test(h));
check('the first checklist step is the plan estimate', h.indexOf('Drop a floor plan') > -1 && h.indexOf('Drop a floor plan') < h.indexOf('Add one project'));
check('the old "finish these 6 quick steps" chore list is gone', !/Finish these/.test(h));
check('there is a fallback for people without plans', /Describe a job instead/.test(h));

fresh.w.eval('obStartPlanEstimate()');
var calls = fresh.w.eval('_calls');
check('Upload opens the estimates screen', calls.indexOf('tab:estimates') > -1);
check('Upload opens a new estimate', calls.indexOf('newEstimate') > -1);
check('Upload opens the plan file picker in the same click', calls.indexOf('filepicker') > -1);
check('the click is tracked in the funnel', calls.indexOf('track:upload plan') > -1);

var done = boot({ estimates: [{ id: 'e' + Date.now(), client: 'Real' }] });
check('once they have an estimate, the hero steps aside', !/Start here: your first estimate/.test(done.card.innerHTML));

var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
check('demo.html and demo-test.html are identical', html === test);

if (failures.length) { console.error('\n❌  onboarding FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1); }
console.log('✅  onboarding: new customers are sent straight to their first estimate.\n');
