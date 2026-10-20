// Photoreal visuals of a plan set: exterior, the main living space, and a 3D
// floor plan. The image model is shown the contractor's own drawing sheets and
// told only facts the plan reader verified (rooms, bedrooms, size, roof), so it
// draws THIS house instead of inventing one.
//
//   OrchaVisuals.facts(extracted, geom, scope)  -> plain facts
//   OrchaVisuals.prompt(kind, facts)            -> text for /api/render
//   OrchaVisuals.pickSheets(kind, staged, sheets) -> [{file, page}] to send
// kind: 'exterior' | 'interior' | 'plan3d'
(function (root) {
  var OUTDOOR = /porch|patio|deck|garage|carport|terrace|balcony|veranda|lanai|breezeway|yard|driveway/i;
  var LIVING = /kitchen|living|dining|great room|family room/i;  // not 'den': on most plans that is an office

  function num(x) { var n = Number(x); return isFinite(n) && n > 0 ? n : 0; }
  function uniq(a) { var seen = {}; return a.filter(function (x) { var k = String(x).toLowerCase().trim(); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function facts(e, g, scope) {
    e = e || {}; g = g || {};
    var rooms = uniq(((e.rooms || []).map(function (r) { return clean(r && r.name); }))
      .concat(e.rooms && e.rooms.length ? [] : (g.rooms || []).map(function (r) { return clean(r && (r.name || r.label)); })));
    var indoor = rooms.filter(function (n) { return !OUTDOOR.test(n); });
    var outdoor = rooms.filter(function (n) { return OUTDOOR.test(n); });
    var bedrooms = uniq((e.bedrooms || []).map(clean));
    if (!bedrooms.length) bedrooms = indoor.filter(function (n) { return /bed ?room|master|primary suite|guest suite/i.test(n) && !/bath|closet|wic/i.test(n); });
    var ev = e.elevations || {};
    var faces = ['front', 'back', 'left', 'right'].map(function (k) { return ev[k]; }).filter(Boolean);
    var od = e.overallDims || {};
    var rs = e.raisedSection || {};
    var roof = String(e.roof || g.roof || '').toLowerCase();
    return {
      sqft: num(e.totalPrintedSqft) || num(g.totalSqft),
      stories: num(e.stories) || num(g.stories) || 1,
      widthFt: num(od.widthFt), depthFt: num(od.depthFt),
      roof: /flat/.test(roof) ? 'flat' : /slope|shed|mono/.test(roof) ? 'low-slope' : /hip/.test(roof) ? 'hip' : /gable/.test(roof) ? 'gable' : '',
      raised: !!(rs.present) || faces.some(function (f) { return f && f.clerestory; }),
      raisedHeightFt: num(rs.heightFt),
      windowWall: faces.some(function (f) { return f && /window-wall|mixed/.test(f.style || ''); }),
      porchSide: (e.porchInfo && e.porchInfo.side) || '',
      rooms: indoor.slice(0, 24),
      outdoor: outdoor.slice(0, 6),
      bedrooms: bedrooms,
      living: indoor.filter(function (n) { return LIVING.test(n); }),
      scope: clean(scope).slice(0, 300)
    };
  }

  function ft(n) { return Math.round(n) + ' ft'; }
  function storyLine(f) {
    if (f.stories >= 2) return 'a ' + (f.stories >= 3 ? f.stories + '-story' : 'two-story') + ' house';
    return 'a single-story house (one floor only, no second story, no upper-floor windows)';
  }
  function roofLine(f) {
    return f.roof === 'flat' ? 'flat roofs with thin fascia' : f.roof === 'low-slope' ? 'low-slope roofs with deep overhangs'
      : f.roof === 'hip' ? 'a hipped roof' : f.roof === 'gable' ? 'a gabled roof' : '';
  }
  var NO_TEXT = 'No text, letters, labels, numbers, dimensions or watermarks anywhere in the image. No people.';

  function prompt(kind, f) {
    f = f || facts();
    var size = (f.widthFt && f.depthFt ? ', about ' + ft(f.widthFt) + ' long and ' + ft(f.depthFt) + ' deep' : '') + (f.sqft ? ', ' + Math.round(f.sqft).toLocaleString('en-US') + ' sq ft' : '');
    var notes = f.scope ? ' Contractor notes on finishes: ' + f.scope + '.' : '';
    if (kind === 'exterior') {
      var feats = [roofLine(f)];
      if (f.raised) feats.push('a raised center section' + (f.raisedHeightFt ? ' about ' + ft(f.raisedHeightFt) + ' high' : '') + ' with a band of clerestory windows');
      if (f.windowWall) feats.push('floor-to-ceiling window walls');
      if (f.porchSide) feats.push('a covered porch along the ' + f.porchSide);
      return 'Photorealistic architectural photograph of exactly this building: ' + storyLine(f) + size + ', with ' + feats.filter(Boolean).join(', ') + '. '
        + 'Exterior materials and colors exactly as the elevations show them.' + notes + ' '
        + 'Three-quarter view from the front at eye level, 24mm lens, natural landscaping that suits the site, soft golden-hour light, interior lights glowing softly, crisp realistic detail. ' + NO_TEXT;
    }
    if (kind === 'interior') {
      var space = f.living.length ? 'the ' + f.living.slice(0, 4).join(', ').toLowerCase() : 'the main living space';
      return 'Photorealistic interior photograph of ' + space + ' of exactly this house' + (f.stories < 2 ? ' (single story)' : '') + ', laid out as the floor plan shows: same room arrangement, same window and door positions'
        + (f.raised ? ', ceiling rising to the clerestory windows of the raised center section' : '')
        + (f.windowWall ? ', floor-to-ceiling glass walls looking outside' : '') + '. '
        + 'Furnished, warm and realistic, with finishes that match the exterior materials on the elevations.' + notes + ' '
        + 'Architectural-magazine style, 20mm lens, natural daylight. ' + NO_TEXT;
    }
    if (kind === 'plan3d') {
      var nb = f.bedrooms.length;
      return 'Turn this floor plan into a photorealistic top-down 3D cutaway floor plan: walls cut at about 8 ft, no roof, seen from above at a slight angle. '
        + 'Keep the exact layout, wall positions and proportions of the drawing' + size + '. '
        + (f.rooms.length ? 'The home has exactly these rooms, each appearing ONCE: ' + f.rooms.join('; ') + '. ' : '')
        + (nb ? 'Exactly ' + nb + ' bedroom' + (nb > 1 ? 's' : '') + ' (' + f.bedrooms.join('; ') + ') and so exactly ' + nb + ' bed' + (nb > 1 ? 's' : '') + ' in the whole image. ' : '')
        + 'Do not add, duplicate, merge or move rooms. '
        + (f.outdoor.length ? 'Outdoor areas, kept outside the walls: ' + f.outdoor.join('; ') + '. ' : '')
        + 'Furnish each room for its use (beds only in bedrooms), light wood floors, tile in baths, white walls, soft daylight, clean premium real-estate style.' + notes + ' ' + NO_TEXT;
    }
    throw new Error('unknown view ' + kind);
  }

  // Which sheets to show the image model for each view.
  //   staged: [{kind:'floor'|'elev'|'auto'|..., isPdf:bool}] in upload order
  //   sheets: plan reader's inventory [{type, file (1-based), page (1-based)|null}]
  function pickSheets(kind, staged, sheets) {
    staged = staged || []; sheets = sheets || [];
    var floors = [], elevs = [];
    function add(list, file, page) {
      if (file < 0 || file >= staged.length) return;
      if (!staged[file].isPdf) page = null;                      // a photo has no pages
      if (staged[file].isPdf && !page) page = staged[file].pages === 1 ? 1 : 0;
      if (staged[file].isPdf && !page) return;                   // unknown page of a multi-page PDF
      var key = file + ':' + (page || 0);
      if (list.some(function (x) { return x.key === key; })) return;
      list.push({ file: file, page: page || null, key: key });
    }
    staged.forEach(function (s, i) {
      if (s.kind === 'floor') add(floors, i, s.isPdf && s.pages === 1 ? 1 : null);
      if (s.kind === 'elev') add(elevs, i, s.isPdf && s.pages === 1 ? 1 : null);
    });
    sheets.forEach(function (sh) {
      var fi = (Number(sh && sh.file) || 0) - 1;
      var pg = Number(sh && sh.page) || null;
      if (!sh || fi < 0) return;
      if (sh.type === 'floorplan') add(floors, fi, pg);
      if (sh.type === 'elevation') add(elevs, fi, pg);
    });
    // Nothing identified, but the upload is a couple of plain images: show them all.
    if (!floors.length && !elevs.length) {
      var imgs = [];
      staged.forEach(function (s, i) { if (!s.isPdf) imgs.push({ file: i, page: null, key: i + ':0' }); });
      if (kind === 'plan3d') return imgs.slice(0, 1);
      return imgs.slice(0, 3);
    }
    var pick = kind === 'exterior' ? elevs.slice(0, 2).concat(floors.slice(0, 1))
      : kind === 'interior' ? floors.slice(0, 1).concat(elevs.slice(0, 1))
      : floors.slice(0, 1);
    return pick.slice(0, 3).map(function (x) { return { file: x.file, page: x.page }; });
  }

  // Picture shape for each view. The 3D plan follows the footprint (a long
  // ranch house needs a wide picture); photos are always 16:9.
  function aspect(kind, f) {
    if (kind !== 'plan3d') return '16:9';
    f = f || {};
    var w = f.widthFt, d = f.depthFt;
    if (w && !d && f.sqft && f.stories) d = f.sqft / f.stories / w;      // depth not printed: from the area
    if (!w || !d) return '4:3';
    var r = Math.max(w, d) / Math.min(w, d);
    var opts = [['1:1', 1], ['4:3', 4 / 3], ['3:2', 1.5], ['16:9', 16 / 9], ['21:9', 21 / 9]];
    var best = opts.reduce(function (a, b) { return Math.abs(Math.log(b[1] / r)) < Math.abs(Math.log(a[1] / r)) ? b : a; })[0];
    return best;
  }

  var api = { facts: facts, prompt: prompt, pickSheets: pickSheets, aspect: aspect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrchaVisuals = api;
})(typeof window !== 'undefined' ? window : this);
