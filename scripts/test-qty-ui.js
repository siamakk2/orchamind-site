// Wiring checks for the computed-quantities panel.
//
// The engine has its own 33 tests. This file answers a different question: is it
// actually connected, and can it hurt the estimate? Today proved that a correct
// function wired wrongly is indistinguishable from a broken product.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
var failures = [];
function check(name, cond, detail) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (detail ? ' — ' + detail : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}

console.log('\nquantity panel wiring');

check('demo.html loads the quantity engine',
  /<script src="\/lib\/takeoff-quantities\.js"><\/script>/.test(html));
check('the panel exists in the markup', /id="estPlanQty"/.test(html));
check('it is cleared between runs', /_epq\s*=\s*document\.getElementById\('estPlanQty'\)/.test(html));
check('it renders after the estimate is applied',
  /_planRenderCompliance\(obj\.complianceFlags\|\|\[\]\);[\s\S]{0,400}_planRenderQuantities\(\)/.test(html));

// The safety property that matters most.
check('the call is wrapped so it can never break the estimate',
  /try\{ _planRenderQuantities\(\); \}catch\(e\)\{/.test(html));
check('it renders AFTER the line items, so a failure cannot prevent them',
  html.indexOf('_planRenderQuantities()') > html.indexOf('_planRenderCompliance(obj.complianceFlags'));

check('it degrades silently when the engine did not load',
  /if\(!window\.OrchaQuantities\) return;/.test(html));
check('it degrades silently when there is no transcription',
  /var e=window\._planExtracted; if\(!e\) return;/.test(html));

// Honesty of the panel itself.
check('the panel says the numbers are calculated, not written by the AI',
  /calculated from the printed dimensions, not written by the AI/.test(html));
check('it claims repeatability, which is the actual product promise',
  /Same drawing always gives the same numbers/.test(html));
check('assumptions are shown separately from computed values',
  /Assumed, because it was not printed/.test(html));
check('gaps are named rather than hidden',
  /the drawing did not print what these need/.test(html));
check('each line shows the formula that produced it', /i\.formula/.test(html));

// Live render against the real engine.
var dom = new JSDOM('<!doctype html><html><body><div id="estPlanQty"></div></body></html>', { runScripts: 'outside-only' });
var win = dom.window;
win.eval(fs.readFileSync(path.join(ROOT, 'lib', 'takeoff-quantities.js'), 'utf8'));
check('engine attaches to window for the browser', typeof win.OrchaQuantities === 'object');

win.eval('function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}');
var fn = html.match(/function _planRenderQuantities\(\)\{[\s\S]*?\n\}/);
check('renderer is present in demo.html', !!fn);
if (fn) {
  win.eval(fn[0]);
  var el = win.document.getElementById('estPlanQty');

  // no transcription -> nothing, and no crash
  win._planExtracted = null;
  win.eval('_planRenderQuantities()');
  check('no transcription renders nothing', el.innerHTML === '');

  // a full transcription -> real numbers
  win._planExtracted = {
    totalPrintedSqft: 2486, stories: 2, storyHeightFt: 9,
    overallDims: { widthFt: 42, depthFt: 34 },
    roof: { form: 'gable', pitch: '6:12' },
    areaSchedule: [{ label: 'MAIN FLOOR', sqft: 1312 }, { label: 'UPPER FLOOR', sqft: 1174 },
                   { label: 'GARAGE', sqft: 484 }, { label: 'COVERED PORCH', sqft: 168 }],
    windowSchedule: [{ mark: 'A', size: '3050', count: 20 }]
  };
  win.eval('_planRenderQuantities()');
  check('a full transcription renders the panel', /Computed from the drawing/.test(el.innerHTML));
  check('concrete appears with a half-yard rounded figure', /19<\/b>\s*CY/.test(el.innerHTML));
  check('roofing appears in squares', /18<\/b>\s*SQ/.test(el.innerHTML));
  check('a formula is shown beside the numbers', /pitch factor/.test(el.innerHTML));

  // a partial transcription -> gaps named, no invented numbers
  win._planExtracted = { totalPrintedSqft: 2486 };
  win.eval('_planRenderQuantities()');
  check('a thin transcription still renders without throwing', el.innerHTML.length > 0);
  check('it names what it could not compute', /did not print what these need/.test(el.innerHTML));
  check('it does not invent a concrete quantity from nothing', !/Slab on grade[\s\S]{0,120}<b>\d/.test(el.innerHTML));

  // garbage in -> no crash
  win._planExtracted = { totalPrintedSqft: 'x', stories: {}, areaSchedule: 'nope', overallDims: 7 };
  var threw = false;
  try { win.eval('_planRenderQuantities()'); } catch (e) { threw = true; }
  check('malformed transcription does not throw', !threw);
}

var test = fs.readFileSync(path.join(ROOT, 'demo-test.html'), 'utf8');
check('demo.html and demo-test.html are identical', html === test);

if (failures.length) {
  console.error('\n❌  quantity panel FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  quantity panel: wired, guarded, and honest about gaps.\n');
