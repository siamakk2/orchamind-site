// Tests for the plan cross-check. The whole point of this module is to catch a
// misread printed number, so the tests are mostly "does it catch the specific
// way these go wrong" — above all the dropped leading digit.

var assert = require('assert');
var X = require('../lib/plan-crosscheck.js');

var failures = [];
function t(name, fn) {
  try { fn(); process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failures.push(name + ' — ' + e.message); process.stdout.write('  ✗ ' + name + '\n'); }
}
function conflictOn(r, field) {
  return r.conflicts.filter(function (c) { return c.field === field; })[0] || null;
}

console.log('\nplan-crosscheck');

// ---- the headline failure mode -------------------------------------------
t('catches a dropped leading digit on the total square footage', function () {
  var r = X.crossCheck({ totalPrintedSqft: 1156 }, { totalPrintedSqft: 156 });
  var c = conflictOn(r, 'totalPrintedSqft');
  assert.ok(c, 'should conflict');
  assert.strictEqual(c.severity, 'critical');
  assert.ok(/10x|dropped/i.test(c.note), 'should name the dropped-digit shape');
});

t('recognises the dropped-digit shape directly', function () {
  assert.ok(X.looksLikeDroppedDigit(1156, 156));
  assert.ok(X.looksLikeDroppedDigit(3206, 206));
  assert.ok(X.looksLikeDroppedDigit(420, 42));
  assert.ok(!X.looksLikeDroppedDigit(1603, 1630), 'transposition is not a dropped digit');
  assert.ok(!X.looksLikeDroppedDigit(100, 103));
});

t('catches a dropped digit inside an area schedule row', function () {
  var r = X.crossCheck(
    { areaSchedule: [{ label: 'MAIN FLOOR', sqft: 1603 }] },
    { areaSchedule: [{ label: 'Main Floor', sqft: 163 }] });
  var c = r.conflicts[0];
  assert.strictEqual(c.severity, 'critical');
  assert.ok(/10x/i.test(c.note));
});

// ---- agreement ------------------------------------------------------------
t('two identical readings agree with no conflicts', function () {
  var e = {
    totalPrintedSqft: 3206, stories: 2,
    areaSchedule: [{ label: 'MAIN FLOOR', sqft: 1603 }, { label: 'BASEMENT', sqft: 1603 }],
    windows: [{ elevation: 'front', count: 8 }, { elevation: 'rear', count: 6 }],
    roof: { form: 'gable' }
  };
  var r = X.crossCheck(e, JSON.parse(JSON.stringify(e)));
  assert.strictEqual(r.agreed, true);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.confidence, 1);
  assert.ok(r.checked >= 4, 'should have checked several fields, got ' + r.checked);
});

t('label casing and punctuation do not create false conflicts', function () {
  var r = X.crossCheck(
    { areaSchedule: [{ label: 'MAIN FLOOR - CONDITIONED', sqft: 1603 }] },
    { areaSchedule: [{ label: 'main floor conditioned', sqft: 1603 }] });
  assert.strictEqual(r.conflicts.length, 0);
});

t('rounding inside tolerance is not a conflict', function () {
  var r = X.crossCheck({ totalPrintedSqft: 1603 }, { totalPrintedSqft: 1604 });
  assert.strictEqual(r.conflicts.length, 0);
});

t('a real disagreement outside tolerance is critical', function () {
  var r = X.crossCheck({ totalPrintedSqft: 1603 }, { totalPrintedSqft: 1840 });
  var c = conflictOn(r, 'totalPrintedSqft');
  assert.strictEqual(c.severity, 'critical');
});

// ---- stories --------------------------------------------------------------
t('a story-count disagreement is critical', function () {
  var r = X.crossCheck({ stories: 1 }, { stories: 2 });
  var c = conflictOn(r, 'stories');
  assert.ok(c); assert.strictEqual(c.severity, 'critical');
});

t('matching story counts pass', function () {
  var r = X.crossCheck({ stories: 2 }, { stories: 2 });
  assert.strictEqual(r.conflicts.length, 0);
});

