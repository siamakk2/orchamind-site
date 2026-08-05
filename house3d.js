/* Orchamind house3d — zero-dependency canvas renderer.
   Floor-plan takeoff -> realistic massing model: gradient-shaded stucco walls,
   gable roof + chimney, framed windows with mullions, front door, story/floor
   bands, grass ground, sky, contact shadow. Build-up "generate" animation via
   grow; full orbit via theta+pitch. Shared by demo.html and /ai-estimating. */
(function (root) {
  function lerp(a, b, t) { return a + (b - a) * t; }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    f = Math.max(0.28, Math.min(1.32, f));
    return 'rgb(' + Math.min(255, r * f | 0) + ',' + Math.min(255, g * f | 0) + ',' + Math.min(255, b * f | 0) + ')';
  }
  function roofN(s) {
    s = String(s || '').toLowerCase();
    if (s.indexOf('flat') >= 0) return 'flat';
    if (s.indexOf('shed') >= 0 || s.indexOf('slope') >= 0 || s.indexOf('mono') >= 0 || s.indexOf('step') >= 0) return 'low-slope';
    if (s.indexOf('hip') >= 0) return 'hip';
    if (s.indexOf('gab') >= 0) return 'gable';
    return s ? 'flat' : 'gable';
  }
  var WALL = '#F6F3ED', ROOF = '#ABA396', GABLE = '#EFEBE2',
      GLASS = '#7E93A8', REVEAL = 'rgba(52,60,72,0.55)',
      DOOR = '#736A5F', GROUND = '#E7E9E1';

  function render(o) {
    var cv = o.canvas, g = o.geom; if (!cv || !g || !g.rooms || !g.rooms.length) return;
    var theta = o.theta || 0, zoom = o.zoom || 1, grow = o.grow == null ? 1 : Math.max(0, Math.min(1, o.grow));
    var pitch = o.pitch == null ? 0.5 : o.pitch; pitch = Math.max(0.14, Math.min(0.9, pitch));
    var flat = pitch, zscale = 0.62 + (1 - pitch) * 0.5;
    var dpr = root.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight || 300;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#F4F5F2'); sky.addColorStop(1, '#E8E9E3');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    var rooms = g.rooms, storyH = g.storyHeight || 9;
    var stories = g.stories || Math.max(1, Math.round((g.wallHeightFt || storyH) / storyH));
    var wallTop = storyH * stories;
    // --- Volume composition: real buildings are multiple prisms, not one box ---
    // Plausibility envelope from the room layout: AI-described volumes/porches
    // that land far outside it are coordinate errors - drop them rather than
    // letting one bad rectangle explode the scene bounds.
    var rbx0 = 1e9, rby0 = 1e9, rbx1 = -1e9, rby1 = -1e9;
    rooms.forEach(function (r) { rbx0 = Math.min(rbx0, r.x); rby0 = Math.min(rby0, r.y); rbx1 = Math.max(rbx1, r.x + r.w); rby1 = Math.max(rby1, r.y + r.h); });
    var spanR = Math.max(rbx1 - rbx0, rby1 - rby0) || 1;
    function plausible(x0, y0, x1, y1) {
      var pad = spanR * 0.8;
      return x1 > rbx0 - pad && x0 < rbx1 + pad && y1 > rby0 - pad && y0 < rby1 + pad
        && (x1 - x0) <= spanR * 2.2 && (y1 - y0) <= spanR * 2.2;
    }
    var solids = [];
    if (g.volumes && g.volumes.length) {
      g.volumes.slice(0, 4).forEach(function (v) {
        if (!(v && isFinite(v.x) && isFinite(v.y) && v.w > 0 && v.h > 0)) return;
        if (!plausible(v.x, v.y, v.x + v.w, v.y + v.h)) return;
        solids.push({ x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h,
          top: Math.max(6, Math.min(40, v.heightFt || wallTop)),
          roof: roofN(v.roof || g.roof || 'flat'), glazing: v.glazing || null, name: v.name || '' });
      });
    }
    var porches = [];
    (g.porches || []).slice(0, 3).forEach(function (p) {
      if (!(p && isFinite(p.x) && isFinite(p.y) && p.w > 0 && p.h > 0)) return;
      if (!plausible(p.x, p.y, p.x + p.w, p.y + p.h)) return;
      porches.push({ x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h, top: Math.max(7, Math.min(16, p.heightFt || 9)) });
    });

    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    rooms.forEach(function (r) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    solids.concat(porches).forEach(function (s2) { minX = Math.min(minX, s2.x0); minY = Math.min(minY, s2.y0); maxX = Math.max(maxX, s2.x1); maxY = Math.max(maxY, s2.y1); });
    var Wd = maxX - minX, Dp = maxY - minY, cvirt = Math.max(Wd, Dp) || 1;
    var span = cvirt * 1.9;
    var s = (Math.min(W, H) * 0.92 / span) * zoom;
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    function P(x, y, z) {
      var rx = (x - cx) * cosT - (y - cy) * sinT, ry = (x - cx) * sinT + (y - cy) * cosT;
      return { x: W / 2 + rx * s, y: H * 0.70 + ry * s * flat - z * s * zscale, d: ry };
    }
    function fillP(pts, color) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }
    function strokeP(pts, color, lw) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y); ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = lw || 1; ctx.lineJoin = 'round'; ctx.stroke();
    }
    function grad(pts, baseHex, litBottom, litTop, edge) {
      var yb = (pts[0].y + pts[1].y) / 2, yt = (pts[2].y + pts[3].y) / 2;
      var gg = ctx.createLinearGradient(0, yb, 0, yt);
      gg.addColorStop(0, shade(baseHex, litBottom)); gg.addColorStop(1, shade(baseHex, litTop));
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y); ctx.closePath();
      ctx.fillStyle = gg; ctx.fill();
      if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1.1; ctx.lineJoin = 'round'; ctx.stroke(); }
    }

    var o1 = Math.max(0.8, cvirt * 0.04);
    var wt = wallTop * grow;

    ctx.save(); ctx.globalAlpha = 0.20 * grow + 0.05;
    var sh = [P(minX - o1, minY - o1, 0), P(maxX + o1, minY - o1, 0), P(maxX + o1, maxY + o1, 0), P(minX - o1, maxY + o1, 0)];
    sh.forEach(function (p) { p.x += 8; p.y += 10; }); fillP(sh, '#3A4038'); ctx.restore();

    var gm = Math.max(3, cvirt * 0.55);
    var gpts = [P(minX - gm, minY - gm, 0), P(maxX + gm, minY - gm, 0), P(maxX + gm, maxY + gm, 0), P(minX - gm, maxY + gm, 0)];
    fillP(gpts, GROUND); strokeP(gpts, 'rgba(150,160,140,0.35)', 1);
    ctx.strokeStyle = 'rgba(120,140,120,0.14)'; ctx.lineWidth = 0.5;
    var gx0 = Math.floor((minX - gm) / 5) * 5, gx1 = Math.ceil((maxX + gm) / 5) * 5;
    var gy0 = Math.floor((minY - gm) / 5) * 5, gy1 = Math.ceil((maxY + gm) / 5) * 5;
    for (var gx = gx0; gx <= gx1; gx += 5) { var a = P(gx, gy0, 0), b = P(gx, gy1, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (var gy = gy0; gy <= gy1; gy += 5) { var a2 = P(gx0, gy, 0), b2 = P(gx1, gy, 0); ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }

    var fpts = [P(minX - 0.4, minY - 0.4, 0), P(maxX + 0.4, minY - 0.4, 0), P(maxX + 0.4, maxY + 0.4, 0), P(minX - 0.4, maxY + 0.4, 0)];
    fillP(fpts, '#C9CBC4');

    var lightAng = theta + 0.7, lx = Math.cos(lightAng), ly = Math.sin(lightAng);

    // Back-compat: no volumes described -> one solid from the rooms bounding box
    if (!solids.length) {
      var rb = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      rooms.forEach(function (r) { rb.x0 = Math.min(rb.x0, r.x); rb.y0 = Math.min(rb.y0, r.y); rb.x1 = Math.max(rb.x1, r.x + r.w); rb.y1 = Math.max(rb.y1, r.y + r.h); });
      solids.push({ x0: rb.x0, y0: rb.y0, x1: rb.x1, y1: rb.y1, top: wallTop, roof: roofN(g.roof || 'gable'), glazing: null, name: 'main' });
    }
    var mainIdx = 0, mainArea = -1;
    solids.forEach(function (s2, i2) { var a2 = (s2.x1 - s2.x0) * (s2.y1 - s2.y0); if (a2 > mainArea) { mainArea = a2; mainIdx = i2; } });
    // Height-semantics safety net: a clerestory/raised volume reported SHORTER than
    // the main volume is a delta, not an absolute height - reinterpret it as such.
    solids.forEach(function (s2, i2) {
      if (i2 === mainIdx) return;
      if (s2.glazing === 'clerestory' && s2.top <= solids[mainIdx].top) {
        s2.top = Math.min(40, solids[mainIdx].top + Math.max(1.5, s2.top - 0));
      }
    });

    function drawGlassStrip(x0, y0, x1, y1, sillZ, headZ, lit, panels) {
      var dxx = x1 - x0, dyy = y1 - y0, Ls = Math.hypot(dxx, dyy), uxs = dxx / Ls, uys = dyy / Ls;
      fillP([P(x0, y0, sillZ - .15), P(x1, y1, sillZ - .15), P(x1, y1, headZ + .15), P(x0, y0, headZ + .15)], REVEAL);
      fillP([P(x0 + uxs * .12, y0 + uys * .12, sillZ), P(x1 - uxs * .12, y1 - uys * .12, sillZ), P(x1 - uxs * .12, y1 - uys * .12, headZ), P(x0 + uxs * .12, y0 + uys * .12, headZ)], shade(GLASS, lit * 1.03));
      if (panels > 1) {
        ctx.strokeStyle = 'rgba(60,68,78,0.5)'; ctx.lineWidth = 1;
        for (var pi = 1; pi < panels; pi++) {
          var tt = pi / panels;
          var m1 = P(x0 + dxx * tt, y0 + dyy * tt, sillZ), m2 = P(x0 + dxx * tt, y0 + dyy * tt, headZ);
          ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
        }
      }
    }

    function drawSolid(s2, isMain) {
      var sx0 = s2.x0, sy0 = s2.y0, sx1 = s2.x1, sy1 = s2.y1;
      var topS = s2.top, wtS = topS * grow;
      var storiesS = Math.max(1, Math.min(3, Math.round(topS / storyH)));
      var ex2 = [
        [sx0, sy0, sx1, sy0, 0, -1, 1],
        [sx1, sy0, sx1, sy1, 1, 0, 0],
        [sx1, sy1, sx0, sy1, 0, 1, 0],
        [sx0, sy1, sx0, sy0, -1, 0, 0]
      ];
      var wallFaces = ex2.map(function (w) {
        var a = P(w[0], w[1], 0), b = P(w[2], w[3], 0);
        return { w: w, lit: 0.86 + 0.38 * Math.max(0, w[4] * lx + w[5] * ly), d: (a.d + b.d) / 2, quad: [a, b, P(w[2], w[3], wtS), P(w[0], w[1], wtS)] };
      }).sort(function (p, q) { return p.d - q.d; });

      wallFaces.forEach(function (wf) {
        var w = wf.w, lit = wf.lit, isFront = w[6];
        grad(wf.quad, WALL, lit * 0.9, lit * 1.06, 'rgba(90,92,88,0.45)');
        if (grow < 0.55) return;
        var wa = Math.min(1, (grow - 0.55) / 0.35); ctx.save(); ctx.globalAlpha = wa;
        var dxx = w[2] - w[0], dyy = w[3] - w[1], L = Math.hypot(dxx, dyy), ux = dxx / L, uy = dyy / L;
        var elev = isFront ? 'front' : (w[5] === 1 ? 'back' : (w[4] === -1 ? 'left' : 'right'));

        var mode = null, count = 0, cler = false;
        if (s2.glazing === 'band') { mode = 'band'; count = Math.max(2, Math.round(L / 8)); }
        else if (s2.glazing === 'clerestory') { mode = 'clerestory'; }
        else if (s2.glazing === 'punched') { mode = 'punched'; count = Math.max(1, Math.round(L / 14)); }
        else if (s2.glazing === 'none') { mode = null; }
        else if (isMain && g.windows && typeof g.windows === 'object') {
          var raw = g.windows[elev];
          if (typeof raw === 'number' && isFinite(raw)) { mode = 'punched'; count = Math.max(0, Math.min(24, Math.round(raw))); }
          else if (raw && typeof raw === 'object' && typeof raw.count === 'number') {
            count = Math.max(0, Math.min(24, Math.round(raw.count)));
            mode = (raw.style === 'window-wall' || raw.style === 'mixed') && count > 0 ? 'band' : (count > 0 ? 'punched' : null);
            cler = !!raw.clerestory;
          }
        }

        for (var st = 0; st < storiesS; st++) {
          var z0 = st * storyH;
          if (st > 0) { fillP([P(w[0], w[1], z0 - 0.25), P(w[2], w[3], z0 - 0.25), P(w[2], w[3], z0 + 0.25), P(w[0], w[1], z0 + 0.25)], shade('#E4DFD4', lit)); }
          if (mode === 'band') {
            drawGlassStrip(w[0] + ux * L * 0.06, w[1] + uy * L * 0.06, w[0] + ux * L * 0.94, w[1] + uy * L * 0.94,
              z0 + 1.2, Math.min(z0 + storyH - 1.4, wtS - 0.6), lit, Math.max(2, Math.min(12, count)));
            if (st === 0 && isFront && isMain) {
              var dpx = w[0] + ux * L * 0.5, dpy = w[1] + uy * L * 0.5, ddh = 0.85;
              fillP([P(dpx - ux * ddh, dpy - uy * ddh, z0), P(dpx + ux * ddh, dpy + uy * ddh, z0), P(dpx + ux * ddh, dpy + uy * ddh, z0 + 7.0), P(dpx - ux * ddh, dpy - uy * ddh, z0 + 7.0)], shade(DOOR, lit));
            }
            continue;
          }
          if (mode === 'clerestory') continue;
          if (mode === 'punched' && count > 0) {
            var base = Math.floor(count / storiesS), rem = count % storiesS;
            var perStory = base + (st < rem ? 1 : 0);
            var slots = perStory, doorSlot = -1;
            if (st === 0 && isFront && isMain) { slots = perStory + 1; doorSlot = Math.ceil(slots / 2); }
            for (var k = 1; k <= slots; k++) {
              var px = w[0] + ux * (L * k / (slots + 1)), py = w[1] + uy * (L * k / (slots + 1));
              if (k === doorSlot) {
                var dh = 0.85;
                fillP([P(px - ux * dh, py - uy * dh, z0), P(px + ux * dh, py + uy * dh, z0), P(px + ux * dh, py + uy * dh, z0 + 7.0), P(px - ux * dh, py - uy * dh, z0 + 7.0)], REVEAL);
                fillP([P(px - ux * (dh - .12), py - uy * (dh - .12), z0), P(px + ux * (dh - .12), py + uy * (dh - .12), z0), P(px + ux * (dh - .12), py + uy * (dh - .12), z0 + 6.85), P(px - ux * (dh - .12), py - uy * (dh - .12), z0 + 6.85)], shade(DOOR, lit));
                continue;
              }
              var hw = Math.min(1.5, L / (slots + 1) * 0.34), sill = z0 + 3, head = Math.min(z0 + 6.6, wtS - 0.8);
              fillP([P(px - ux * hw, py - uy * hw, sill - .15), P(px + ux * hw, py + uy * hw, sill - .15), P(px + ux * hw, py + uy * hw, head + .15), P(px - ux * hw, py - uy * hw, head + .15)], REVEAL);
              fillP([P(px - ux * (hw - .12), py - uy * (hw - .12), sill), P(px + ux * (hw - .12), py + uy * (hw - .12), sill), P(px + ux * (hw - .12), py + uy * (hw - .12), head), P(px - ux * (hw - .12), py - uy * (hw - .12), head)], shade(GLASS, lit * 1.02));
            }
          } else if (st === 0 && isFront && isMain && mode === null) {
            var dpx2 = w[0] + ux * L * 0.5, dpy2 = w[1] + uy * L * 0.5, ddh2 = 0.85;
            fillP([P(dpx2 - ux * ddh2, dpy2 - uy * ddh2, z0), P(dpx2 + ux * ddh2, dpy2 + uy * ddh2, z0), P(dpx2 + ux * ddh2, dpy2 + uy * ddh2, z0 + 7.0), P(dpx2 - ux * ddh2, dpy2 - uy * ddh2, z0 + 7.0)], shade(DOOR, lit));
          }
        }
        if (mode === 'clerestory' || cler) {
          drawGlassStrip(w[0] + ux * L * 0.1, w[1] + uy * L * 0.1, w[0] + ux * L * 0.9, w[1] + uy * L * 0.9,
            wtS - 1.7, wtS - 0.35, lit, Math.max(4, Math.round(L / 6)));
        }
        ctx.restore();
      });

      if (grow > 0.5) {
        var ra = Math.min(1, (grow - 0.5) / 0.4);
        var roofType = (s2.roof || 'flat').toLowerCase();
        var Wd2 = sx1 - sx0, Dp2 = sy1 - sy0;
        var o2 = Math.max(0.7, Math.min(Wd2, Dp2) * 0.05);
        var pitchMul = roofType === 'flat' ? 0.06 : (roofType === 'low-slope' || roofType === 'shed' || roofType === 'lowslope') ? 0.16 : 0.5;
        var rise = Math.max(roofType === 'flat' ? 0.5 : 1.2, Math.min(Wd2, Dp2) * pitchMul) * ra, zr = topS + rise;
        var lx0 = sx0 - o2, lx1 = sx1 + o2, ly0 = sy0 - o2, ly1 = sy1 + o2, faces = [];
        var flatCol = '#9C958A';
        if (roofType === 'flat') {
          faces.push({ pts: [P(lx0, ly0, topS), P(lx1, ly0, topS), P(lx1, ly1, topS), P(lx0, ly1, topS)], nx: 0, ny: 0, base: flatCol, flat: 1 });
        } else if (roofType === 'shed' || roofType === 'low-slope' || roofType === 'lowslope') {
          faces.push({ pts: [P(lx0, ly0, zr), P(lx1, ly0, zr), P(lx1, ly1, topS), P(lx0, ly1, topS)], nx: 0, ny: -0.3, base: flatCol, flat: 1 });
          faces.push({ tri: 1, pts: [P(sx0, ly0, topS), P(sx0, ly0, zr), P(sx0, ly1, topS)], nx: -1, ny: 0, base: GABLE });
          faces.push({ tri: 1, pts: [P(sx1, ly0, topS), P(sx1, ly0, zr), P(sx1, ly1, topS)], nx: 1, ny: 0, base: GABLE });
        } else if (roofType === 'hip') {
          var ins = Math.min(Wd2, Dp2) / 2;
          if (Wd2 >= Dp2) {
            var my = (sy0 + sy1) / 2, r1 = [lx0 + ins, my], r2 = [lx1 - ins, my];
            faces.push({ pts: [P(lx0, ly0, topS), P(lx1, ly0, topS), P(r2[0], r2[1], zr), P(r1[0], r1[1], zr)], nx: 0, ny: -1, base: ROOF });
            faces.push({ pts: [P(lx0, ly1, topS), P(lx1, ly1, topS), P(r2[0], r2[1], zr), P(r1[0], r1[1], zr)], nx: 0, ny: 1, base: ROOF });
            faces.push({ tri: 1, pts: [P(lx0, ly0, topS), P(lx0, ly1, topS), P(r1[0], r1[1], zr)], nx: -1, ny: 0, base: ROOF });
            faces.push({ tri: 1, pts: [P(lx1, ly0, topS), P(lx1, ly1, topS), P(r2[0], r2[1], zr)], nx: 1, ny: 0, base: ROOF });
          } else {
            var mx = (sx0 + sx1) / 2, ra1 = [mx, ly0 + ins], ra2 = [mx, ly1 - ins];
            faces.push({ pts: [P(lx0, ly0, topS), P(lx0, ly1, topS), P(ra2[0], ra2[1], zr), P(ra1[0], ra1[1], zr)], nx: -1, ny: 0, base: ROOF });
            faces.push({ pts: [P(lx1, ly0, topS), P(lx1, ly1, topS), P(ra2[0], ra2[1], zr), P(ra1[0], ra1[1], zr)], nx: 1, ny: 0, base: ROOF });
            faces.push({ tri: 1, pts: [P(lx0, ly0, topS), P(lx1, ly0, topS), P(ra1[0], ra1[1], zr)], nx: 0, ny: -1, base: ROOF });
            faces.push({ tri: 1, pts: [P(lx0, ly1, topS), P(lx1, ly1, topS), P(ra2[0], ra2[1], zr)], nx: 0, ny: 1, base: ROOF });
          }
        } else if (Wd2 >= Dp2) {
          var midY = (sy0 + sy1) / 2;
          faces.push({ tri: 1, pts: [P(sx0, sy0, topS), P(sx0, sy1, topS), P(sx0, midY, zr)], nx: -1, ny: 0, base: GABLE });
          faces.push({ tri: 1, pts: [P(sx1, sy0, topS), P(sx1, sy1, topS), P(sx1, midY, zr)], nx: 1, ny: 0, base: GABLE });
          faces.push({ pts: [P(lx0, ly0, topS), P(lx1, ly0, topS), P(lx1, midY, zr), P(lx0, midY, zr)], nx: 0, ny: -1, base: ROOF });
          faces.push({ pts: [P(lx0, ly1, topS), P(lx1, ly1, topS), P(lx1, midY, zr), P(lx0, midY, zr)], nx: 0, ny: 1, base: ROOF });
        } else {
          var midX = (sx0 + sx1) / 2;
          faces.push({ tri: 1, pts: [P(sx0, sy0, topS), P(sx1, sy0, topS), P(midX, sy0, zr)], nx: 0, ny: -1, base: GABLE });
          faces.push({ tri: 1, pts: [P(sx0, sy1, topS), P(sx1, sy1, topS), P(midX, sy1, zr)], nx: 0, ny: 1, base: GABLE });
          faces.push({ pts: [P(lx0, ly0, topS), P(lx0, ly1, topS), P(midX, ly1, zr), P(midX, ly0, zr)], nx: -1, ny: 0, base: ROOF });
          faces.push({ pts: [P(lx1, ly0, topS), P(lx1, ly1, topS), P(midX, ly1, zr), P(midX, ly0, zr)], nx: 1, ny: 0, base: ROOF });
        }
        faces.forEach(function (f) { f.d = f.pts.reduce(function (s3, p) { return s3 + p.d; }, 0) / f.pts.length; });
        faces.sort(function (a, b) { return a.d - b.d; });
        faces.forEach(function (f) {
          var lit = f.flat ? 1.0 : (0.72 + 0.5 * Math.max(0, f.nx * lx + f.ny * ly));
          if (f.tri) { fillP(f.pts, shade(f.base, lit)); strokeP(f.pts, 'rgba(90,92,88,0.45)', 1); }
          else { grad(f.pts, f.base, lit * 0.92, lit * 1.08, 'rgba(96,98,94,0.55)'); }
        });
      }
    }

    function drawPorch(p2) {
      if (grow < 0.6) return;
      var pa = Math.min(1, (grow - 0.6) / 0.35);
      var topP = p2.top * pa;
      var spanX = p2.x1 - p2.x0, spanY = p2.y1 - p2.y0;
      var nx2 = Math.max(2, Math.round(spanX / 10) + 1), ny2 = Math.max(2, Math.round(spanY / 12) + 1);
      var posts = [];
      for (var ix = 0; ix < nx2; ix++) for (var iy = 0; iy < ny2; iy++) {
        if (ix > 0 && ix < nx2 - 1 && iy > 0 && iy < ny2 - 1) continue;
        posts.push([p2.x0 + spanX * ix / (nx2 - 1), p2.y0 + spanY * iy / (ny2 - 1)]);
      }
      posts.sort(function (a, b) { return P(a[0], a[1], 0).d - P(b[0], b[1], 0).d; });
      posts.forEach(function (pt) {
        var pw = 0.32;
        fillP([P(pt[0] - pw, pt[1], 0), P(pt[0] + pw, pt[1], 0), P(pt[0] + pw, pt[1], topP), P(pt[0] - pw, pt[1], topP)], shade('#CFC8BC', 0.95));
      });
      var slab = [P(p2.x0, p2.y0, topP), P(p2.x1, p2.y0, topP), P(p2.x1, p2.y1, topP), P(p2.x0, p2.y1, topP)];
      fillP(slab, '#A8A296'); strokeP(slab, 'rgba(90,92,88,0.5)', 1);
      fillP([P(p2.x0, p2.y1, topP), P(p2.x1, p2.y1, topP), P(p2.x1, p2.y1, topP - 0.5), P(p2.x0, p2.y1, topP - 0.5)], shade('#A8A296', 0.85));
    }

    var drawables = solids.map(function (s2, i2) {
      return { kind: 'solid', ref: s2, isMain: i2 === mainIdx, d: P((s2.x0 + s2.x1) / 2, (s2.y0 + s2.y1) / 2, 0).d - s2.top * 0.02 };
    }).concat(porches.map(function (p2) {
      return { kind: 'porch', ref: p2, d: P((p2.x0 + p2.x1) / 2, (p2.y0 + p2.y1) / 2, 0).d - 0.5 };
    }));
    drawables.sort(function (a, b) { return a.d - b.d; });
    drawables.forEach(function (dr) { if (dr.kind === 'solid') drawSolid(dr.ref, dr.isMain); else drawPorch(dr.ref); });
  }
  root.OrchaHouse3D = { render: render, shade: shade };
})(typeof window !== 'undefined' ? window : this);

