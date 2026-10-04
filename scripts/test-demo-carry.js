// The demo -> account carry-over must move ONLY what a visitor made, never the
// sample company. It used to move everything, because the function that records
// sample IDs was never called: 19 fake records landed in each new account and the
// onboarding checklist then ticked off "add a project / get an estimate / add your
// crew" for people who had done none of them.
//
// Runs the REAL seed definitions and carry-over functions extracted from
// demo.html, in the order a browser runs them.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
console.log('\ndemo carry-over');

// The seed block: from `var clients=[];` through the _OM_SEED_IDS snapshot.
var seedStart = html.indexOf('var clients=[];');
var seedEnd = html.indexOf('var _saveTimer=null;');
check('seed block located', seedStart > 0 && seedEnd > seedStart);
var seedBlock = html.slice(seedStart, seedEnd);
check('the snapshot is taken inside the seed block, before any restore', /var _OM_SEED_IDS=/.test(seedBlock));

var carryStart = html.indexOf("var _OM_CARRY = [");
var carryEnd = html.indexOf("/* Applied once, after the real workspace has finished loading. */");
check('carry-over block located', carryStart > 0 && carryEnd > carryStart);
var carryBlock = html.slice(carryStart, carryEnd);

function session() {
  var dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://orchamind.com/demo' });
  var w = dom.window;
  w.eval(seedBlock.replace(/^var /gm, 'window.').replace(/\nvar /g, '\nwindow.'));
  w.eval(carryBlock);
  return w;
}

// 1. visitor made nothing
var w = session();
var seedJobs = w.eval('jobs.length'), seedEst = w.eval('estimates.length');
check('sample company is present in the demo (' + seedJobs + ' jobs, ' + seedEst + ' estimates)', seedJobs > 0 && seedEst > 0);
check('a visitor who made nothing carries NOTHING', w.eval('omStageDemoCarry()') === 0,
  'staged ' + w.eval('omStageDemoCarry()'));
check('nothing is written to the carry slot', w.eval('localStorage.getItem("om_demo_carry")') === null);

// 2. visitor made one estimate and one lead, and edited nothing else
w = session();
w.eval('estimates.push({id:"e"+Date.now(),client:"Real Customer",project:"My Kitchen",items:[]});');
w.eval('leads.push({id:"ld"+Date.now(),name:"A real lead"});');
var n = w.eval('omStageDemoCarry()');
check('exactly the 2 records the visitor made are carried', n === 2, 'carried ' + n);
var carried = JSON.parse(w.eval('localStorage.getItem("om_demo_carry")') || '{}');
check('the visitor\'s estimate is carried', (carried.estimates || []).some(function (e) { return e.client === 'Real Customer'; }));
check('no sample job is carried', !(carried.jobs || []).length);
check('no sample estimate is carried', !(carried.estimates || []).some(function (e) { return /Bennetts|Reynolds|Castellano/.test(e.client || ''); }));

// 3. even with the legacy localStorage seed list missing or corrupt
w = session();
w.eval('localStorage.setItem("om_demo_seed","{not json");');
w.eval('estimates.push({id:"e"+Date.now(),client:"Mine"});');
check('a corrupt legacy seed list does not let sample data through', w.eval('omStageDemoCarry()') === 1);

var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
check('demo.html and demo-test.html are identical', html === test);

if (failures.length) {
  console.error('\n❌  demo carry-over FAILED:\n'); failures.forEach(function (f) { console.error('   • ' + f); }); process.exit(1);
}
console.log('✅  demo carry-over: only what the visitor made moves into their account.\n');
