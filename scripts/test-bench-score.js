// Tests for the takeoff scorer. This file exists because a scoring bug would
// make every future "we improved it" claim false in a direction we'd like, and
// nobody would notice. Run by CI alongside the other guards.

var assert = require('assert');
var S = require('../lib/bench-score.js');

var failures = [];
function t(name, fn) {
  try { fn(); process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failures.push(name + ' — ' + e.message); process.stdout.write('  ✗ ' + name + '\n'); }
}
function approx(a, b, eps) {
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), 'expected ' + b + ', got ' + a);
}

console.log('\nbench-score');

// ---- tokenisation and similarity -----------------------------------------
t('strips noise words so generic phrasing does not create matches', function () {
  assert.deepStrictEqual(S.tokens('Install the 2x6 studs'), ['2x6', 'stud']);
});

t('singularises so "studs" matches "stud"', function () {
  assert.ok(S.similarity('2x6 studs', '2x6 stud') > 0.9);
});

t('does not match two unrelated items', function () {
  assert.ok(S.similarity('R-21 batt insulation', 'asphalt shingle roofing') < 0.45);
});

t('matches a shorter name contained in a longer one', function () {
  assert.ok(S.similarity('2x6 stud', '2x6 stud wall framing') >= 0.45);
});

t('two items sharing only a stop word do not match', function () {
  assert.strictEqual(S.similarity('labor allowance', 'material allowance'), 0);
});

// ---- units ----------------------------------------------------------------
t('groups equivalent unit spellings', function () {
  assert.strictEqual(S.normUnit('SF'), S.normUnit('sq ft'));
  assert.strictEqual(S.normUnit('EA'), S.normUnit('each'));
  assert.strictEqual(S.normUnit('CY'), 'volume');
});

t('keeps incompatible units apart', function () {
  assert.notStrictEqual(S.normUnit('SF'), S.normUnit('LF'));
});

t('a unit conflict blocks an otherwise good name match', function () {
  var r = S.score(
    [{ item: '2x6 stud wall', unit: 'SF', qty: 100 }],
    [{ item: '2x6 stud wall', unit: 'LF', qty: 100 }], {});
  assert.strictEqual(r.matchedItems, 0, 'SF and LF are different line items');
});

// ---- tolerance ------------------------------------------------------------
t('tolerance is inclusive at the boundary', function () {
  assert.ok(S.withinTolerance(100, 110, 0.10));
  assert.ok(S.withinTolerance(100, 90, 0.10));
});

t('just outside tolerance fails', function () {
  assert.ok(!S.withinTolerance(100, 110.01, 0.10));
});

t('a missing quantity is never a pass', function () {
  assert.ok(!S.withinTolerance(100, null, 0.25));
  assert.ok(!S.withinTolerance(null, 100, 0.25));
});

t('zero truth only matches zero', function () {
  assert.ok(S.withinTolerance(0, 0, 0.25));
  assert.ok(!S.withinTolerance(0, 5, 0.25));
});

// ---- scoring --------------------------------------------------------------
t('a perfect takeoff scores 1.0 across the board', function () {
  var truth = [
    { trade: 'framing', item: '2x6 stud wall', unit: 'LF', qty: 420, total: 8400 },
    { trade: 'roofing', item: 'asphalt shingles', unit: 'SQ', qty: 32, total: 9600 }
  ];
  var r = S.score(truth, truth.slice(), { bidTotal: 18000 });
  approx(r.coverage, 1);
  approx(r.precision25, 1);
  approx(r.composite, 1);
  approx(r.totalDelta, 0);
});

t('a missed item costs coverage but not precision', function () {
  var truth = [
    { trade: 'framing', item: '2x6 stud wall', unit: 'LF', qty: 400 },
    { trade: 'roofing', item: 'asphalt shingles', unit: 'SQ', qty: 30 }
  ];
  var pred = [{ trade: 'framing', item: '2x6 stud wall', unit: 'LF', qty: 400 }];
  var r = S.score(truth, pred, {});
  approx(r.coverage, 0.5);
  approx(r.precision25, 1, 1e-9);
  assert.strictEqual(r.detail.missed.length, 1);
  assert.strictEqual(r.detail.missed[0].item, 'asphalt shingles');
});

t('a found-but-wrong quantity costs precision but not coverage', function () {
  var r = S.score(
    [{ item: 'asphalt shingles', unit: 'SQ', qty: 30 }],
    [{ item: 'asphalt shingles', unit: 'SQ', qty: 60 }], {});
  approx(r.coverage, 1);
  approx(r.precision25, 0);
  assert.strictEqual(r.detail.matched[0].within25, false);
});