/* Hologram / blueprint mode — glowing cyan wireframe on a dark grid,
   matching the "plan becomes a building" reveal. Same geometry as render(). */
(function (root) {
  function renderHologram(o) {
    var cv = o.canvas, g = o.geom; if (!cv || !g || !g.rooms || !g.rooms.length) return;
    var theta = o.theta || 0, zoom = o.zoom || 1, grow = o.grow == null ? 1 : Math.max(0, Math.min(1, o.grow));
    var pitch = o.pitch == null ? 0.5 : o.pitch; pitch = Math.max(0.14, Math.min(0.9, pitch));
    var flat = pitch, zscale = 0.62 + (1 - pitch) * 0.5;
    var dpr = root.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight || 300;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

    // dark backdrop with subtle radial glow
    var bg = ctx.createRadialGradient(W / 2, H * 0.62, 10, W / 2, H * 0.62, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#0d2740'); bg.addColorStop(0.5, '#081a2c'); bg.addColorStop(1, '#040d17');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    var rooms = g.rooms, storyH = g.storyHeight || 9;
    var stories = g.stories || Math.max(1, Math.round((g.wallHeightFt || storyH) / storyH));
    var wallTop = storyH * stories;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    rooms.forEach(function (r) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    var Wd = maxX - minX, Dp = maxY - minY, cvirt = Math.max(Wd, Dp) || 1;
    var span = cvirt * 1.9, s = (Math.min(W, H) * 0.92 / span) * zoom;
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cosT = Math.cos(theta), sinT = Math.sin(theta);
    function P(x, y, z) {
      var rx = (x - cx) * cosT - (y - cy) * sinT, ry = (x - cx) * sinT + (y - cy) * cosT;
      return { x: W / 2 + rx * s, y: H * 0.70 + ry * s * flat - z * s * zscale, d: ry };
    }
    var CY = '#38d6ff', CY_DIM = 'rgba(56,214,255,0.28)', CY_SOFT = 'rgba(56,214,255,0.6)';
    function line(a, b, color, w, glow) {
      ctx.save();
      if (glow) { ctx.shadowColor = CY; ctx.shadowBlur = glow; }
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }

    var o1 = Math.max(0.8, cvirt * 0.04), wt = wallTop * grow;

    // ground grid (perspective), fading out
    ctx.save(); ctx.globalAlpha = 0.5;
    var gm = Math.max(3, cvirt * 0.6);
    var gx0 = Math.floor((minX - gm) / 4) * 4, gx1 = Math.ceil((maxX + gm) / 4) * 4;
    var gy0 = Math.floor((minY - gm) / 4) * 4, gy1 = Math.ceil((maxY + gm) / 4) * 4;
    for (var gx = gx0; gx <= gx1; gx += 4) line(P(gx, gy0, 0), P(gx, gy1, 0), CY_DIM, 0.7, 0);
    for (var gy = gy0; gy <= gy1; gy += 4) line(P(gx0, gy, 0), P(gx1, gy, 0), CY_DIM, 0.7, 0);
    ctx.restore();

    // footprint outline (bright)
    var fp = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    for (var i = 0; i < 4; i++) line(P(fp[i][0], fp[i][1], 0), P(fp[(i + 1) % 4][0], fp[(i + 1) % 4][1], 0), CY, 1.6, 8);

    // interior room partitions on the floor (dimmer)
    rooms.forEach(function (r) {
      var a = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
      for (var i = 0; i < 4; i++) line(P(a[i][0], a[i][1], 0), P(a[(i + 1) % 4][0], a[(i + 1) % 4][1], 0), CY_SOFT, 0.9, 4);
    });

    // vertical edges + top ring rise with grow
    var corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    corners.forEach(function (c) { line(P(c[0], c[1], 0), P(c[0], c[1], wt), CY, 1.5, 8); });
    // story rings
    for (var st = 1; st <= stories; st++) {
      var zz = Math.min(wt, st * storyH);
      if (zz <= 0) continue;
      for (var i = 0; i < 4; i++) line(P(corners[i][0], corners[i][1], zz), P(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], zz), st === stories ? CY : CY_SOFT, st === stories ? 1.6 : 1, st === stories ? 8 : 3);
    }

    // roof wireframe once walls are up
    if (grow > 0.55) {
      var ra = Math.min(1, (grow - 0.55) / 0.4);
      var hRoof = (g.roof || 'gable').toLowerCase();
      var hMul = hRoof === 'flat' ? 0.06 : (hRoof === 'low-slope' || hRoof === 'shed' || hRoof === 'lowslope') ? 0.16 : 0.5;
      var rise = Math.max(hRoof === 'flat' ? 0.6 : 1.5, Math.min(Wd, Dp) * hMul) * ra, zr = wallTop + rise;
      var lx0 = minX - o1, lx1 = maxX + o1, ly0 = minY - o1, ly1 = maxY + o1;
      if (hRoof === 'flat' || hRoof === 'low-slope' || hRoof === 'shed' || hRoof === 'lowslope') {
        // top slab rectangle (flat) or tilted slab (low-slope: front edge raised)
        var frontZ = (hRoof === 'flat') ? wallTop : zr, backZ = wallTop;
        var tp = [P(lx0, ly0, frontZ), P(lx1, ly0, frontZ), P(lx1, ly1, backZ), P(lx0, ly1, backZ)];
        for (var i = 0; i < 4; i++) line(tp[i], tp[(i + 1) % 4], CY, 1.5, 8);
        // eave rectangle at wall top
        var evf = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]];
        for (var i = 0; i < 4; i++) line(P(evf[i][0], evf[i][1], wallTop), P(evf[(i + 1) % 4][0], evf[(i + 1) % 4][1], wallTop), CY_SOFT, 1, 4);
      } else if (Wd >= Dp) {
        var midY = (minY + maxY) / 2;
        var R1 = P(lx0, midY, zr), R2 = P(lx1, midY, zr);
        line(R1, R2, CY, 1.6, 10);
        [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]].forEach(function (e, i) {
          var ridge = (e[0] === lx0) ? R1 : R2;
          line(P(e[0], e[1], wallTop), ridge, CY, 1.2, 6);
        });
        var ev = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]];
        for (var i = 0; i < 4; i++) line(P(ev[i][0], ev[i][1], wallTop), P(ev[(i + 1) % 4][0], ev[(i + 1) % 4][1], wallTop), CY_SOFT, 1, 4);
      } else {
        var midX = (minX + maxX) / 2;
        var Ra = P(midX, ly0, zr), Rb = P(midX, ly1, zr);
        line(Ra, Rb, CY, 1.6, 10);
        [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]].forEach(function (e) {
          var ridge = (e[1] === ly0) ? Ra : Rb;
          line(P(e[0], e[1], wallTop), ridge, CY, 1.2, 6);
        });
        var ev2 = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]];
        for (var i = 0; i < 4; i++) line(P(ev2[i][0], ev2[i][1], wallTop), P(ev2[(i + 1) % 4][0], ev2[(i + 1) % 4][1], wallTop), CY_SOFT, 1, 4);
      }
    }

    // scan sweep line during build for the "materializing" feel
    if (grow < 1) {
      var zsw = wallTop * grow;
      ctx.save(); ctx.globalAlpha = 0.9; ctx.shadowColor = CY; ctx.shadowBlur = 16;
      var ring = [[minX - o1, minY - o1], [maxX + o1, minY - o1], [maxX + o1, maxY + o1], [minX - o1, maxY + o1]];
      ctx.strokeStyle = '#8af0ff'; ctx.lineWidth = 2; ctx.beginPath();
      for (var i = 0; i < 4; i++) { var p = P(ring[i][0], ring[i][1], zsw); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }
  }
  root.OrchaHouse3D.renderHologram = renderHologram;
})(typeof window !== 'undefined' ? window : this);
