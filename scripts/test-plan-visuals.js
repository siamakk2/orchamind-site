// Photoreal visuals: the image model is told only verified facts, the right
// sheets are picked for each view, and the engine accepts drawings.

var V = require('../lib/plan-visuals.js');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}

// What the plan reader returns for the Napa Lindal house (Love Kalhor residence).
var napa = {
  totalPrintedSqft: 2616, stories: 1, roof: 'low-slope',
  overallDims: { widthFt: 96, depthFt: 27.25 },
  rooms: [{ name: 'Bedroom 2' }, { name: 'Office/Den Workout' }, { name: 'Utility' }, { name: 'Laundry' }, { name: 'Bath' }, { name: 'Pantry' },
    { name: 'Kitchen' }, { name: 'Dining' }, { name: 'Living' }, { name: 'Entry' }, { name: 'Master Bedroom' }, { name: 'Master Closet' },
    { name: 'Master Bath' }, { name: 'Covered Porch' }, { name: 'Kitchen' }],
  bedrooms: ['Bedroom 2', 'Master Bedroom'],
  elevations: { present: true, front: { windows: 12, style: 'window-wall', clerestory: true, door: true }, back: { windows: 10, style: 'window-wall', clerestory: true } },
  raisedSection: { present: true, fromFt: 32, toFt: 64, heightFt: 16.1 },
  porchInfo: { side: 'back', printedDims: "53'-9 1/8\"" },
  sheets: [{ label: 'Floor plan', type: 'floorplan', file: 2, page: 1 }, { label: 'Elevations', type: 'elevation', file: 1, page: 1 }]
};

console.log('\nfacts from the plan reader');
var f = V.facts(napa, null, 'dark charred cedar siding, black window frames');
check('size: 96 x 27 ft, 2,616 sq ft, one story', f.widthFt === 96 && f.depthFt === 27.25 && f.sqft === 2616 && f.stories === 1);
check('two bedrooms, by name', f.bedrooms.length === 2 && f.bedrooms.indexOf('Master Bedroom') > -1);
check('a room listed twice by the reader appears once', f.rooms.filter(function (r) { return r === 'Kitchen'; }).length === 1);
check('porch is kept out of the indoor room list', f.rooms.indexOf('Covered Porch') === -1 && f.outdoor.indexOf('Covered Porch') > -1);
check('raised clerestory section and window walls noticed', f.raised && f.windowWall && f.raisedHeightFt === 16.1);
check('the living spaces are kitchen, dining, living', f.living.join(',') === 'Kitchen,Dining,Living');
var g = V.facts({}, { totalSqft: 1800, stories: 2, rooms: [{ name: 'Bedroom' }, { name: 'Garage' }] }, '');
check('falls back to the 3D model when the reader had nothing', g.sqft === 1800 && g.stories === 2 && g.rooms.join() === 'Bedroom' && g.outdoor.join() === 'Garage');
var none = V.facts(null, null, '');
check('nothing at all: still safe', none.stories === 1 && none.rooms.length === 0);

