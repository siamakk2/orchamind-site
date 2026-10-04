// Tests for the deterministic quantity engine.
//
// These are the tests the model-generated version could never have, which is
// the whole argument for moving the math into code: a formula can be checked,
// a prompt can only be hoped for.

var assert = require('assert');
var Q = require('../lib/takeoff-quantities.js');

var failures = [];
function t(name, fn) {
  try { fn(); process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failures.push(name + ' — ' + e.message); process.stdout.write('  ✗ ' + name + '\n'); }
}
function approx(a, b, eps) { assert.ok(Math.abs(a - b) <= (eps || 0.01), 'expected ' + b + ', got ' + a); }
function find(r, re) { return r.items.filter(function (i) { return re.test(i.item); })[0]; }

console.log('\ntakeoff-quantities');

// The fixture sheet, as the transcriber would report it.
var MAPLE = {
  totalPrintedSqft: 2486, stories: 2, storyHeightFt: 9,
  overallDims: { widthFt: 42, depthFt: 34 },
  roof: { form: 'gable', pitch: '6:12' },
  areaSchedule: [
    { label: 'MAIN FLOOR', sqft: 1312 }, { label: 'UPPER FLOOR', sqft: 1174 },
    { label: 'GARAGE', sqft: 484 }, { label: 'COVERED PORCH', sqft: 168 }
  ],
  windowCount: 20, doorCount: 3
};

// ---- dimension parsing ----------------------------------------------------
t('reads a printed feet-and-inches dimension', function () {
  // The dash in 42'-6" is a separator, not a minus. Reading it as feet-only
  // silently drops six inches, which is what this caught.
  approx(Q.feet("42'-6\""), 42.5);
  approx(Q.feet("42'-0\""), 42);
  approx(Q.feet("68'-6\""), 68.5);
  approx(Q.feet('42 ft 6 in'), 42.5);
  approx(Q.feet("42'"), 42);
  approx(Q.feet('19.5'), 19.5);
  approx(Q.feet(34), 34);
});

t('takes the first dimension from a "W x D" string', function () {
  approx(Q.feet("19'-6\" x 16'-0\""), 19.5);
});

t('rejects nonsense instead of inventing a number', function () {
  assert.strictEqual(Q.feet(null), null);
  assert.strictEqual(Q.feet('tbd'), null);
});

// ---- rounding: the rule that separates an estimator from a calculator ------
t('rounds UP, never to nearest', function () {
  approx(Q.up(5.33, 0.5), 5.5, 1e-9);
  approx(Q.up(5.01, 0.5), 5.5, 1e-9);
  approx(Q.up(5.5, 0.5), 5.5, 1e-9);
  approx(Q.up(100.1, 1), 101, 1e-9);
});

t('an exact value is not pushed to the next increment', function () {
  approx(Q.up(6, 0.5), 6, 1e-9);
  approx(Q.up(32, 1), 32, 1e-9);
});

t('the 5.33 cubic yard case that models get wrong', function () {
  // CEQuest found most models round 5.33 CY down to 5. That is a short pour.
  assert.ok(Q.up(5.33, 0.5) >= 5.33, 'must never order less than needed');
  approx(Q.up(5.33, 0.5), 5.5, 1e-9);
});

// ---- roof pitch -----------------------------------------------------------
t('pitch factor matches the geometry', function () {
  approx(Q.pitchFactor('6:12'), Math.sqrt(1 + 0.25), 1e-6);
  approx(Q.pitchFactor('12:12'), Math.SQRT2, 1e-6);
  approx(Q.pitchFactor('4/12'), Math.sqrt(1 + (4 / 12) * (4 / 12)), 1e-6);
});

t('a flat roof is a factor of exactly 1', function () {
  approx(Q.pitchFactor('0:12'), 1, 1e-9);
});

t('an unreadable pitch returns null rather than a guess', function () {
  assert.strictEqual(Q.pitchFactor('steep'), null);
  assert.strictEqual(Q.pitchFactor(null), null);
});

