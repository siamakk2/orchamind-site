// Drives the REAL demo.html in jsdom and checks the cross-check panel renders
// what the module computed. The unit tests prove the logic; this proves the
// logic is actually wired to something a contractor can see. We have shipped a
// correct function behind a collapsed div before.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');

var ROOT = path.join(__dirname, '..');
var failures = [];
function check(name, cond, detail) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (detail ? ' — ' + detail : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}

console.log('\ncrosscheck UI wiring');

var html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');

// --- static wiring, checked before we boot anything ------------------------
check('demo.html loads the shared cross-check module',
  /<script src="\/lib\/plan-crosscheck\.js"><\/script>/.test(html));
check('the panel the renderer writes into exists in the markup',
  /id="estPlanXCheck"/.test(html));
check('the transcription pass is fired twice',
  (html.match(/callClaudeBlocks\(_planExtractSys\(\)/g) || []).length === 2,
  'found ' + (html.match(/callClaudeBlocks\(_planExtractSys\(\)/g) || []).length);
check('the two readers use different model tiers',
  /_planExtractSys\(\)[\s\S]{0,400}?'deep'\)/.test(html) && /_planExtractSys\(\)[\s\S]{0,400}?'std'\)/.test(html));
check('a failed second read still settles the flow',
  /function\(\)\{ _xcSecond=null; _xcSettle\(\); \}/.test(html));
check('a failed primary read fails loudly rather than proceeding',
  /if\(!_xcPrimary\)\{ fail\(/.test(html));
check('the cross-check result is cleared between runs',
  /window\._planCrossCheck=null/.test(html));

// --- live render -----------------------------------------------------------
var dom = new JSDOM('<!doctype html><html><body><div id="estPlanXCheck"></div></body></html>',
  { runScripts: 'outside-only' });
var win = dom.window;

// Load the shared module exactly as the browser would.
var modSrc = fs.readFileSync(path.join(ROOT, 'lib', 'plan-crosscheck.js'), 'utf8');
win.eval(modSrc);
check('module attaches itself to window for the browser',
  typeof win.OrchaCrossCheck === 'object' && typeof win.OrchaCrossCheck.crossCheck === 'function');

// Pull the renderer out of demo.html and run it against the real DOM node.
var fnMatch = html.match(/function _planRenderCrossCheck\(xc\)\{[\s\S]*?\n\}/);
check('renderer is present in demo.html', !!fnMatch);
if (fnMatch) {
  win.eval('function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}');
  win.eval(fnMatch[0]);
  var el = win.document.getElementById('estPlanXCheck');

  // agreement
  var same = { totalPrintedSqft: 1603, stories: 1, roof: { form: 'gable' } };
  var agreed = win.OrchaCrossCheck.crossCheck(same, JSON.parse(JSON.stringify(same)));
  win.eval('_planRenderCrossCheck(' + JSON.stringify(agreed) + ')');
  check('agreement renders a confirmation', /Cross-checked/i.test(el.innerHTML));
  check('agreement does not render a warning', !/&#9888;/.test(el.innerHTML));

  // the dropped digit
  var bad = win.OrchaCrossCheck.crossCheck({ totalPrintedSqft: 1156 }, { totalPrintedSqft: 156 });
  win.eval('_planRenderCrossCheck(' + JSON.stringify(bad) + ')');
  check('a dropped digit renders a visible warning', /Check these numbers/i.test(el.innerHTML));
  check('both candidate readings are shown to the contractor',
    el.innerHTML.indexOf('1156') >= 0 && el.innerHTML.indexOf('156') >= 0);
  check('the warning explains the 10x shape', /10x|dropped/i.test(el.innerHTML));

  // unavailable second read must render nothing at all, not a false all-clear
  win.eval('_planRenderCrossCheck(null)');
  check('no second read renders nothing (never a false all-clear)', el.innerHTML === '');

  var unavailable = win.OrchaCrossCheck.crossCheck({ totalPrintedSqft: 1603 }, null);
  win.eval('_planRenderCrossCheck(' + JSON.stringify(unavailable) + ')');
  check('an unavailable cross-check renders nothing', el.innerHTML === '');
}

if (failures.length) {
  console.error('\n❌  crosscheck UI FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  crosscheck UI: the warning reaches the screen.\n');