// ---- schedule rows --------------------------------------------------------
t('a row only one reader saw is reported, not silently dropped', function () {
  var r = X.crossCheck(
    { areaSchedule: [{ label: 'MAIN', sqft: 1603 }, { label: 'GARAGE', sqft: 672 }] },
    { areaSchedule: [{ label: 'MAIN', sqft: 1603 }] });
  var c = r.conflicts.filter(function (x) { return /garage/i.test(x.label); })[0];
  assert.ok(c, 'garage row should be flagged');
  assert.strictEqual(c.b, null);
});

t('a row only the SECOND reader saw is also reported', function () {
  var r = X.crossCheck(
    { areaSchedule: [{ label: 'MAIN', sqft: 1603 }] },
    { areaSchedule: [{ label: 'MAIN', sqft: 1603 }, { label: 'LOFT', sqft: 300 }] });
  var c = r.conflicts.filter(function (x) { return /loft/i.test(x.label); })[0];
  assert.ok(c, 'loft row should be flagged');
  assert.strictEqual(c.a, null);
});

t('accepts value as well as sqft on schedule rows', function () {
  var r = X.crossCheck(
    { areaSchedule: [{ label: 'MAIN', value: 1603 }] },
    { areaSchedule: [{ label: 'MAIN', value: 1603 }] });
  assert.strictEqual(r.conflicts.length, 0);
});

// ---- windows --------------------------------------------------------------
t('totals windows from a per-elevation array', function () {
  var r = X.crossCheck(
    { windows: [{ elevation: 'front', count: 8 }, { elevation: 'rear', count: 6 }] },
    { windows: [{ elevation: 'front', count: 8 }, { elevation: 'rear', count: 6 }] });
  assert.strictEqual(r.conflicts.length, 0);
});

t('flags a material window-count disagreement', function () {
  var r = X.crossCheck({ windows: [{ count: 20 }] }, { windows: [{ count: 10 }] });
  assert.ok(conflictOn(r, 'windows'));
});

t('tolerates a one-window difference on a large count', function () {
  var r = X.crossCheck({ windows: [{ count: 20 }] }, { windows: [{ count: 21 }] });
  assert.strictEqual(conflictOn(r, 'windows'), null);
});

// ---- roof -----------------------------------------------------------------
t('flags a roof form disagreement', function () {
  var r = X.crossCheck({ roof: { form: 'gable' } }, { roof: { form: 'hip' } });
  assert.ok(conflictOn(r, 'roof'));
});

// ---- degenerate input -----------------------------------------------------
t('a missing second reading is reported as unavailable, not as agreement', function () {
  var r = X.crossCheck({ totalPrintedSqft: 1603 }, null);
  assert.strictEqual(r.agreed, false);
  assert.strictEqual(r.unavailable, true);
  assert.strictEqual(r.confidence, null);
});

t('two empty readings do not claim confidence', function () {
  var r = X.crossCheck({}, {});
  assert.strictEqual(r.checked, 0);
  assert.strictEqual(r.confidence, null);
});

t('one reader finding a total and the other not is flagged', function () {
  var r = X.crossCheck({ totalPrintedSqft: 1603 }, { totalPrintedSqft: null });
  var c = conflictOn(r, 'totalPrintedSqft');
  assert.ok(c); assert.strictEqual(c.severity, 'warn');
});

t('does not throw on malformed shapes', function () {
  X.crossCheck({ areaSchedule: 'nope', windows: 'nope', stories: 'two' },
               { areaSchedule: null, windows: 42, stories: {} });
});

// ---- confidence -----------------------------------------------------------
t('confidence falls as conflicts rise', function () {
  var clean = X.crossCheck({ totalPrintedSqft: 1603, stories: 2 }, { totalPrintedSqft: 1603, stories: 2 });
  var dirty = X.crossCheck({ totalPrintedSqft: 1603, stories: 2 }, { totalPrintedSqft: 1840, stories: 1 });
  assert.strictEqual(clean.confidence, 1);
  assert.ok(dirty.confidence < clean.confidence);
});

t('counts critical conflicts separately', function () {
  var r = X.crossCheck(
    { totalPrintedSqft: 1603, stories: 2, roof: { form: 'gable' } },
    { totalPrintedSqft: 156, stories: 1, roof: { form: 'hip' } });
  assert.strictEqual(r.criticalCount, 2, 'sqft and stories are critical; roof is a warn');
});

if (failures.length) {
  console.error('\n❌  plan-crosscheck FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  plan-crosscheck: disagreements are caught, not averaged.\n');