// ---- conditioned area -----------------------------------------------------
t('uses the printed total when there is one', function () {
  var r = Q.computeQuantities(MAPLE);
  assert.strictEqual(r.inputs.conditionedSqft, 2486);
});

t('garage and porch never enter the conditioned area', function () {
  var noTotal = Object.assign({}, MAPLE, { totalPrintedSqft: null });
  var r = Q.computeQuantities(noTotal);
  // 1312 + 1174 only. Including garage and porch would give 3138.
  assert.strictEqual(r.inputs.conditionedSqft, 2486);
  assert.ok(r.assumptions.some(function (a) { return /excluding garage/i.test(a); }));
});

t('a schedule that disagrees with the printed total is flagged, not averaged', function () {
  var bad = Object.assign({}, MAPLE, { totalPrintedSqft: 3000 });
  var r = Q.computeQuantities(bad);
  assert.ok(r.unresolved.some(function (u) { return /disagree/i.test(u); }));
  assert.strictEqual(r.inputs.conditionedSqft, 3000, 'printed total still wins, but loudly');
});

// ---- footprint and perimeter ----------------------------------------------
t('footprint comes from printed dimensions when available', function () {
  var r = Q.computeQuantities(MAPLE);
  approx(r.inputs.footprintSqft, 42 * 34);
  assert.ok(/overall printed/i.test(r.inputs.footprintSource));
});

t('without dimensions it derives footprint and says it assumed stacking', function () {
  var r = Q.computeQuantities(Object.assign({}, MAPLE, { overallDims: null }));
  approx(r.inputs.footprintSqft, 2486 / 2);
  assert.ok(r.assumptions.some(function (a) { return /stack/i.test(a); }));
});

t('an approximated perimeter is declared as a floor, not a figure', function () {
  var r = Q.computeQuantities(Object.assign({}, MAPLE, { overallDims: null }));
  assert.ok(r.assumptions.some(function (a) { return /MORE wall than this/i.test(a); }));
});

// ---- concrete -------------------------------------------------------------
t('slab volume is right and rounded up to a half yard', function () {
  var r = Q.computeQuantities(MAPLE);
  var c = find(r, /slab/i);
  var raw = (42 * 34) * (4 / 12) / 27;          // 17.63 CY
  var withWaste = raw * 1.05;                    // 18.51
  approx(c.qty, Math.ceil(withWaste / 0.5) * 0.5);
  assert.strictEqual(c.unit, 'CY');
  assert.ok(c.qty >= raw, 'never less than the bare requirement');
});

t('a thicker slab produces proportionally more concrete', function () {
  var four = find(Q.computeQuantities(MAPLE, { slabThicknessIn: 4 }), /slab/i).qty;
  var eight = find(Q.computeQuantities(MAPLE, { slabThicknessIn: 8 }), /slab/i).qty;
  assert.ok(eight > four * 1.8 && eight < four * 2.2, '8" should be about double 4", got ' + eight + ' vs ' + four);
});

// ---- framing --------------------------------------------------------------
t('plates count three per wall run per storey', function () {
  var r = Q.computeQuantities(MAPLE);
  var p = find(r, /plates/i);
  var perim = 2 * (42 + 34);
  approx(p.qty, Math.ceil(perim * 2 * 3 * 1.10));
});

t('studs include corners and openings', function () {
  var r = Q.computeQuantities(MAPLE);
  var s = find(r, /studs/i);
  var perim = 2 * (42 + 34);
  var expected = Math.ceil(((perim * 2) * (12 / 16) + 1 + 24 + 46) * 1.10);
  approx(s.qty, expected);
});

t('no opening count means the omission is stated', function () {
  var r = Q.computeQuantities(Object.assign({}, MAPLE, { windowCount: null, doorCount: null }));
  assert.ok(r.assumptions.some(function (a) { return /no extra studs were added for openings/i.test(a); }));
});

t('tighter stud spacing means more studs', function () {
  var a = find(Q.computeQuantities(MAPLE, { studSpacingIn: 24 }), /studs/i).qty;
  var b = find(Q.computeQuantities(MAPLE, { studSpacingIn: 16 }), /studs/i).qty;
  assert.ok(b > a, '16" o.c. must need more studs than 24"');
});