console.log('\nwhat each picture is asked for');
var ext = V.prompt('exterior', f), inn = V.prompt('interior', f), p3 = V.prompt('plan3d', f);
[['exterior', ext], ['interior', inn], ['plan3d', p3]].forEach(function (x) {
  check(x[0] + ': fits the engine limit (2,400 characters)', x[1].length <= 2400, x[1].length);
  check(x[0] + ': forbids text, labels and dimensions in the image', /No text, letters, labels/.test(x[1]));
  check(x[0] + ': carries the contractor\'s finish notes', /dark charred cedar/.test(x[1]));
});
check('exterior: single story stated firmly', /single-story house \(one floor only/.test(ext));
check('exterior: real size and raised clerestory section', /96 ft long and 27 ft deep/.test(ext) && /2,616 sq ft/.test(ext) && /clerestory/.test(ext));
check('exterior: materials come from the elevations, not invented', /materials and colors exactly as the elevations show/.test(ext));
check('interior: names the real living spaces', /the kitchen, dining, living/.test(inn));
check('3D plan: lists every room once', /each appearing ONCE: Bedroom 2; Office\/Den Workout; .*Master Bath\./.test(p3));
check('3D plan: exactly 2 bedrooms and exactly 2 beds (the error in the first try)', /Exactly 2 bedrooms \(Bedroom 2; Master Bedroom\) and so exactly 2 beds/.test(p3));
check('3D plan: no adding or duplicating rooms', /Do not add, duplicate, merge or move rooms/.test(p3));
check('3D plan: porch stays outside', /Outdoor areas, kept outside the walls: Covered Porch/.test(p3));
var two = V.prompt('exterior', V.facts({ stories: 2 }, null, ''));
check('two-story house is described as two-story', /a two-story house/.test(two) && !/single-story/.test(two));
var bigRooms = { rooms: [] }; for (var i = 0; i < 60; i++) bigRooms.rooms.push({ name: 'Room number ' + i + ' with a long printed name' });
check('a huge room list still fits the limit', V.prompt('plan3d', V.facts(bigRooms, null, 'x'.repeat(500))).length <= 2400);
var threw = false; try { V.prompt('aerial', f); } catch (e) { threw = true; }
check('unknown view is refused', threw);

console.log('\nwhich sheets the engine sees');
var staged = [{ kind: 'auto', isPdf: false }, { kind: 'auto', isPdf: false }];
var ex = V.pickSheets('exterior', staged, napa.sheets);
check('exterior: elevation first, then floor plan', JSON.stringify(ex) === JSON.stringify([{ file: 0, page: null }, { file: 1, page: null }]), JSON.stringify(ex));
check('3D plan: only the floor plan', JSON.stringify(V.pickSheets('plan3d', staged, napa.sheets)) === JSON.stringify([{ file: 1, page: null }]));
check('interior: floor plan, then an elevation', JSON.stringify(V.pickSheets('interior', staged, napa.sheets)) === JSON.stringify([{ file: 1, page: null }, { file: 0, page: null }]));
var lbl = [{ kind: 'floor', isPdf: false }, { kind: 'elev', isPdf: false }];
check('contractor\'s own sheet labels are used when the reader gave none', JSON.stringify(V.pickSheets('plan3d', lbl, [])) === JSON.stringify([{ file: 0, page: null }]));
var pdf = [{ kind: 'auto', isPdf: true, pages: 15 }];
var pdfSheets = [{ type: 'floorplan', file: 1, page: 3 }, { type: 'elevation', file: 1, page: 5 }, { type: 'elevation', file: 1, page: 6 }, { type: 'elevation', file: 1, page: 5 }];
check('15-page PDF: the exact pages the reader identified', JSON.stringify(V.pickSheets('exterior', pdf, pdfSheets)) === JSON.stringify([{ file: 0, page: 5 }, { file: 0, page: 6 }, { file: 0, page: 3 }]));
check('multi-page PDF with unknown pages: send nothing (falls back to the 3D model)', V.pickSheets('exterior', pdf, []).length === 0);
check('one-page PDF labelled floor plan: page 1', JSON.stringify(V.pickSheets('plan3d', [{ kind: 'floor', isPdf: true, pages: 1 }], [])) === JSON.stringify([{ file: 0, page: 1 }]));
check('unlabelled photos, nothing identified: show them (max 3)', V.pickSheets('exterior', [{ kind: 'auto' }, { kind: 'auto' }, { kind: 'auto' }, { kind: 'auto' }], []).length === 3);
check('a sheet index the reader made up is ignored', V.pickSheets('plan3d', staged, [{ type: 'floorplan', file: 9, page: 1 }]).length === 1);

console.log('\nthe image engine');
process.env.GEMINI_API_KEY = 'g';
var sent = null;
global.fetch = async function (url, o) { sent = JSON.parse(o.body); return { status: 200, json: async function () { return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }; } }; };
var handler = require('../api/render.js');
function call(body, ip) {
  return new Promise(function (resolve) {
    var res = { code: 200, setHeader: function () {}, status: function (c) { this.code = c; return this; }, json: function (x) { resolve({ code: this.code, body: x }); }, end: function () { resolve({ code: this.code }); } };
    handler({ method: 'POST', headers: { origin: 'https://orchamind.com', 'x-forwarded-for': ip || '1.1.1.1' }, body: body, socket: {} }, res);
  });
}
(async function () {
  var jpg = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  var r = await call({ prompt: ext, mode: 'drawings', references: [jpg, jpg, jpg, jpg] });
  var parts = sent.contents[0].parts;
  check('drawings mode: up to 3 sheets go to the model', parts.filter(function (p) { return p.inlineData; }).length === 3);
  check('...with the "these are THIS building\'s drawings" instruction', /own architectural drawings/.test(parts[parts.length - 1].text));
  check('...and the full prompt (not cut at the old 1,500 limit)', parts[parts.length - 1].text.indexOf(ext) > -1 && ext.length > 0);
  check('...and says so in the answer', r.body.drawings === true && /^data:image\/png/.test(r.body.url));
  r = await call({ prompt: 'x', mode: 'drawings', references: ['not-an-image'] }, '2.2.2.2');
  check('bad references: falls back to a plain render, never crashes', r.body.drawings === false && sent.contents[0].parts.length === 1);
  r = await call({ prompt: 'x', reference: jpg }, '3.3.3.3');
  check('old massing-model requests still work as before', /verified massing model/.test(sent.contents[0].parts[1].text) && r.body.anchored === true);
  var big = 'data:image/jpeg;base64,' + 'A'.repeat(2000000);
  await call({ prompt: 'x', mode: 'drawings', references: [big, big, big] }, '4.4.4.4');
  check('oversized set is trimmed to stay under the upload limit', sent.contents[0].parts.filter(function (p) { return p.inlineData; }).length === 1);
  var codes = []; for (var k = 0; k < 10; k++) codes.push((await call({ prompt: 'x' }, '5.5.5.5')).code);
  check('rate limit: 9 renders per 10 minutes per person, then a polite stop', codes.slice(0, 9).every(function (c) { return c === 200; }) && codes[9] === 429, codes.join());

  if (failures.length) { console.error('\n❌  plan visuals FAILED:\n'); failures.forEach(function (x) { console.error('   • ' + x); }); process.exit(1); }
  console.log('✅  plan visuals: facts only, right sheets, engine takes drawings.\n');
})();
