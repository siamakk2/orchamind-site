// Scoring for the takeoff accuracy harness.
//
// The question this answers: given a plan set we know the real bid for, how
// close did the pipeline get? Two things matter and they fail differently.
//
//   COVERAGE  — did we find the item at all? Missing a line is the expensive
//               failure: nobody prices what they didn't see.
//   PRECISION — once found, was the quantity right? A found-but-wrong quantity
//               is recoverable; an estimator will catch it on review.
//
// Metric shapes follow TakeoffBench-v1 (arXiv:2608.15032) so our numbers can be
// read next to the published ones. Composite is weighted toward precision
// because that is what a contractor loses money on.
//
// Everything here is pure: no network, no database, no clock. That is what
// makes it testable, and this file is the one place a scoring bug could quietly
// flatter us, so it stays that way.

// Words that carry no distinguishing meaning in a construction line item, and
// would otherwise make everything look similar to everything else.
var STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'with',
  'per', 'ea', 'each', 'in', 'on', 'at', 'by', 'install', 'installed',
  'installation', 'supply', 'labor', 'material', 'materials', 'allowance',
  'misc', 'miscellaneous', 'new', 'total', 'sub', 'subtotal']);

// Unit families. A quantity in SF is not comparable to one in LF, so a match
// across families is not a match at all — it is two different line items that
// happen to share a word.
var UNIT_FAMILY = {
  sf: 'area', sqft: 'area', 'sq ft': 'area', 'ft2': 'area', sy: 'area', sm: 'area',
  lf: 'length', 'lin ft': 'length', ft: 'length', lm: 'length', m: 'length',
  cy: 'volume', cf: 'volume', 'cu yd': 'volume', 'cu ft': 'volume', m3: 'volume',
  ea: 'count', each: 'count', pc: 'count', pcs: 'count', unit: 'count',
  units: 'count', no: 'count', qty: 'count',
  hr: 'time', hrs: 'time', hour: 'time', hours: 'time', day: 'time', days: 'time',
  ls: 'lump', 'lump sum': 'lump', lot: 'lump',
  ton: 'weight', tons: 'weight', lb: 'weight', lbs: 'weight', kg: 'weight',
  sq: 'roofsquare', square: 'roofsquare', squares: 'roofsquare'
};

function normUnit(u) {
  var k = String(u == null ? '' : u).toLowerCase().replace(/[.()]/g, '').trim();
  return UNIT_FAMILY[k] || (k ? 'other:' + k : '');
}

function tokens(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t && t.length > 1 && !STOP.has(t); })
    // Crude singularisation: "studs" and "stud" are the same item.
    .map(function (t) { return t.length > 3 && /s$/.test(t) && !/ss$/.test(t) ? t.slice(0, -1) : t; });
}

// Similarity in [0,1]. Weighted Jaccard over tokens, with a bonus when one
// name's tokens are a subset of the other's ("2x6 stud" vs "2x6 stud wall").
function similarity(a, b) {
  var ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  var sa = new Set(ta), sb = new Set(tb);
  var inter = 0;
  sa.forEach(function (t) { if (sb.has(t)) inter++; });
  if (!inter) return 0;
  var union = sa.size + sb.size - inter;
  var jaccard = inter / union;
  var containment = inter / Math.min(sa.size, sb.size);
  return Math.max(jaccard, containment * 0.85);
}

var NAME_THRESHOLD = 0.45;