t('optional-tier truth items are not scored', function () {
  var truth = [
    { item: '2x6 stud wall', unit: 'LF', qty: 400, tier: 'primary' },
    { item: 'decorative corbels', unit: 'EA', qty: 4, tier: 'optional' }
  ];
  var r = S.score(truth, [{ item: '2x6 stud wall', unit: 'LF', qty: 400 }], {});
  assert.strictEqual(r.eligibleItems, 1);
  approx(r.coverage, 1);
});

t('invented line items are reported as extra, not silently dropped', function () {
  var r = S.score(
    [{ item: '2x6 stud wall', unit: 'LF', qty: 400 }],
    [{ item: '2x6 stud wall', unit: 'LF', qty: 400 },
     { item: 'gold plated doorknob', unit: 'EA', qty: 2 }], {});
  assert.strictEqual(r.detail.extra.length, 1);
  assert.strictEqual(r.detail.extra[0].item, 'gold plated doorknob');
});

t('one truth item cannot be matched twice', function () {
  var r = S.score(
    [{ item: 'asphalt shingles', unit: 'SQ', qty: 30 }],
    [{ item: 'asphalt shingles', unit: 'SQ', qty: 30 },
     { item: 'asphalt shingle', unit: 'SQ', qty: 30 }], {});
  assert.strictEqual(r.matchedItems, 1);
  assert.strictEqual(r.detail.extra.length, 1);
});

t('matching is order-independent', function () {
  var truth = [
    { item: '2x6 stud wall', unit: 'LF', qty: 400 },
    { item: '2x6 stud wall framing upper', unit: 'LF', qty: 200 }
  ];
  var a = S.score(truth, [
    { item: '2x6 stud wall framing upper', unit: 'LF', qty: 200 },
    { item: '2x6 stud wall', unit: 'LF', qty: 400 }
  ], {});
  var b = S.score(truth, [
    { item: '2x6 stud wall', unit: 'LF', qty: 400 },
    { item: '2x6 stud wall framing upper', unit: 'LF', qty: 200 }
  ], {});
  assert.strictEqual(a.matchedItems, b.matchedItems);
  approx(a.composite, b.composite);
});

t('composite is weighted toward precision', function () {
  // Same average, different split: being right about less should beat being
  // vaguely aware of more.
  var highCoverage = Math.pow(0.9, 0.4) * Math.pow(0.5, 0.6);
  var highPrecision = Math.pow(0.5, 0.4) * Math.pow(0.9, 0.6);
  assert.ok(highPrecision > highCoverage);
});

t('empty prediction scores zero without throwing', function () {
  var r = S.score([{ item: 'anything', unit: 'EA', qty: 1 }], [], {});
  approx(r.coverage, 0);
  approx(r.composite, 0);
  assert.strictEqual(r.detail.missed.length, 1);
});

t('empty truth does not produce a fake perfect score', function () {
  var r = S.score([], [{ item: 'anything', unit: 'EA', qty: 1 }], {});
  approx(r.coverage, 0);
  approx(r.composite, 0);
});

t('dollar delta is signed, so over and under are distinguishable', function () {
  var over = S.score([{ item: 'x', unit: 'EA', qty: 1, total: 100 }],
                     [{ item: 'x', unit: 'EA', qty: 1, total: 150 }], { bidTotal: 100 });
  approx(over.totalDelta, 0.5);
  var under = S.score([{ item: 'x', unit: 'EA', qty: 1, total: 100 }],
                      [{ item: 'x', unit: 'EA', qty: 1, total: 50 }], { bidTotal: 100 });
  approx(under.totalDelta, -0.5);
});

t('total falls back to qty x unit cost when no total is given', function () {
  var r = S.score([{ item: 'x', unit: 'EA', qty: 1, total: 1000 }],
                  [{ item: 'x', unit: 'EA', qty: 10, unit_cost: 100 }], { bidTotal: 1000 });
  approx(r.predictedTotal, 1000);
});

t('per-trade metrics isolate a weak trade', function () {
  var truth = [
    { trade: 'framing', item: '2x6 stud wall', unit: 'LF', qty: 400 },
    { trade: 'framing', item: 'roof truss', unit: 'EA', qty: 24 },
    { trade: 'electrical', item: 'duplex receptacle', unit: 'EA', qty: 60 }
  ];
  var pred = [
    { trade: 'framing', item: '2x6 stud wall', unit: 'LF', qty: 900 },   // badly wrong
    { trade: 'framing', item: 'roof truss', unit: 'EA', qty: 48 },       // badly wrong
    { trade: 'electrical', item: 'duplex receptacle', unit: 'EA', qty: 60 } // right
  ];
  var r = S.score(truth, pred, {});
  approx(r.byTrade.framing.precision25, 0);
  approx(r.byTrade.electrical.precision25, 1);
});

