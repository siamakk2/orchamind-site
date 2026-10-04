// Static wiring checks for the walkthrough inside the real demo.html.
// lib/house-walk.js is proven by its own tests; this file proves the feature is
// actually reachable, that it does not fight the massing renderer for the
// canvas, and that the Selections wiring is present — which is the part that
// makes it a sales tool rather than a camera demo.

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
var failures = [];
function check(name, cond, detail) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (detail ? ' — ' + detail : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}

console.log('\nwalkthrough UI wiring');

// --- reachable --------------------------------------------------------------
check('the Walk tab exists and is clickable',
  /data-view="walk"[^>]*onclick="epvSetView\('walk'\)"/.test(html));
check('demo.html loads the walkthrough module',
  /<script src="\/lib\/house-walk\.js"><\/script>/.test(html));
check('epvSetView has a walk branch', /else if\(v==='walk'\)\{/.test(html));

// --- the two render loops must not share the canvas -------------------------
check('entering walk cancels the orbiting massing loop',
  /else if\(v==='walk'\)\{[\s\S]{0,400}cancelAnimationFrame\(_p3dRAF\)/.test(html));
check('the massing renderer stands down while walk owns the canvas',
  /_epvView==='walk'\)return;/.test(html));
check('leaving walk tears the walkthrough down',
  /\} else \{\s*\n\s*_walkStop\(\);/.test(html));

// --- graceful failure -------------------------------------------------------
check('no interior rooms falls back to the model view instead of a dead canvas',
  /if\(!_walkStart\(\)\)\{[\s\S]{0,300}epvSetView\('solid'\);return;/.test(html));
check('_walkStart refuses to run without geometry',
  /if\(!cv\|\|!window\.OrchaWalk\|\|!_planGeom\)\{_walkStop\(\);return false;\}/.test(html));

// --- controls ---------------------------------------------------------------
check('keyboard movement is bound', /_walkKeys\.w\|\|_walkKeys\.ArrowUp/.test(html));
check('an on-screen pad exists for phones', /id="walkPad"/.test(html) && /class="walkb"/.test(html));
check('drag-to-look is bound to the canvas', /cv\.onpointermove=function\(e\)\{[\s\S]{0,200}_walk\.look\(/.test(html));
check('dragging right turns right (yaw sign is inverted on purpose)',
  /_walk\.look\(-\(e\.clientX-_walkDrag\.x\)/.test(html));
check('the current room is shown while walking', /id="walkRoom"/.test(html));
check('keyboard listeners are removed on teardown',
  /_walkStop[\s\S]{0,400}removeEventListener\('keydown',_walkKeyDown\)/.test(html));

// --- the point of the feature ----------------------------------------------
check('finishes come from the Selections panel',
  /function _walkSelections\(\)[\s\S]{0,400}window\.selections/.test(html));
check('only selections that map to a surface are offered (no rendered faucets)',
  /function _walkCat\(category\)/.test(html) && /return null;\s*\n\}/.test(html));
check('choosing a finish updates the room materials',
  /sel\.chosen=lab;[\s\S]{0,120}_walk\.setMaterials\(_walkMaterials\(\)\)/.test(html));
check('choosing a finish persists the choice',
  /sel\.chosen=lab;[\s\S]{0,400}typeof save==='function'\)save\(\)/.test(html));
check('the selections total is shown next to the room',
  /Selections total:/.test(html));
check('an empty Selections panel explains itself rather than rendering blank',
  /Add client selections \(Flooring, Paint, Countertops\)/.test(html));
check('finish colours are described as indicative, not exact',
  /Indicative finish colours/.test(html));

// --- honesty ---------------------------------------------------------------
check('the hint says the space is built from printed dimensions',
  /built from the printed dimensions/.test(html));

// --- parity -----------------------------------------------------------------
var test = fs.readFileSync(path.join(ROOT, 'demo-test.html'), 'utf8');
check('demo.html and demo-test.html are identical', html === test);

if (failures.length) {
  console.error('\n❌  walkthrough UI FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  walkthrough UI: reachable, tears down cleanly, wired to Selections.\n');
