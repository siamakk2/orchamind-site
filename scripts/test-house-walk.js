// Tests for the walkthrough geometry. The claim this feature makes is that you
// are walking the REAL plan — so the tests are about whether the space matches
// the printed dimensions and whether the walls actually stop you.

var assert = require('assert');
var W = require('../lib/house-walk.js');

var failures = [];
function t(name, fn) {
  try { fn(); process.stdout.write('  ✓ ' + name + '\n'); }
  catch (e) { failures.push(name + ' — ' + e.message); process.stdout.write('  ✗ ' + name + '\n'); }
}
function approx(a, b, eps) { assert.ok(Math.abs(a - b) <= (eps || 1e-6), 'expected ' + b + ', got ' + a); }

console.log('\nhouse-walk');

var GEOM = {
  storyHeight: 9,
  rooms: [
    { name: 'Living', x: 0, y: 0, w: 22, h: 15 },
    { name: 'Bedroom', x: 22, y: 0, w: 13, h: 15 },
    { name: 'Covered Patio', x: 0, y: 15, w: 10, h: 8 },
    { name: 'Garage', x: 35, y: 0, w: 24, h: 28 }
  ]
};

// ---- what counts as walkable space ---------------------------------------
t('outdoor and unconditioned space is excluded', function () {
  var names = W._rectsOf(GEOM).map(function (r) { return r.name; });
  assert.deepStrictEqual(names, ['Living', 'Bedroom']);
});

t('room rectangles keep their printed dimensions exactly', function () {
  var r = W._rectsOf(GEOM)[0];
  approx(r.x1 - r.x0, 22);
  approx(r.y1 - r.y0, 15);
});

t('zero-size rooms are dropped rather than rendered as slivers', function () {
  assert.strictEqual(W._rectsOf({ rooms: [{ name: 'Ghost', x: 0, y: 0, w: 0, h: 10 }] }).length, 0);
});

// ---- doorways -------------------------------------------------------------
t('a shared wall gets exactly one doorway', function () {
  var d = W._doorsOf(W._rectsOf(GEOM));
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].axis, 'x');
  approx(d[0].at, 22);
});

t('the doorway is centred on the shared span and door-width wide', function () {
  var d = W._doorsOf(W._rectsOf(GEOM))[0];
  approx((d.lo + d.hi) / 2, 7.5);                       // shared span 0..15
  approx(d.hi - d.lo, W._constants.DOOR_W);
});

t('rooms that barely touch get no doorway', function () {
  var d = W._doorsOf(W._rectsOf({ rooms: [
    { name: 'A', x: 0, y: 0, w: 10, h: 10 },
    { name: 'B', x: 10, y: 0, w: 10, h: 2 }            // only 2 ft shared
  ] }));
  assert.strictEqual(d.length, 0);
});

t('rooms that do not touch get no doorway', function () {
  var d = W._doorsOf(W._rectsOf({ rooms: [
    { name: 'A', x: 0, y: 0, w: 10, h: 10 },
    { name: 'B', x: 30, y: 0, w: 10, h: 10 }
  ] }));
  assert.strictEqual(d.length, 0);
});

t('a horizontal shared wall also gets a doorway', function () {
  var d = W._doorsOf(W._rectsOf({ rooms: [
    { name: 'A', x: 0, y: 0, w: 14, h: 10 },
    { name: 'B', x: 0, y: 10, w: 14, h: 10 }
  ] }));
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].axis, 'y');
  approx(d[0].at, 10);
});

// ---- collision ------------------------------------------------------------
var R = W._rectsOf(GEOM), D = W._doorsOf(R);

t('you can stand in the middle of a room', function () {
  assert.ok(W._walkable(R, D, 11, 7.5));
});

t('you cannot walk outside the house', function () {
  assert.ok(!W._walkable(R, D, -3, 7.5));
  assert.ok(!W._walkable(R, D, 11, 40));
});

t('you cannot stand inside a wall', function () {
  assert.ok(!W._walkable(R, D, 0.1, 7.5), 'hard against the west wall');
});

t('you can walk through the doorway between rooms', function () {
  assert.ok(W._walkable(R, D, 22, 7.5));
});

