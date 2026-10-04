// Cross-check two independent transcriptions of the same plan set.
//
// Pass 1 of the estimator transcribes what is PRINTED on the sheets. A printed
// number has exactly one correct reading, so if two independent readers — two
// different models, which fail differently — disagree about it, one of them is
// wrong and we should say so rather than quietly picking a side.
//
// The failure this is built for is the one the prompt already warns about:
// "1,156" read as "156". A dropped leading digit produces a ~10x error that
// looks perfectly plausible downstream and poisons every quantity derived from
// it. Two readers almost never drop the same digit.
//
// Output is a conflict list, not a verdict. The estimator shows conflicts to
// the contractor, who can see the sheet and settle it in two seconds. That is
// the right division of labour: we are good at noticing, they are good at
// knowing.

function num(v) {
  if (v == null || v === '') return null;
  var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

function relDiff(a, b) {
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return 0;
  var denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
}

// Is one value a digit-shifted version of the other? 1156 vs 156, 420 vs 42.
function looksLikeDroppedDigit(a, b) {
  if (a == null || b == null || a === 0 || b === 0) return false;
  var hi = Math.max(Math.abs(a), Math.abs(b));
  var lo = Math.min(Math.abs(a), Math.abs(b));
  var ratio = hi / lo;
  // A clean power-of-ten relationship, or the specific "leading digit lost"
  // shape where the smaller number is the tail of the larger one.
  if (Math.abs(ratio - 10) < 1.6 || Math.abs(ratio - 100) < 16) return true;
  var hs = String(Math.round(hi)), ls = String(Math.round(lo));
  return hs.length === ls.length + 1 && hs.slice(1) === ls;
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// severity: 'critical' — a value we derive everything else from, or a
// dropped-digit shape. 'warn' — worth a look. Nothing else is reported.
function pushConflict(out, field, label, a, b, severity, note) {
  out.push({ field: field, label: label, a: a, b: b, severity: severity, note: note || null });
}

/**
 * @param {Object} a  transcription from reader A (the primary/deep model)
 * @param {Object} b  transcription from reader B (the independent second model)
 * @param {Object} opts { sqftTolerance:Number }  default 0.02
 * @returns {Object} { agreed, conflicts, checked, confidence }
 */
function crossCheck(a, b, opts) {
  opts = opts || {};
  var tol = opts.sqftTolerance != null ? opts.sqftTolerance : 0.02;
  var conflicts = [];
  var checked = 0;

  // Nothing to compare against — not an agreement, just an absence.
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return { agreed: false, conflicts: [], checked: 0, confidence: null, unavailable: true };
  }

  // --- the load-bearing number -------------------------------------------
  var ta = num(a.totalPrintedSqft), tb = num(b.totalPrintedSqft);
  if (ta != null || tb != null) {
    checked++;
    if (ta == null || tb == null) {
      pushConflict(conflicts, 'totalPrintedSqft', 'Total printed square footage',
        ta, tb, 'warn', 'Only one reader found a printed total.');
    } else if (looksLikeDroppedDigit(ta, tb)) {
      pushConflict(conflicts, 'totalPrintedSqft', 'Total printed square footage',
        ta, tb, 'critical', 'These differ by about 10x — one reader almost certainly dropped a leading digit. Check the area schedule.');
    } else if (relDiff(ta, tb) > tol) {
      pushConflict(conflicts, 'totalPrintedSqft', 'Total printed square footage',
        ta, tb, 'critical', 'Every quantity is derived from this number.');
    }
  }

  // --- stories ------------------------------------------------------------
  var sa = num(a.stories), sb = num(b.stories);
  if (sa != null && sb != null) {
    checked++;
    if (sa !== sb) {
      pushConflict(conflicts, 'stories', 'Number of stories', sa, sb, 'critical',
        'Story count changes the massing and roughly doubles or halves the framing.');
    }
  }

  // --- area schedule, row by row -----------------------------------------
  var ra = Array.isArray(a.areaSchedule) ? a.areaSchedule : [];
  var rb = Array.isArray(b.areaSchedule) ? b.areaSchedule : [];
  if (ra.length || rb.length) {
    var mapB = {};
    rb.forEach(function (r) { mapB[norm(r.label || r.name || r.area || '')] = r; });
    ra.forEach(function (r) {
      var key = norm(r.label || r.name || r.area || '');
      if (!key) return;
      var other = mapB[key];
      if (!other) {
        pushConflict(conflicts, 'areaSchedule:' + key, 'Area row "' + (r.label || key) + '"',
          num(r.sqft != null ? r.sqft : r.value), null, 'warn', 'Only the first reader saw this row.');
        return;
      }
      checked++;
      var va = num(r.sqft != null ? r.sqft : r.value);
      var vb = num(other.sqft != null ? other.sqft : other.value);
      if (va == null || vb == null) return;
      if (looksLikeDroppedDigit(va, vb)) {
        pushConflict(conflicts, 'areaSchedule:' + key, 'Area row "' + (r.label || key) + '"',
          va, vb, 'critical', 'Differ by about 10x — likely a dropped leading digit.');
      } else if (relDiff(va, vb) > tol) {
        pushConflict(conflicts, 'areaSchedule:' + key, 'Area row "' + (r.label || key) + '"',
          va, vb, 'warn', null);
      }
    });
    rb.forEach(function (r) {
      var key = norm(r.label || r.name || r.area || '');
      if (!key) return;
      var seen = ra.some(function (x) { return norm(x.label || x.name || x.area || '') === key; });
      if (!seen) {
        pushConflict(conflicts, 'areaSchedule:' + key, 'Area row "' + (r.label || key) + '"',
          null, num(r.sqft != null ? r.sqft : r.value), 'warn', 'Only the second reader saw this row.');
      }
    });
  }

  // --- window counts ------------------------------------------------------
  function windowTotal(x) {
    if (x == null) return null;
    if (typeof x === 'number') return x;
    if (Array.isArray(x)) {
      return x.reduce(function (s, w) {
        var c = num(w && (w.count != null ? w.count : w.qty));
        return s + (c == null ? 0 : c);
      }, 0);
    }
    if (typeof x === 'object') {
      var keys = Object.keys(x), t = 0, any = false;
      keys.forEach(function (k) { var c = num(x[k]); if (c != null) { t += c; any = true; } });
      return any ? t : null;
    }
    return null;
  }
  var wa = windowTotal(a.windows), wb = windowTotal(b.windows);
  if (wa != null && wb != null && (wa > 0 || wb > 0)) {
    checked++;
    if (relDiff(wa, wb) > 0.15) {
      pushConflict(conflicts, 'windows', 'Total window count', wa, wb, 'warn',
        'Window counts drive glazing, headers and trim.');
    }
  }

  // --- roof form ----------------------------------------------------------
  var fa = norm(a.roof && (a.roof.form || a.roof.type) || a.roofForm);
  var fb = norm(b.roof && (b.roof.form || b.roof.type) || b.roofForm);
  if (fa && fb) {
    checked++;
    if (fa !== fb) {
      pushConflict(conflicts, 'roof', 'Roof form', fa, fb, 'warn',
        'Roof form changes the roofing quantity and the look of the model.');
    }
  }

  var critical = conflicts.filter(function (c) { return c.severity === 'critical'; }).length;
  // Confidence is a plain ratio of checks that agreed — not a probability, and
  // never presented as one.
  var confidence = checked ? Math.max(0, (checked - conflicts.length) / checked) : null;

  return {
    agreed: conflicts.length === 0,
    criticalCount: critical,
    conflicts: conflicts,
    checked: checked,
    confidence: confidence
  };
}

// Dual-mode export. The estimator runs this in the browser and the tests run it
// in Node, and they must be the SAME code: a cross-checker that drifts from its
// tests is worse than none, because it still looks like it is being verified.
var _api = { crossCheck: crossCheck, looksLikeDroppedDigit: looksLikeDroppedDigit, relDiff: relDiff };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.OrchaCrossCheck = _api;