function num(v) {
  if (v == null || v === '') return null;
  var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

// Within tolerance? Both sides must have a quantity; a missing quantity is not
// a pass. Zero is handled explicitly so 0-vs-0 counts and 0-vs-anything does not.
function withinTolerance(truthQty, predQty, tol) {
  var t = num(truthQty), p = num(predQty);
  if (t == null || p == null) return false;
  if (t === 0) return p === 0;
  return Math.abs(p - t) / Math.abs(t) <= tol;
}

/**
 * Match predicted items to truth items, then score.
 *
 * @param {Array}  truth     [{trade,item,unit,qty,unit_cost,total,tier}]
 * @param {Array}  predicted [{trade,item,unit,qty,unit_cost,total}]
 * @param {Object} opts      { bidTotal:Number }
 * @returns {Object} metrics + per-item detail
 */
function score(truth, predicted, opts) {
  opts = opts || {};
  truth = Array.isArray(truth) ? truth : [];
  predicted = Array.isArray(predicted) ? predicted : [];

  // Only primary-tier items are scoring-eligible, matching TakeoffBench. An
  // optional extra is not a miss.
  var eligible = truth.filter(function (t) { return (t.tier || 'primary') === 'primary'; });

  // Score every truth/prediction pair, then take them best-first. Greedy on a
  // fully sorted list is stable and order-independent, which a single pass over
  // truth in input order would not be.
  var pairs = [];
  eligible.forEach(function (t, ti) {
    predicted.forEach(function (p, pi) {
      var sim = similarity(t.item, p.item);
      if (sim < NAME_THRESHOLD) return;
      var tu = normUnit(t.unit), pu = normUnit(p.unit);
      // Unmarked units are tolerated; conflicting ones are disqualifying.
      if (tu && pu && tu !== pu) return;
      // A shared trade is corroborating evidence, not a requirement — truth and
      // prediction often disagree on which trade owns a line.
      var sameTrade = t.trade && p.trade &&
        String(t.trade).toLowerCase().trim() === String(p.trade).toLowerCase().trim();
      pairs.push({ ti: ti, pi: pi, sim: sim + (sameTrade ? 0.1 : 0) });
    });
  });
  pairs.sort(function (a, b) { return b.sim - a.sim; });

  var usedT = new Set(), usedP = new Set(), matches = [];
  pairs.forEach(function (pr) {
    if (usedT.has(pr.ti) || usedP.has(pr.pi)) return;
    usedT.add(pr.ti); usedP.add(pr.pi);
    matches.push({ truth: eligible[pr.ti], pred: predicted[pr.pi], sim: pr.sim });
  });

  var matched = matches.length;
  var hit10 = 0, hit25 = 0;
  var detail = { matched: [], missed: [], extra: [] };

  matches.forEach(function (m) {
    var ok10 = withinTolerance(m.truth.qty, m.pred.qty, 0.10);
    var ok25 = withinTolerance(m.truth.qty, m.pred.qty, 0.25);
    if (ok10) hit10++;
    if (ok25) hit25++;
    detail.matched.push({
      trade: m.truth.trade || null,
      item: m.truth.item,
      predictedAs: m.pred.item,
      unit: m.truth.unit || null,
      truthQty: num(m.truth.qty),
      predQty: num(m.pred.qty),
      within10: ok10,
      within25: ok25,
      similarity: Math.round(m.sim * 100) / 100
    });
  });

  eligible.forEach(function (t, i) {
    if (!usedT.has(i)) {
      detail.missed.push({ trade: t.trade || null, item: t.item, unit: t.unit || null, qty: num(t.qty) });
    }
  });
  predicted.forEach(function (p, i) {
    if (!usedP.has(i)) {
      detail.extra.push({ trade: p.trade || null, item: p.item, unit: p.unit || null, qty: num(p.qty) });
    }
  });

  var coverage    = eligible.length ? matched / eligible.length : 0;
  var precision10 = matched ? hit10 / matched : 0;
  var precision25 = matched ? hit25 / matched : 0;
  // Precision-weighted: finding an item you then misprice is worth less than
  // finding it and getting it right.
  var composite = (coverage || precision25)
    ? Math.pow(coverage, 0.4) * Math.pow(precision25, 0.6)
    : 0;

  // Dollar delta against the real bid — the number a contractor actually asks about.
  var predTotal = predicted.reduce(function (s, p) {
    var tot = num(p.total);
    if (tot == null) {
      var q = num(p.qty), uc = num(p.unit_cost);
      tot = (q != null && uc != null) ? q * uc : 0;
    }
    return s + tot;
  }, 0);
  var bidTotal = num(opts.bidTotal);
  var totalDelta = (bidTotal != null && bidTotal !== 0)
    ? (predTotal - bidTotal) / bidTotal
    : null;

  // Per-trade, so "we are bad at framing" is visible rather than averaged away.
  var byTrade = {};
  eligible.forEach(function (t) {
    var k = (t.trade || 'unassigned').toLowerCase().trim();
    byTrade[k] = byTrade[k] || { truth: 0, matched: 0, within25: 0 };
    byTrade[k].truth++;
  });
  detail.matched.forEach(function (m) {
    var k = (m.trade || 'unassigned').toLowerCase().trim();
    byTrade[k] = byTrade[k] || { truth: 0, matched: 0, within25: 0 };
    byTrade[k].matched++;
    if (m.within25) byTrade[k].within25++;
  });
  Object.keys(byTrade).forEach(function (k) {
    var b = byTrade[k];
    b.coverage = b.truth ? b.matched / b.truth : 0;
    b.precision25 = b.matched ? b.within25 / b.matched : 0;
  });

  return {
    eligibleItems: eligible.length,
    predictedItems: predicted.length,
    matchedItems: matched,
    coverage: coverage,
    precision10: precision10,
    precision25: precision25,
    composite: composite,
    predictedTotal: predTotal,
    bidTotal: bidTotal,
    totalDelta: totalDelta,
    byTrade: byTrade,
    detail: detail
  };
}

module.exports = { score: score, similarity: similarity, normUnit: normUnit, tokens: tokens, withinTolerance: withinTolerance };
