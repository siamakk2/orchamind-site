// Deterministic quantity takeoff.
//
// The estimator currently asks the model for {desc, qty, unit, price} — it asks
// a language model to do arithmetic and pricing in its head. That is why the
// published benchmark puts a frontier model at 44.7% precision on a ±25%
// tolerance: more than half its quantities are off by more than a quarter.
//
// The model's job is to READ the drawing. This file's job is to COMPUTE from
// what it read. Same inputs always give the same numbers, every formula is
// recorded next to its result, and a contractor can audit any line.
//
// Two rules that matter more than they look:
//
//   ROUND UP, ALWAYS. A slab needing 5.33 cubic yards is a 5.5 yard order. Every
//   estimator on earth knows this; models round it to 5, because 5.33 is nearer
//   5 than 6. You cannot pour concrete you did not order.
//
//   NEVER INVENT. If an input is missing, the quantity is null with a stated
//   reason. A plausible number with no basis is worse than a visible gap — the
//   gap gets questioned, the number gets bid.

function num(v) {
  if (v == null || v === '') return null;
  var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

// Feet from a printed dimension: 42, "42", "42'-6\"", "42 ft 6 in", "42'6".
// The dash in 42'-6" is a separator, not a minus. Reading it as feet-only
// silently drops six inches, and on a perimeter that compounds into real money.
function feet(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  var s = String(v).trim();
  if (!/\d/.test(s)) return null;
  // feet AND inches
  var m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet)\s*[-\u2013\u2014]?\s*(\d+(?:\.\d+)?)\s*(?:"|''|in\.?|inches)?/i);
  if (m) {
    var ft = parseFloat(m[1]), inch = parseFloat(m[2]);
    if (isFinite(ft) && isFinite(inch) && inch < 12) return ft + inch / 12;
  }
  // feet only
  var m2 = s.match(/(-?\d+(?:\.\d+)?)/);
  if (m2) { var f2 = parseFloat(m2[1]); if (isFinite(f2)) return f2; }
  return null;
}

// Round UP to a buying increment. This is the whole point.
function up(value, increment) {
  if (value == null) return null;
  var inc = increment || 1;
  return Math.ceil((value - 1e-9) / inc) * inc;
}

function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

// Roof surface is longer than its footprint by the slope. sqrt(1+(rise/12)^2).
function pitchFactor(pitch) {
  if (pitch == null) return null;
  var rise = null;
  if (typeof pitch === 'number') rise = pitch;
  else {
    var m = String(pitch).match(/(\d+(?:\.\d+)?)\s*(?::|\/|\s+in\s+)\s*12/i);
    if (m) rise = parseFloat(m[1]);
  }
  if (rise == null || !isFinite(rise) || rise < 0 || rise > 24) return null;
  return Math.sqrt(1 + (rise / 12) * (rise / 12));
}

function item(trade, desc, qty, unit, formula, note) {
  return {
    trade: trade, item: desc,
    qty: qty == null ? null : round2(qty),
    unit: unit,
    formula: formula || null,
    note: note || null,
    computed: qty != null
  };
}
function missing(trade, desc, unit, why) {
  return { trade: trade, item: desc, qty: null, unit: unit, formula: null, note: why, computed: false };
}

/**
 * @param {Object} e  the transcription: what the model READ off the sheets
 *   { totalPrintedSqft, stories, storyHeightFt, roof:{form,pitch},
 *     overallDims:{widthFt,depthFt}, areaSchedule:[{label,sqft}],
 *     rooms:[{name,dims}], windowCount, doorCount, slabThicknessIn }
 * @param {Object} opts { wastePct:{...}, studSpacingIn, slabThicknessIn }
 * @returns {Object} { items, inputs, assumptions, unresolved }
 */
function computeQuantities(e, opts) {
  e = e || {}; opts = opts || {};
  var items = [], assumptions = [], unresolved = [];

  var WASTE = Object.assign({
    framing: 0.10, sheathing: 0.10, drywall: 0.10,
    insulation: 0.05, roofing: 0.10, concrete: 0.05, paint: 0.05
  }, opts.wastePct || {});
  var studSpacing = num(opts.studSpacingIn) || 16;
  var slabThickness = num(opts.slabThicknessIn) || num(e.slabThicknessIn) || 4;

  // ---- inputs, taken only from what was printed -------------------------
  var stories = num(e.stories) || null;
  var plateH = feet(e.storyHeightFt) || null;
  var condSqft = num(e.totalPrintedSqft);

  // Conditioned area from the schedule if a total was not printed. Porches,
  // patios, decks and garages are excluded — counting them is how a 2,486 ft
  // house becomes a 3,138 ft bid.
  var EXCLUDE = /\b(garage|porch|patio|deck|balcony|terrace|carport|breezeway|total)\b/i;
  var schedCond = null;
  if (Array.isArray(e.areaSchedule) && e.areaSchedule.length) {
    var sum = 0, any = false;
    e.areaSchedule.forEach(function (r) {
      var label = String(r && (r.label || r.name) || '');
      var v = num(r && (r.sqft != null ? r.sqft : r.value));
      if (v == null || EXCLUDE.test(label)) return;
      sum += v; any = true;
    });
    if (any) schedCond = sum;
  }
  if (condSqft == null && schedCond != null) {
    condSqft = schedCond;
    assumptions.push('No printed total found; conditioned area summed from the area schedule, excluding garage, porch, patio and deck rows.');
  } else if (condSqft != null && schedCond != null && Math.abs(schedCond - condSqft) / condSqft > 0.02) {
    unresolved.push('The printed total (' + condSqft + ' sq ft) and the sum of the conditioned schedule rows ('
      + round2(schedCond) + ' sq ft) disagree by more than 2%. Using the printed total; check the schedule.');
  }

  // Footprint: the area that sits on the ground.
  var W = feet(e.overallDims && (e.overallDims.widthFt || e.overallDims.width));
  var D = feet(e.overallDims && (e.overallDims.depthFt || e.overallDims.depth));
  var footprint = null, footprintSource = null;
  if (W && D) { footprint = W * D; footprintSource = 'overall printed dimensions ' + round2(W) + ' x ' + round2(D); }
  else if (condSqft != null && stories) {
    footprint = condSqft / stories;
    footprintSource = 'conditioned area divided by ' + stories + ' stories';
    assumptions.push('No overall dimensions printed; footprint taken as conditioned area / stories. This assumes the floors stack, which a stepped or cantilevered plan does not.');
  }

  // Perimeter. A rectangle is a floor on the true figure for any other shape,
  // so this is flagged rather than quietly used.
  var perim = null, perimSource = null;
  if (W && D) { perim = 2 * (W + D); perimSource = 'from printed overall dimensions'; }
  else if (footprint) {
    perim = 4 * Math.sqrt(footprint);
    perimSource = 'square approximation of the footprint';
    assumptions.push('Wall perimeter approximated as a square of the footprint area. An L-shaped or articulated plan has MORE wall than this; treat framing and siding as a floor, not a bid.');
  }

  var inputs = {
    conditionedSqft: condSqft, stories: stories, plateHeightFt: plateH,
    footprintSqft: footprint == null ? null : round2(footprint), footprintSource: footprintSource,
    perimeterFt: perim == null ? null : round2(perim), perimeterSource: perimSource,
    slabThicknessIn: slabThickness, studSpacingIn: studSpacing
  };

  // ---- exterior wall area ------------------------------------------------
  var wallArea = null;
  if (perim && plateH && stories) {
    wallArea = perim * plateH * stories;
  } else {
    var why = [];
    if (!perim) why.push('no perimeter');
    if (!plateH) why.push('no printed plate height');
    if (!stories) why.push('no story count');
    unresolved.push('Exterior wall area not computed: ' + why.join(', ') + '.');
  }

  // ---- CONCRETE ----------------------------------------------------------
  if (footprint) {
    var cy = footprint * (slabThickness / 12) / 27;
    var cyWaste = cy * (1 + WASTE.concrete);
    items.push(item('Concrete', 'Slab on grade, ' + slabThickness + '" thick', up(cyWaste, 0.5), 'CY',
      round2(footprint) + ' sf x ' + slabThickness + '/12 ft / 27 = ' + round2(cy) + ' CY, +'
      + Math.round(WASTE.concrete * 100) + '% waste = ' + round2(cyWaste) + ', rounded UP to the next 1/2 yard',
      'Ready-mix is ordered in half-yard increments and always rounded up — a short pour costs far more than the extra half yard.'));
  } else {
    items.push(missing('Concrete', 'Slab on grade', 'CY', 'Needs a footprint: print overall dimensions, or an area schedule plus story count.'));
  }

  // ---- FRAMING -----------------------------------------------------------
  if (perim && stories) {
    var plateLF = perim * stories * 3; // bottom plate + double top plate
    items.push(item('Framing', 'Wall plates (1 bottom + 2 top)', up(plateLF * (1 + WASTE.framing), 1), 'LF',
      round2(perim) + ' LF perimeter x ' + stories + ' stories x 3 plates, +' + Math.round(WASTE.framing * 100) + '% waste',
      null));
  } else {
    items.push(missing('Framing', 'Wall plates', 'LF', 'Needs perimeter and story count.'));
  }
  if (perim && stories) {
    // Studs at spacing, plus three per corner and two per opening.
    var runStuds = (perim * stories) * (12 / studSpacing) + 1;
    var corners = 4 * 3 * stories;
    var openings = (num(e.windowCount) || 0) + (num(e.doorCount) || 0);
    var openStuds = openings * 2;
    if (!openings) assumptions.push('No window or door count available, so no extra studs were added for openings. Real framing needs 2 per opening.');
    var studs = (runStuds + corners + openStuds) * (1 + WASTE.framing);
    items.push(item('Framing', 'Studs, ' + studSpacing + '" o.c.', up(studs, 1), 'EA',
      round2(perim * stories) + ' LF / ' + studSpacing + '" + ' + corners + ' corner + ' + openStuds
      + ' opening studs, +' + Math.round(WASTE.framing * 100) + '% waste',
      'Exterior walls only. Interior partitions are not in this figure.'));
  }

  // ---- SHEATHING, INSULATION, DRYWALL, PAINT -----------------------------
  if (wallArea) {
    var shA = wallArea * (1 + WASTE.sheathing);
    items.push(item('Framing', 'Wall sheathing, 4x8 sheets', up(shA / 32, 1), 'EA',
      round2(wallArea) + ' sf wall, +' + Math.round(WASTE.sheathing * 100) + '% waste, / 32 sf per sheet, rounded UP', null));
    items.push(item('Insulation', 'Exterior wall insulation', up(wallArea * (1 + WASTE.insulation), 1), 'SF',
      round2(wallArea) + ' sf +' + Math.round(WASTE.insulation * 100) + '% waste', null));
  } else {
    items.push(missing('Framing', 'Wall sheathing', 'EA', 'Needs perimeter, plate height and story count.'));
    items.push(missing('Insulation', 'Exterior wall insulation', 'SF', 'Needs exterior wall area.'));
  }

  if (wallArea && condSqft) {
    // Interior face of exterior walls, plus ceilings. Partitions are excluded
    // and said so, rather than being folded in with a guessed multiplier.
    var ceil = condSqft;
    var dwArea = (wallArea + ceil) * (1 + WASTE.drywall);
    items.push(item('Drywall', 'Drywall, 4x8 sheets', up(dwArea / 32, 1), 'EA',
      '(' + round2(wallArea) + ' sf wall + ' + round2(ceil) + ' sf ceiling) +'
      + Math.round(WASTE.drywall * 100) + '% waste, / 32 sf per sheet, rounded UP',
      'Interior partitions are NOT included — add them once partition lengths are taken off.'));
    var paintArea = (wallArea + ceil) * (1 + WASTE.paint);
    items.push(item('Paint', 'Paint, 2 coats', up(paintArea * 2 / 350, 1), 'GAL',
      round2(paintArea) + ' sf x 2 coats / 350 sf per gallon, rounded UP',
      'Coverage of 350 sf/gal is a standard figure, not a product spec.'));
  }

  // ---- ROOFING -----------------------------------------------------------
  if (footprint) {
    var pf = pitchFactor(e.roof && (e.roof.pitch || e.roof.slope));
    if (pf == null) {
      pf = pitchFactor('6:12');
      assumptions.push('No roof pitch printed; 6:12 assumed (factor ' + round2(pf) + '). A 12:12 roof is 26% more surface than a 6:12 — confirm before bidding.');
    }
    var roofSf = footprint * pf;
    var squares = roofSf * (1 + WASTE.roofing) / 100;
    items.push(item('Roofing', 'Roof covering', up(squares, 1), 'SQ',
      round2(footprint) + ' sf footprint x ' + round2(pf) + ' pitch factor = ' + round2(roofSf)
      + ' sf, +' + Math.round(WASTE.roofing * 100) + '% waste, / 100 sf per square, rounded UP',
      'Overhangs, dormers, valleys and hips are not in this figure.'));
  } else {
    items.push(missing('Roofing', 'Roof covering', 'SQ', 'Needs a footprint.'));
  }

  // ---- FLOORING ----------------------------------------------------------
  if (condSqft) {
    items.push(item('Flooring', 'Finished flooring', up(condSqft * 1.07, 1), 'SF',
      round2(condSqft) + ' sf conditioned +7% waste',
      'Conditioned area only. Garage, porch and patio are excluded.'));
  } else {
    items.push(missing('Flooring', 'Finished flooring', 'SF', 'Needs a conditioned area figure.'));
  }

  return {
    items: items,
    inputs: inputs,
    assumptions: assumptions,
    unresolved: unresolved,
    computedCount: items.filter(function (i) { return i.computed; }).length,
    missingCount: items.filter(function (i) { return !i.computed; }).length
  };
}

var _api = {
  computeQuantities: computeQuantities,
  feet: feet, up: up, pitchFactor: pitchFactor
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.OrchaQuantities = _api;