t('you cannot walk through that same wall away from the door', function () {
  assert.ok(!W._walkable(R, D, 22, 1.5));
  assert.ok(!W._walkable(R, D, 22, 13.5));
});

t('you cannot reach the excluded garage', function () {
  assert.ok(!W._walkable(R, D, 45, 14));
});

// ---- camera math ----------------------------------------------------------
t('a point straight ahead projects to the centre of the screen', function () {
  var cam = { x: 0, y: 0, z: 5.6, yaw: 0, pitch: 0 };
  var p = W._toCam([0, 10, 5.6], cam);
  approx(p[0], 0); approx(p[2], 0);
  assert.ok(p[1] > 0, 'should be in front');
  var s = W._project(p, 600, 400, 300);
  approx(s.x, 300); approx(s.y, 200);
});

t('looking and walking agree — you move where you are facing', function () {
  // The bug worth catching is look() and move() disagreeing on a sign, which
  // makes the walkthrough feel broken in a way that is hard to name. Invariant:
  // after turning, walking forward takes you toward whatever is centred in view.
  var mk = function () {
    return W.create({ canvas: { clientWidth: 600, clientHeight: 400, getContext: function () { return null; } }, geom: GEOM });
  };
  [-0.6, -0.2, 0, 0.35, 0.9].forEach(function (yaw) {
    var inst = mk();
    inst.cam.x = 11; inst.cam.y = 7.5; inst.cam.yaw = yaw;
    var x0 = inst.cam.x, y0 = inst.cam.y;
    inst.move(1.2, 0);
    var dx = inst.cam.x - x0, dy = inst.cam.y - y0;
    if (Math.abs(dx) + Math.abs(dy) < 1e-6) return;        // blocked by a wall, skip
    // A target further along the direction we actually travelled must land in
    // the centre of the screen.
    var k = 8 / Math.sqrt(dx * dx + dy * dy);
    var target = [x0 + dx * k, y0 + dy * k, W._constants.EYE];
    var s = W._project(W._toCam(target, inst.cam), 600, 400, 300);
    approx(s.x, 300, 0.5);
    approx(s.y, 200, 0.5);
  });
});

t('turning changes where a fixed point appears', function () {
  var ahead = { x: 0, y: 0, z: 5.6, yaw: 0, pitch: 0 };
  var turned = { x: 0, y: 0, z: 5.6, yaw: 0.4, pitch: 0 };
  var a = W._toCam([0, 10, 5.6], ahead)[0];
  var b = W._toCam([0, 10, 5.6], turned)[0];
  approx(a, 0);
  assert.ok(Math.abs(b) > 3, 'a 0.4 rad turn should swing a 10 ft target well off centre');
  assert.ok(b > 0, 'yaw+ turns left, so the target swings right in view');
});

t('something behind you has negative forward depth', function () {
  var cam = { x: 0, y: 0, z: 5.6, yaw: 0, pitch: 0 };
  assert.ok(W._toCam([0, -10, 5.6], cam)[1] < 0);
});

t('a higher point projects above centre', function () {
  var cam = { x: 0, y: 0, z: 5.6, yaw: 0, pitch: 0 };
  var s = W._project(W._toCam([0, 10, 9], cam), 600, 400, 300);
  assert.ok(s.y < 200, 'ceiling should be above the horizon');
});

// ---- near-plane clipping --------------------------------------------------
t('a polygon fully behind the camera is discarded', function () {
  var poly = [[-1, -5, 0], [1, -5, 0], [1, -5, 9]];
  assert.strictEqual(W._clipNear(poly).length, 0);
});

t('a polygon fully in front is untouched', function () {
  var poly = [[-1, 5, 0], [1, 5, 0], [1, 5, 9], [-1, 5, 9]];
  assert.strictEqual(W._clipNear(poly).length, 4);
});