// ---- sheets ---------------------------------------------------------------
t('sheathing is whole sheets, rounded up', function () {
  var r = Q.computeQuantities(MAPLE);
  var sh = find(r, /sheathing/i);
  var wall = 2 * (42 + 34) * 9 * 2;
  approx(sh.qty, Math.ceil(wall * 1.10 / 32));
  assert.strictEqual(sh.qty, Math.round(sh.qty), 'you cannot buy a fraction of a sheet');
});

t('drywall covers walls plus ceilings and says partitions are excluded', function () {
  var r = Q.computeQuantities(MAPLE);
  var dw = find(r, /drywall/i);
  var wall = 2 * (42 + 34) * 9 * 2;
  approx(dw.qty, Math.ceil((wall + 2486) * 1.10 / 32));
  assert.ok(/partitions are NOT included/i.test(dw.note));
});

// ---- roofing --------------------------------------------------------------
t('roof squares use the printed pitch', function () {
  var r = Q.computeQuantities(MAPLE);
  var rf = find(r, /roof/i);
  var sf = 42 * 34 * Math.sqrt(1.25);
  approx(rf.qty, Math.ceil(sf * 1.10 / 100));
  assert.strictEqual(rf.unit, 'SQ');
});

t('a steeper roof needs materially more covering', function () {
  var six = find(Q.computeQuantities(MAPLE), /roof/i).qty;
  var twelve = find(Q.computeQuantities(Object.assign({}, MAPLE, { roof: { pitch: '12:12' } })), /roof/i).qty;
  assert.ok(twelve > six, '12:12 must exceed 6:12');
});

t('a missing pitch is assumed and the assumption is stated with its risk', function () {
  var r = Q.computeQuantities(Object.assign({}, MAPLE, { roof: { form: 'gable' } }));
  assert.ok(r.assumptions.some(function (a) { return /6:12 assumed/i.test(a) && /confirm before bidding/i.test(a); }));
});

// ---- the non-negotiable: never invent -------------------------------------
t('empty input produces nulls with reasons, never numbers', function () {
  var r = Q.computeQuantities({});
  assert.strictEqual(r.computedCount, 0, 'nothing should be computable from nothing');
  assert.ok(r.missingCount > 0);
  r.items.forEach(function (i) {
    assert.strictEqual(i.qty, null);
    assert.ok(i.note && i.note.length > 10, 'every gap must say what it needs: ' + i.item);
  });
});

t('a missing plate height blocks wall quantities rather than guessing one', function () {
  var r = Q.computeQuantities(Object.assign({}, MAPLE, { storyHeightFt: null }));
  assert.ok(r.unresolved.some(function (u) { return /plate height/i.test(u); }));
  assert.strictEqual(find(r, /sheathing/i).qty, null);
});

t('every computed line carries the formula that produced it', function () {
  var r = Q.computeQuantities(MAPLE);
  r.items.filter(function (i) { return i.computed; }).forEach(function (i) {
    assert.ok(i.formula && i.formula.length > 10, 'no formula recorded for ' + i.item);
    assert.ok(i.qty > 0, 'zero quantity on ' + i.item);
  });
});

t('the same input always gives the same numbers', function () {
  var a = JSON.stringify(Q.computeQuantities(MAPLE).items);
  var b = JSON.stringify(Q.computeQuantities(MAPLE).items);
  assert.strictEqual(a, b, 'the whole point is that this is repeatable');
});

t('a full read of the fixture computes most trades', function () {
  var r = Q.computeQuantities(MAPLE);
  assert.ok(r.computedCount >= 7, 'expected at least 7 computed lines, got ' + r.computedCount);
  assert.strictEqual(r.missingCount, 0, 'a complete transcription should leave no gaps');
});

if (failures.length) {
  console.error('\n❌  takeoff-quantities FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  takeoff-quantities: the arithmetic is code, and it rounds up.\n');
