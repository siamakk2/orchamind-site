// Photoreal tab: Exterior / Inside / 3D floor plan, each drawn from the
// contractor's own sheets plus verified plan facts. Real code from demo.html
// and lib/plan-visuals.js; the image engine and sheet images are faked.

var fs = require('fs');
var path = require('path');
var { JSDOM } = require('jsdom');
var html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
var lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'plan-visuals.js'), 'utf8');
var failures = [];
function check(name, cond, d) {
  if (cond) process.stdout.write('  ✓ ' + name + '\n');
  else { failures.push(name + (d ? ' — ' + d : '')); process.stdout.write('  ✗ ' + name + '\n'); }
}
function fn(name) { var m = html.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}')); return m ? m[0] : ''; }

console.log('\nphotoreal tab');
check('the app loads the visuals helper', /<script src="\/lib\/plan-visuals\.js"><\/script>/.test(html));
check('three choices: Outside, Inside, 3D floor plan', /data-shot="exterior"/.test(html) && /data-shot="interior"/.test(html) && /data-shot="plan3d"/.test(html));
check('the plan reader now says which file and page each sheet is', /"file" = its file number/.test(html) && /"file":number,"page":number\|null/.test(html));
check('a new plan read clears the old pictures', /_epvRenders=\{\}; _epvRealRender=null; window\._autoRenderFired=false;/.test(html));
check('the automatic picture after a plan read is the exterior', /window\._autoRenderFired=true;\n    epvRenderView\('exterior'\);/.test(html));
check('there is an honest note under the pictures', /AI pictures can get details wrong/.test(html));

var start = html.indexOf('function _epvPickPhoto(){'), end = html.indexOf('function _hexA(hex,a){');
var block = html.slice(start, end);
var markup = html.slice(html.indexOf('<div class="epv-photowrap" id="epvPhotoWrap"'), html.indexOf('<div class="epv-3dhint" id="epv3dLabel"'));
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function boot(opts) {
  opts = opts || {};
  var dom = new JSDOM('<!doctype html><body><textarea id="estAiScope">dark cedar siding</textarea>' + markup + '</body>', { runScripts: 'outside-only' });
  var w = dom.window;
  w.eval(lib);
  w.eval('var _planGeom=' + JSON.stringify(opts.geom || { stories: 1, rooms: [{ name: "Kitchen" }] }) + '; window._planExtracted=' + JSON.stringify(opts.ext || null) + ';'
    + 'var DEMO_MODE=false,_demoRenderCount=0,DEMO_RENDER_LIMIT=1,_posts=[],_reply=' + JSON.stringify(opts.reply || { url: 'data:image/png;base64,QUJD', drawings: true }) + ';'
    + 'function _epvPlaceholder(){return "data:image/svg+xml,placeholder";} function _planRenderPrompt(){return "MASSING PROMPT";} function _omTrack(){}'
    + 'window.fetch=function(u,o){_posts.push(JSON.parse(o.body));return Promise.resolve({json:function(){return Promise.resolve(_reply);}});};');
  w.eval(block);
  w.eval('_planSheetImage=function(e,p){return Promise.resolve("data:image/jpeg;base64,SHEET"+(e.f.name)+(p||""));};'
    + '_pdfDoc=function(e){e.pages=' + (opts.pdfPages || 1) + ';return Promise.resolve({numPages:' + (opts.pdfPages || 1) + '});};');
  w.eval('window._planSheetFiles=' + JSON.stringify(opts.files || []) + ';');
  return w;
}
var napaExt = { totalPrintedSqft: 2616, stories: 1, overallDims: { widthFt: 96, depthFt: 27.25 }, bedrooms: ['Bedroom 2', 'Master Bedroom'],
  rooms: [{ name: 'Bedroom 2' }, { name: 'Kitchen' }, { name: 'Living' }, { name: 'Master Bedroom' }],
  sheets: [{ type: 'elevation', file: 1, page: null }, { type: 'floorplan', file: 2, page: null }] };
var napaFiles = [{ f: { name: 'elev.jpg' }, kind: 'auto', isPdf: false }, { f: { name: 'plan.png' }, kind: 'auto', isPdf: false }];