// ---- regression guard against the real reported numbers -------------------
t('reproduces a published-style score shape', function () {
  // 10 truth items, 7 found, 4 of those within 25%: coverage .70, p25 ~.571
  var truth = [], pred = [];
  for (var i = 0; i < 10; i++) truth.push({ item: 'item type ' + i, unit: 'EA', qty: 100 });
  for (var j = 0; j < 7; j++) pred.push({ item: 'item type ' + j, unit: 'EA', qty: j < 4 ? 100 : 300 });
  var r = S.score(truth, pred, {});
  approx(r.coverage, 0.7, 1e-9);
  approx(r.precision25, 4 / 7, 1e-9);
  approx(r.composite, Math.pow(0.7, 0.4) * Math.pow(4 / 7, 0.6), 1e-9);
});


// ---- dollar mode -----------------------------------------------------------
// Most contractors have cost history, not quantity history. Scoring their data
// against quantities would report zero and look like a broken estimator.

console.log('\nbench-score · dollar mode');

t('detects cost-history truth (totals, no quantities)', function () {
  assert.ok(S.looksLikeDollarTruth([
    { trade: 'Framing', item: 'Framing', total: 84000 },
    { trade: 'Roofing', item: 'Roofing', total: 31000 }
  ]));
});

t('does not mistake quantity truth for cost history', function () {
  assert.ok(!S.looksLikeDollarTruth([
    { trade: 'Framing', item: '2x6 stud wall', unit: 'LF', qty: 420, total: 8400 },
    { trade: 'Roofing', item: 'Shingles', unit: 'SQ', qty: 32, total: 9600 }
  ]));
});

t('scoreAuto picks dollar mode on cost history', function () {
  var r = S.scoreAuto(
    [{ trade: 'Framing', item: 'Framing', total: 84000 }],
    [{ trade: 'Framing', item: '2x6 stud wall', qty: 420, unit_cost: 200 }], {});
  assert.strictEqual(r.mode, 'dollars');
});

t('scoreAuto stays in quantity mode when quantities exist', function () {
  var r = S.scoreAuto(
    [{ trade: 'Framing', item: '2x6 stud wall', unit: 'LF', qty: 420 }],
    [{ trade: 'Framing', item: '2x6 stud wall', unit: 'LF', qty: 420 }], {});
  assert.strictEqual(r.mode, 'quantity');
  approx(r.coverage, 1);
});

t('sums many predicted lines into one truth trade', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 }],
    [{ trade: 'Framing', item: 'studs', total: 60000 },
     { trade: 'Framing', item: 'sheathing', total: 40000 }], {});
  approx(r.coverage, 1);
  approx(r.precision25, 1);
  approx(r.detail.matched[0].predQty, 100000);
});

t('a trade we produced nothing for is a miss', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 },
     { trade: 'Roofing', item: 'Roofing', total: 30000 }],
    [{ trade: 'Framing', item: 'studs', total: 100000 }], {});
  approx(r.coverage, 0.5);
  assert.strictEqual(r.detail.missed.length, 1);
  assert.strictEqual(r.detail.missed[0].trade, 'roofing');
});

t('a trade priced badly costs precision, not coverage', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 }],
    [{ trade: 'Framing', item: 'studs', total: 250000 }], {});
  approx(r.coverage, 1);
  approx(r.precision25, 0);
});

t('matches trade labels that differ in wording', function () {
  var r = S.scoreDollars(
    [{ trade: 'Rough Framing', item: 'Rough Framing', total: 100000 }],
    [{ trade: 'framing rough', item: 'x', total: 100000 }], {});
  approx(r.coverage, 1);
});

t('a trade we invented is reported as extra', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 }],
    [{ trade: 'Framing', item: 'studs', total: 100000 },
     { trade: 'Landscaping', item: 'sod', total: 9000 }], {});
  assert.strictEqual(r.detail.extra.length, 1);
  assert.strictEqual(r.detail.extra[0].trade, 'landscaping');
});

t('falls back to the truth sum when no bid total was entered', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 },
     { trade: 'Roofing', item: 'Roofing', total: 40000 }],
    [{ trade: 'Framing', item: 'x', total: 100000 },
     { trade: 'Roofing', item: 'y', total: 40000 }], {});
  approx(r.bidTotal, 140000);
  approx(r.totalDelta, 0);
});

t('reports dollars per trade so a gap is visible in money', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 }],
    [{ trade: 'Framing', item: 'x', total: 70000 }], {});
  approx(r.byTrade.framing.truthDollars, 100000);
  approx(r.byTrade.framing.predDollars, 70000);
});

t('one truth trade cannot be matched by two predicted trades', function () {
  var r = S.scoreDollars(
    [{ trade: 'Framing', item: 'Framing', total: 100000 }],
    [{ trade: 'Framing', item: 'a', total: 50000 },
     { trade: 'Framing work', item: 'b', total: 50000 }], {});
  assert.strictEqual(r.matchedItems, 1);
});

if (failures.length) {
  console.error('\n❌  bench-score FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  bench-score: scoring is honest.\n');