t('a polygon straddling the camera is clipped, not dropped', function () {
  // This is the case that produces screen-wide streaks if you skip clipping.
  var poly = [[-1, -5, 0], [1, 5, 0], [1, 5, 9], [-1, -5, 9]];
  var out = W._clipNear(poly);
  assert.ok(out.length >= 3, 'should survive as a polygon');
  out.forEach(function (p) { assert.ok(p[1] >= W._constants.NEAR - 1e-9, 'no vertex may be behind the near plane'); });
});

// ---- wall pieces ----------------------------------------------------------
t('a wall with no doorway is one piece', function () {
  assert.strictEqual(W._wallPieces(0, 0, 0, 15, 9, [], 'x', 0).length, 1);
});

t('a doorway splits a wall into both sides plus a header', function () {
  var doors = [{ axis: 'x', at: 0, lo: 6, hi: 9 }];
  var pieces = W._wallPieces(0, 0, 0, 15, 9, doors, 'x', 0);
  assert.strictEqual(pieces.length, 3, 'left, right, header');
  var header = pieces.filter(function (p) { return p[0][2] > 0; })[0];
  assert.ok(header, 'there should be a header above the opening');
  approx(header[0][2], W._constants.DOOR_H);
});

t('a doorway in a wall shorter than the door leaves no header', function () {
  var doors = [{ axis: 'x', at: 0, lo: 6, hi: 9 }];
  var pieces = W._wallPieces(0, 0, 0, 15, 6, doors, 'x', 0);   // 6 ft wall
  assert.strictEqual(pieces.filter(function (p) { return p[0][2] > 0; }).length, 0);
});

// ---- the instance ---------------------------------------------------------
t('create() starts you inside the largest room, at eye height', function () {
  var inst = W.create({ canvas: { clientWidth: 600, clientHeight: 340, getContext: function () { return null; } }, geom: GEOM });
  assert.ok(inst);
  assert.strictEqual(inst.currentRoom(), 'Living');
  approx(inst.cam.z, W._constants.EYE);
  assert.ok(W._walkable(inst.rects, inst.doors, inst.cam.x, inst.cam.y));
});

t('create() returns null when there is no interior space to walk', function () {
  assert.strictEqual(W.create({ canvas: {}, geom: { rooms: [{ name: 'Covered Patio', x: 0, y: 0, w: 10, h: 10 }] } }), null);
});

t('walking into a wall slides along it instead of sticking', function () {
  var inst = W.create({ canvas: { clientWidth: 600, clientHeight: 340, getContext: function () { return null; } }, geom: GEOM });
  inst.cam.x = 11; inst.cam.y = 13.5; inst.cam.yaw = 0;   // facing +y, near the north wall
  var before = inst.cam.x;
  inst.move(3, 1);                                        // forward into the wall, drifting east
  assert.ok(inst.cam.y <= 14.2, 'must not pass through the north wall');
  assert.ok(inst.cam.x > before, 'but should still slide east');
});

t('pitch is clamped so you cannot look past vertical', function () {
  var inst = W.create({ canvas: { clientWidth: 600, clientHeight: 340, getContext: function () { return null; } }, geom: GEOM });
  for (var i = 0; i < 50; i++) inst.look(0, 0.3);
  assert.ok(inst.cam.pitch <= 0.9 + 1e-9);
  for (var j = 0; j < 100; j++) inst.look(0, -0.3);
  assert.ok(inst.cam.pitch >= -0.9 - 1e-9);
});

t('every move leaves you somewhere walkable', function () {
  var inst = W.create({ canvas: { clientWidth: 600, clientHeight: 340, getContext: function () { return null; } }, geom: GEOM });
  for (var i = 0; i < 400; i++) {
    inst.look((i % 7) * 0.11 - 0.3, 0);
    inst.move(0.7, (i % 3) - 1);
    assert.ok(W._walkable(inst.rects, inst.doors, inst.cam.x, inst.cam.y),
      'escaped the house at step ' + i + ' (' + inst.cam.x.toFixed(2) + ',' + inst.cam.y.toFixed(2) + ')');
  }
});

if (failures.length) {
  console.error('\n❌  house-walk FAILED:\n');
  failures.forEach(function (f) { console.error('   • ' + f); });
  console.error('');
  process.exit(1);
}
console.log('✅  house-walk: the space matches the plan and the walls hold.\n');