(async function () {
  var w = boot({ ext: napaExt, files: napaFiles });
  w.eval('epvPickShot("interior")');
  var doc = w.document;
  check('picking "Inside" highlights it', doc.querySelector('[data-shot="interior"]').classList.contains('active') && !doc.querySelector('[data-shot="exterior"]').classList.contains('active'));
  check('...and offers "Generate the inside"', /Generate the inside/.test(doc.getElementById('epvRenderBtn').textContent));
  check('...and says it is not drawn yet, with no save link', /not drawn yet/.test(doc.getElementById('epvPhotoLabel').textContent) && doc.getElementById('epvPhotoSave').style.display === 'none');

  w.eval('epvPickShot("plan3d"); epvRenderReal()');
  check('while drawing, the button says so and cannot be double-tapped', /Drawing the 3d floor plan/.test(doc.getElementById('epvRenderBtn').textContent) && doc.getElementById('epvRenderBtn').disabled);
  w.eval('epvRenderReal()');
  await tick(40);
  var posts = w.eval('_posts');
  check('a double tap still sends only one request', posts.length === 1, posts.length);
  var p = posts[0];
  check('3D plan is drawn from the contractor\'s FLOOR PLAN sheet only', p.mode === 'drawings' && p.references.length === 1 && /plan\.png/.test(p.references[0]));
  check('...told exactly 2 bedrooms, by name', /Exactly 2 bedrooms \(Bedroom 2; Master Bedroom\)/.test(p.prompt));
  check('...with the contractor\'s finish notes', /dark cedar siding/.test(p.prompt));
  check('...in a wide picture that fits a 96 x 27 ft house', p.aspect === '21:9');
  check('the picture appears, labelled as drawn from these plans', doc.getElementById('epvPhoto').src.indexOf('data:image/png') === 0 && /3D floor plan · drawn from these plans/.test(doc.getElementById('epvPhotoLabel').textContent));
  check('the button steps aside and a Save link appears', doc.getElementById('epvRenderBtn').style.display === 'none' && doc.getElementById('epvPhotoSave').style.display === '' && doc.getElementById('epvPhotoSave').getAttribute('download') === 'orchamind-plan3d.jpg');
  check('the 3D plan choice gets a "done" dot', !!doc.querySelector('[data-shot="plan3d"] .dot') && !doc.querySelector('[data-shot="exterior"] .dot'));

  w.eval('epvPickShot("exterior"); epvRenderReal()'); await tick(40);
  p = w.eval('_posts')[1];
  check('exterior is drawn from the elevation first, then the floor plan', p.references.length === 2 && /elev\.jpg/.test(p.references[0]) && /plan\.png/.test(p.references[1]));
  check('...as a single-story 96 x 27 ft house', /single-story/.test(p.prompt) && /96 ft long and 27 ft deep/.test(p.prompt));
  check('the exterior also feeds the older code that expects one picture', w.eval('_epvRealRender') === 'data:image/png;base64,QUJD');
  w.eval('epvPickShot("plan3d")');
  check('switching back shows the 3D plan already drawn, nothing re-sent', doc.getElementById('epvPhoto').src.indexOf('data:image/png') === 0 && w.eval('_posts').length === 2);

  console.log('\nwithout drawings');
  w = boot({ ext: null, files: [] });
  w.eval('epvRenderView("exterior")'); await tick(40);
  p = w.eval('_posts')[0];
  check('no sheets to show: exterior falls back to the 3D model prompt, as before', /^Photorealistic architectural exterior rendering of/.test(p.prompt) && !p.mode && !p.references);
  w.eval('epvRenderView("interior")'); await tick(40);
  p = w.eval('_posts')[1];
  check('no sheets: inside is drawn from the facts alone, no fake "drawings"', !p.mode && !p.references && /Photorealistic interior photograph/.test(p.prompt));

  console.log('\nfrom a PDF plan set');
  w = boot({ ext: { sheets: [{ type: 'floorplan', file: 1, page: 3 }, { type: 'elevation', file: 1, page: 5 }] }, files: [{ f: { name: 'set.pdf' }, kind: 'auto', isPdf: true }], pdfPages: 15 });
  w.eval('epvRenderView("plan3d")'); await tick(40);
  p = w.eval('_posts')[0];
  check('15-page PDF: the 3D plan uses page 3, the page the reader named', p.references.length === 1 && /set\.pdf3$/.test(p.references[0]), JSON.stringify(p.references));

  console.log('\nwhen it fails');
  w = boot({ ext: napaExt, files: napaFiles, reply: { error: 'Render limit reached — give it a few minutes.' } });
  w.eval('epvRenderView("exterior")'); await tick(40);
  var b = w.document.getElementById('epvRenderBtn');
  check('the limit message is shown plainly and the button works again', /Render limit reached/.test(b.textContent) && !b.disabled);
  w = boot({ ext: napaExt, files: napaFiles, reply: { error: 'boom' } });
  w.eval('epvRenderView("exterior")'); await tick(40);
  check('any other failure: "Could not draw it — tap to try again"', /Could not draw it/.test(w.document.getElementById('epvRenderBtn').textContent));
  w = boot({ ext: napaExt, files: napaFiles });
  w.eval('DEMO_MODE=true; _demoRenderCount=1; epvRenderView("exterior")'); await tick(20);
  check('demo visitors still get one free picture only', w.eval('_posts').length === 0 && /free demo render/.test(w.document.getElementById('epvRenderBtn').textContent));

  var test = fs.readFileSync(path.join(__dirname, '..', 'demo-test.html'), 'utf8');
  check('demo.html and demo-test.html are identical', html === test);
  if (failures.length) { console.error('\n❌  photoreal tab FAILED:\n'); failures.forEach(function (x) { console.error('   • ' + x); }); process.exit(1); }
  console.log('✅  photoreal tab: three pictures, each from the right sheet and verified facts.\n');
})();
