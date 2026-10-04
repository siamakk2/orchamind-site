// First-person walkthrough of the deterministic massing.
//
// This is NOT a generated image of a house. It is the same room rectangles the
// takeoff computed from the printed dimensions, viewed from eye height. If the
// plan says the living room is 14'-6" x 19'-4", that is exactly how far you walk
// across it. Nothing here invents geometry, which is the whole point: a render
// that flatters the plan is worse than no render, because the homeowner makes
// decisions in front of it.
//
// Canvas 2D on purpose. The rooms are axis-aligned boxes, so a perspective
// camera plus near-plane clipping and painter's-algorithm sorting is enough,
// and it keeps the app a single self-contained file with no WebGL dependency
// and no device-capability cliff on an older phone in a truck.

(function (root) {
  'use strict';

  var NEAR = 0.25;          // ft — near clip plane
  var EYE = 5.6;            // ft — eye height, a person rather than a drone
  var BODY = 0.9;           // ft — how close you can get to a wall
  var DOOR_W = 3.0;         // ft
  var DOOR_H = 6.8;         // ft
  var MIN_SHARED = 3.6;     // ft of shared wall needed before a door fits

  // ---- geometry helpers ---------------------------------------------------

  function rectsOf(geom) {
    var out = /\b(patio|deck|porch|balcony|terrace|carport|breezeway|garage)\b/i;
    return (geom && geom.rooms || [])
      .filter(function (r) { return r && r.w > 0 && r.h > 0 && !out.test(r.name || ''); })
      .map(function (r) {
        return { name: r.name || 'Room', x0: +r.x, y0: +r.y, x1: +r.x + +r.w, y1: +r.y + +r.h };
      });
  }

  // Where two rooms share a wall, cut a doorway. Without this you are sealed
  // into whichever room you spawn in, which reads as a bug rather than a house.
  function doorsOf(rects) {
    var doors = [];
    for (var i = 0; i < rects.length; i++) {
      for (var j = i + 1; j < rects.length; j++) {
        var a = rects[i], b = rects[j];
        // vertical shared edge
        var vx = null;
        if (Math.abs(a.x1 - b.x0) < 0.1) vx = a.x1;
        else if (Math.abs(b.x1 - a.x0) < 0.1) vx = a.x0;
        if (vx != null) {
          var y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
          if (y1 - y0 >= MIN_SHARED) {
            var cy = (y0 + y1) / 2;
            doors.push({ axis: 'x', at: vx, lo: cy - DOOR_W / 2, hi: cy + DOOR_W / 2 });
          }
          continue;
        }
        // horizontal shared edge
        var hy = null;
        if (Math.abs(a.y1 - b.y0) < 0.1) hy = a.y1;
        else if (Math.abs(b.y1 - a.y0) < 0.1) hy = a.y0;
        if (hy != null) {
          var x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
          if (x1 - x0 >= MIN_SHARED) {
            var cx = (x0 + x1) / 2;
            doors.push({ axis: 'y', at: hy, lo: cx - DOOR_W / 2, hi: cx + DOOR_W / 2 });
          }
        }
      }
    }
    return doors;
  }

  function roomAt(rects, x, y, inset) {
    inset = inset || 0;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.x0 + inset && x <= r.x1 - inset && y >= r.y0 + inset && y <= r.y1 - inset) return r;
    }
    return null;
  }

  // A doorway is a hole in a wall, so it has to be walkable even though it sits
  // exactly on the boundary where both rooms' insets fail.
  function inDoorway(doors, x, y) {
    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      if (d.axis === 'x') {
        if (Math.abs(x - d.at) <= BODY + 0.4 && y >= d.lo && y <= d.hi) return true;
      } else {
        if (Math.abs(y - d.at) <= BODY + 0.4 && x >= d.lo && x <= d.hi) return true;
      }
    }
    return false;
  }

  function walkable(rects, doors, x, y) {
    return !!roomAt(rects, x, y, BODY) || inDoorway(doors, x, y);
  }

  // ---- camera -------------------------------------------------------------

  // World (x east, y north, z up) -> camera space (x right, y forward, z up).
  function toCam(p, cam) {
    var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var rx = dx * cy + dy * sy;
    var fy = -dx * sy + dy * cy;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [rx, fy * cp + dz * sp, -fy * sp + dz * cp];
  }

  // Sutherland-Hodgman against the single near plane. Skipping this is what
  // makes naive 3D explode into streaks when a wall passes behind your head.
  function clipNear(poly) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var ain = a[1] >= NEAR, bin = b[1] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (NEAR - a[1]) / (b[1] - a[1]);
        out.push([a[0] + (b[0] - a[0]) * t, NEAR, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }

  function project(p, W, H, f) {
    return { x: W / 2 + f * p[0] / p[1], y: H / 2 - f * p[2] / p[1] };
  }

  // ---- surfaces -----------------------------------------------------------

  // A wall with a doorway is drawn as the pieces around the hole.
  function wallPieces(x0, y0, x1, y1, h, doors, axis, at) {
    var holes = doors.filter(function (d) {
      return d.axis === axis && Math.abs(d.at - at) < 0.1;
    });
    var along = axis === 'x'
      ? [Math.min(y0, y1), Math.max(y0, y1)]
      : [Math.min(x0, x1), Math.max(x0, x1)];
    var segs = [{ lo: along[0], hi: along[1], zlo: 0, zhi: h }];
    holes.forEach(function (d) {
      var next = [];
      segs.forEach(function (s) {
        if (s.zlo > 0 || d.hi <= s.lo || d.lo >= s.hi) { next.push(s); return; }
        if (d.lo > s.lo) next.push({ lo: s.lo, hi: Math.min(d.lo, s.hi), zlo: 0, zhi: h });
        if (d.hi < s.hi) next.push({ lo: Math.max(d.hi, s.lo), hi: s.hi, zlo: 0, zhi: h });
        // header above the opening
        var ol = Math.max(s.lo, d.lo), oh = Math.min(s.hi, d.hi);
        if (oh > ol && h > DOOR_H) next.push({ lo: ol, hi: oh, zlo: DOOR_H, zhi: h });
      });
      segs = next;
    });
    return segs.map(function (s) {
      return axis === 'x'
        ? [[at, s.lo, s.zlo], [at, s.hi, s.zlo], [at, s.hi, s.zhi], [at, s.lo, s.zhi]]
        : [[s.lo, at, s.zlo], [s.hi, at, s.zlo], [s.hi, at, s.zhi], [s.lo, at, s.zhi]];
    });
  }

  function buildSurfaces(rects, doors, h, mat) {
    var S = [];
    rects.forEach(function (r) {
      var m = (mat.rooms && mat.rooms[r.name]) || {};
      var floor = m.floor || mat.floor;
      var wall = m.wall || mat.wall;
      var ceil = mat.ceiling;
      S.push({ poly: [[r.x0, r.y0, 0], [r.x1, r.y0, 0], [r.x1, r.y1, 0], [r.x0, r.y1, 0]],
               color: floor.color, kind: 'floor', room: r.name, shade: 1.0 });
      S.push({ poly: [[r.x0, r.y0, h], [r.x1, r.y0, h], [r.x1, r.y1, h], [r.x0, r.y1, h]],
               color: ceil.color, kind: 'ceiling', room: r.name, shade: 0.93 });
      // Each wall gets a slightly different shade so corners read as corners.
      [['x', r.x0, 0.80], ['x', r.x1, 0.88], ['y', r.y0, 0.96], ['y', r.y1, 0.84]]
        .forEach(function (w) {
          var pieces = w[0] === 'x'
            ? wallPieces(w[1], r.y0, w[1], r.y1, h, doors, 'x', w[1])
            : wallPieces(r.x0, w[1], r.x1, w[1], h, doors, 'y', w[1]);
          pieces.forEach(function (p) {
            S.push({ poly: p, color: wall.color, kind: 'wall', room: r.name, shade: w[2] });
          });
        });
    });
    return S;
  }

  function shadeHex(hex, k) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * k));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * k));
    var b = Math.min(255, Math.round((n & 255) * k));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---- render -------------------------------------------------------------

  function renderFrame(ctx, W, H, surfaces, cam, fov) {
    var f = (H / 2) / Math.tan((fov || 1.12) / 2);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#10151d';
    ctx.fillRect(0, 0, W, H);

    var drawn = [];
    for (var i = 0; i < surfaces.length; i++) {
      var s = surfaces[i];
      var camPoly = [];
      for (var k = 0; k < s.poly.length; k++) camPoly.push(toCam(s.poly[k], cam));
      var clipped = clipNear(camPoly);
      if (clipped.length < 3) continue;
      var depth = 0;
      for (var d = 0; d < clipped.length; d++) depth += clipped[d][1];
      depth /= clipped.length;
      drawn.push({ s: s, pts: clipped, depth: depth });
    }
    drawn.sort(function (a, b) { return b.depth - a.depth; });   // painter: far first

    for (var n = 0; n < drawn.length; n++) {
      var it = drawn[n], pts = it.pts, sf = it.s;
      ctx.beginPath();
      var p0 = project(pts[0], W, H, f);
      ctx.moveTo(p0.x, p0.y);
      for (var q = 1; q < pts.length; q++) {
        var p = project(pts[q], W, H, f);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      // Distance fog: without it every room reads as the same depth and the
      // space feels like a diagram rather than somewhere you are standing.
      var fogT = Math.min(1, Math.max(0, (it.depth - 6) / 46));
      ctx.fillStyle = shadeHex(sf.color, sf.shade * (1 - 0.42 * fogT));
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return drawn.length;
  }

  // ---- public surface -----------------------------------------------------

  var DEFAULT_MAT = {
    floor:   { name: 'Oak laminate', color: '#9B7B55' },
    wall:    { name: 'Painted drywall', color: '#E8E4DC' },
    ceiling: { name: 'Flat white', color: '#F2F0EC' }
  };

  function create(opts) {
    var cv = opts.canvas;
    var geom = opts.geom || {};
    var rects = rectsOf(geom);
    if (!rects.length) return null;
    var h = +geom.storyHeight || 9;
    var doors = doorsOf(rects);
    var mat = Object.assign({}, DEFAULT_MAT, opts.materials || {});
    var surfaces = buildSurfaces(rects, doors, h, mat);

    // Start in the largest room, which is the one worth showing first.
    var biggest = rects.slice().sort(function (a, b) {
      return (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0);
    })[0];
    var cam = {
      x: (biggest.x0 + biggest.x1) / 2,
      y: (biggest.y0 + biggest.y1) / 2,
      z: EYE, yaw: 0, pitch: 0
    };

    var api = {
      cam: cam, rects: rects, doors: doors, rooms: rects.length,
      currentRoom: function () { var r = roomAt(rects, cam.x, cam.y, 0); return r ? r.name : null; },
      setMaterials: function (m) {
        mat = Object.assign({}, mat, m || {});
        surfaces = buildSurfaces(rects, doors, h, mat);
      },
      move: function (fwd, strafe) {
        var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        // forward is +y in world when yaw = 0
        var nx = cam.x + (-sy * fwd + cy * strafe);
        var ny = cam.y + (cy * fwd + sy * strafe);
        if (walkable(rects, doors, nx, ny)) { cam.x = nx; cam.y = ny; return true; }
        // Slide along whichever axis is still free rather than sticking.
        if (walkable(rects, doors, nx, cam.y)) { cam.x = nx; return true; }
        if (walkable(rects, doors, cam.x, ny)) { cam.y = ny; return true; }
        return false;
      },
      look: function (dyaw, dpitch) {
        cam.yaw += dyaw;
        cam.pitch = Math.max(-0.9, Math.min(0.9, cam.pitch + dpitch));
      },
      render: function () {
        var dpr = Math.min(2, (root.devicePixelRatio || 1));
        var W = cv.clientWidth || 600, H = cv.clientHeight || 340;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
          cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        }
        var ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return renderFrame(ctx, W, H, surfaces, cam, opts.fov);
      }
    };
    return api;
  }

  var _api = {
    create: create,
    // exported for tests — the math is the part that can be wrong silently
    _rectsOf: rectsOf, _doorsOf: doorsOf, _roomAt: roomAt, _walkable: walkable,
    _toCam: toCam, _clipNear: clipNear, _project: project, _wallPieces: wallPieces,
    _constants: { NEAR: NEAR, EYE: EYE, BODY: BODY, DOOR_W: DOOR_W, DOOR_H: DOOR_H }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = _api;
  if (typeof window !== 'undefined') window.OrchaWalk = _api;
})(typeof window !== 'undefined' ? window : globalThis);
