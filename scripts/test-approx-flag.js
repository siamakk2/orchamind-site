// The "this 3D preview is an approximation, no readable floor plan" warning
// must only appear when no floor plan was actually read. It used to search the
// AI's notes for phrases and showed on a full, correctly read floor plan.
var fs = require('fs'), path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
var failures = [];
function check(n, c) { if (c) process.stdout.write('  ✓ ' + n + '\n'); else { failures.push(n); process.stdout.write('  ✗ ' + n + '\n'); } }
console.log('\n3D preview "approximation" warning');
var m = html.match(/function _planIsApprox\(obj, ext\)\{[\s\S]*?\n\}/);
check('_planIsApprox found', !!m);
check('_planApply uses it', /_planGeomApprox = _planIsApprox\(obj, window\._planExtracted\);/.test(html));
var f = eval('(' + m[0] + ')');
var geom = { geometry: { rooms: [{}, {}, {}] } };
var napa = { rooms: [{ name: 'BEDROOM 2' }, { name: 'KITCHEN' }, { name: 'LIVING' }, { name: 'COVERED PORCH' }] };
check('Napa plan read with 13 rooms: no warning, even if a note says "no floor plan dimension"', f(Object.assign({ notes: 'No floor plan dimension shown for the porch; area schedule was provided.' }, geom), napa) === false);
check('floor-plan sheet identified: no warning', f(geom, { sheets: [{ type: 'floorplan' }] }) === false);
check('elevations only, AI says so: warning', f(Object.assign({ notes: 'Elevation-only upload; layout estimated.' }, geom), { rooms: [], sheets: [{ type: 'elevation' }] }) === true);
check('no usable 3D rooms at all: warning', f({ geometry: { rooms: [{}] } }, napa) === true);
check('only outdoor areas read: still decided by notes', f(Object.assign({ notes: 'ok' }, geom), { rooms: [{ name: 'Covered porch' }, { name: 'Garage' }] }) === false);
check('demo.html and demo-test.html identical', html === fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8'));
if (failures.length) { console.error('\n❌  approximation warning FAILED:\n   • ' + failures.join('\n   • ')); process.exit(1); }
console.log('✅  approximation warning: only when no floor plan was read.\n');
