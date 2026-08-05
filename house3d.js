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

    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    rooms.forEach(function (r) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
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

    var ex = [
      [minX, minY, maxX, minY, 0, -1, 1],
      [maxX, minY, maxX, maxY, 1, 0, 0],
      [maxX, maxY, minX, maxY, 0, 1, 0],
      [minX, maxY, minX, minY, -1, 0, 0]
    ];
    var wallFaces = ex.map(function (w) {
      var nx = w[4], ny = w[5];
      var lit = 0.86 + 0.38 * Math.max(0, nx * lx + ny * ly);
      var a = P(w[0], w[1], 0), b = P(w[2], w[3], 0);
      return { w: w, lit: lit, d: (a.d + b.d) / 2, quad: [a, b, P(w[2], w[3], wt), P(w[0], w[1], wt)] };
    }).sort(function (p, q) { return p.d - q.d; });

    wallFaces.forEach(function (wf) {
      var w = wf.w, lit = wf.lit, isFront = w[6];
      grad(wf.quad, WALL, lit * 0.9, lit * 1.06, 'rgba(90,92,88,0.45)');
      if (grow < 0.55) return;
      var wa = Math.min(1, (grow - 0.55) / 0.35); ctx.save(); ctx.globalAlpha = wa;
      var dxx = w[2] - w[0], dyy = w[3] - w[1], L = Math.hypot(dxx, dyy), ux = dxx / L, uy = dyy / L;
      // Real window counts from the plan's elevations, when the takeoff read them.
      // front = wall with the entry door; back/left/right mapped by wall normal.
      var elev = isFront ? 'front' : (w[5] === 1 ? 'back' : (w[4] === -1 ? 'left' : 'right'));
      var winData = (g.windows && typeof g.windows === 'object') ? g.windows : null;
      var raw = winData ? winData[elev] : null;
      // Accept both shapes: a plain number (older data) or {count, style, clerestory}
      var wInfo = null;
      if (typeof raw === 'number' && isFinite(raw)) wInfo = { count: Math.max(0, Math.min(24, Math.round(raw))), style: 'punched', clerestory: false };
      else if (raw && typeof raw === 'object' && typeof raw.count === 'number' && isFinite(raw.count)) wInfo = { count: Math.max(0, Math.min(24, Math.round(raw.count))), style: raw.style || 'punched', clerestory: !!raw.clerestory };
      var totalForWall = wInfo ? wInfo.count : null;
      var isBand = wInfo && (wInfo.style === 'window-wall' || wInfo.style === 'mixed') && wInfo.count > 0;
      // Continuous glazing band for window-wall / storefront-style elevations —
      // drawn once per story as a recessed strip with panel divisions, matching
      // how modern glass homes actually read, instead of scattered punched holes.
      function drawBand(z0) {
        var t0 = 0.06, t1 = 0.94, sillB = z0 + 1.2, headB = z0 + storyH - 1.4;
        var ax = w[0] + ux * L * t0, ay = w[1] + uy * L * t0, bx = w[0] + ux * L * t1, by = w[1] + uy * L * t1;
        fillP([P(ax, ay, sillB - .15), P(bx, by, sillB - .15), P(bx, by, headB + .15), P(ax, ay, headB + .15)], REVEAL);
        fillP([P(ax + ux * .12, ay + uy * .12, sillB), P(bx - ux * .12, by - uy * .12, sillB), P(bx - ux * .12, by - uy * .12, headB), P(ax + ux * .12, ay + uy * .12, headB)], shade(GLASS, lit * 1.02));
        var panels = Math.max(2, Math.min(12, wInfo.count));
        ctx.strokeStyle = 'rgba(60,68,78,0.5)'; ctx.lineWidth = 1;
        for (var pi = 1; pi < panels; pi++) {
          var tt = t0 + (t1 - t0) * pi / panels;
          var mx1 = P(w[0] + ux * L * tt, w[1] + uy * L * tt, sillB), mx2 = P(w[0] + ux * L * tt, w[1] + uy * L * tt, headB);
          ctx.beginPath(); ctx.moveTo(mx1.x, mx1.y); ctx.lineTo(mx2.x, mx2.y); ctx.stroke();
        }
      }
      function drawClerestory() {
        // thin glazing strip just under the roof line — the raised-center band
        var t0 = 0.14, t1 = 0.86, sillC = wallTop - 1.7, headC = wallTop - 0.35;
        var ax = w[0] + ux * L * t0, ay = w[1] + uy * L * t0, bx = w[0] + ux * L * t1, by = w[1] + uy * L * t1;
        fillP([P(ax, ay, sillC - .1), P(bx, by, sillC - .1), P(bx, by, headC + .1), P(ax, ay, headC + .1)], REVEAL);
        fillP([P(ax + ux * .1, ay + uy * .1, sillC), P(bx - ux * .1, by - uy * .1, sillC), P(bx - ux * .1, by - uy * .1, headC), P(ax + ux * .1, ay + uy * .1, headC)], shade(GLASS, lit * 1.06));
      }
      for (var st = 0; st < stories; st++) {
        var z0 = st * storyH, sill = z0 + 3, head = z0 + 6.6;
        if (st > 0) { fillP([P(w[0], w[1], z0 - 0.25), P(w[2], w[3], z0 - 0.25), P(w[2], w[3], z0 + 0.25), P(w[0], w[1], z0 + 0.25)], shade('#E4DFD4', lit)); }
        if (isBand) {
          drawBand(z0);
          if (st === 0 && isFront) {
            // entry door reads through the band as a solid panel
            var dpx = w[0] + ux * L * 0.5, dpy = w[1] + uy * L * 0.5, ddh = 0.85;
            fillP([P(dpx - ux * ddh, dpy - uy * ddh, z0), P(dpx + ux * ddh, dpy + uy * ddh, z0), P(dpx + ux * ddh, dpy + uy * ddh, z0 + 7.0), P(dpx - ux * ddh, dpy - uy * ddh, z0 + 7.0)], shade(DOOR, lit));
          }
          continue;
        }
        var perStory;
        if (totalForWall !== null) {
          // distribute the plan's real count across stories, extras on lower floors
          var base = Math.floor(totalForWall / stories), rem = totalForWall % stories;
          perStory = base + (st < rem ? 1 : 0);
        } else {
          // no elevation data — draw NO windows rather than inventing them;
          // a clean massing model is honest, fabricated openings are not
          perStory = 0;
        }
        var slots = perStory, doorSlot = -1;
        if (st === 0 && isFront) { slots = perStory + 1; doorSlot = Math.ceil(slots / 2); }
        for (var k = 1; k <= slots; k++) {
          var px = w[0] + ux * (L * k / (slots + 1)), py = w[1] + uy * (L * k / (slots + 1));
          if (k === doorSlot) {
            var dh = 0.85;
            fillP([P(px - ux * dh, py - uy * dh, z0), P(px + ux * dh, py + uy * dh, z0), P(px + ux * dh, py + uy * dh, z0 + 7.0), P(px - ux * dh, py - uy * dh, z0 + 7.0)], REVEAL);
            fillP([P(px - ux * (dh - .12), py - uy * (dh - .12), z0), P(px + ux * (dh - .12), py + uy * (dh - .12), z0), P(px + ux * (dh - .12), py + uy * (dh - .12), z0 + 6.85), P(px - ux * (dh - .12), py - uy * (dh - .12), z0 + 6.85)], shade(DOOR, lit));
            continue;
          }
          var hw = Math.min(1.5, L / (slots + 1) * 0.34);
          // recessed opening: dark reveal, then flat glass inset — clean, architectural
          fillP([P(px - ux * hw, py - uy * hw, sill - .15), P(px + ux * hw, py + uy * hw, sill - .15), P(px + ux * hw, py + uy * hw, head + .15), P(px - ux * hw, py - uy * hw, head + .15)], REVEAL);
          fillP([P(px - ux * (hw - .12), py - uy * (hw - .12), sill), P(px + ux * (hw - .12), py + uy * (hw - .12), sill), P(px + ux * (hw - .12), py + uy * (hw - .12), head), P(px - ux * (hw - .12), py - uy * (hw - .12), head)], shade(GLASS, lit * 1.02));
        }
      }
      if (wInfo && wInfo.clerestory) drawClerestory();
      ctx.restore();
    });

    if (grow > 0.5) {
      var ra = Math.min(1, (grow - 0.5) / 0.4);
      var roofType = (g.roof || 'gable').toLowerCase();
      var pitchMul = roofType === 'flat' ? 0.06 : (roofType === 'low-slope' || roofType === 'shed' || roofType === 'lowslope') ? 0.16 : 0.5;
      var rise = Math.max(roofType === 'flat' ? 0.6 : 1.5, Math.min(Wd, Dp) * pitchMul) * ra, zr = wallTop + rise;
      var lx0 = minX - o1, lx1 = maxX + o1, ly0 = minY - o1, ly1 = maxY + o1, faces = [];
      var flatCol = '#5A6472';
      if (roofType === 'flat') {
        // single flat slab with a slight parapet edge
        faces.push({ pts: [P(lx0, ly0, wallTop), P(lx1, ly0, wallTop), P(lx1, ly1, wallTop), P(lx0, ly1, wallTop)], nx: 0, ny: 0, base: flatCol, flat: 1 });
      } else if (roofType === 'shed' || roofType === 'low-slope' || roofType === 'lowslope') {
        // mono-pitch: high edge on the -Y (front) side, sloping down to +Y
        faces.push({ pts: [P(lx0, ly0, zr), P(lx1, ly0, zr), P(lx1, ly1, wallTop), P(lx0, ly1, wallTop)], nx: 0, ny: -0.3, base: flatCol, flat: 1 });
        // side triangles filling the wedge
        faces.push({ tri: 1, pts: [P(minX, ly0, wallTop), P(minX, ly0, zr), P(minX, ly1, wallTop)], nx: -1, ny: 0, base: GABLE });
        faces.push({ tri: 1, pts: [P(maxX, ly0, wallTop), P(maxX, ly0, zr), P(maxX, ly1, wallTop)], nx: 1, ny: 0, base: GABLE });
      } else if (roofType === 'hip') {
        var ins = Math.min(Wd, Dp) / 2;
        if (Wd >= Dp) {
          var my = (minY + maxY) / 2, r1 = [lx0 + ins, my], r2 = [lx1 - ins, my];
          faces.push({ pts: [P(lx0, ly0, wallTop), P(lx1, ly0, wallTop), P(r2[0], r2[1], zr), P(r1[0], r1[1], zr)], nx: 0, ny: -1, base: ROOF });
          faces.push({ pts: [P(lx0, ly1, wallTop), P(lx1, ly1, wallTop), P(r2[0], r2[1], zr), P(r1[0], r1[1], zr)], nx: 0, ny: 1, base: ROOF });
          faces.push({ tri: 1, pts: [P(lx0, ly0, wallTop), P(lx0, ly1, wallTop), P(r1[0], r1[1], zr)], nx: -1, ny: 0, base: ROOF });
          faces.push({ tri: 1, pts: [P(lx1, ly0, wallTop), P(lx1, ly1, wallTop), P(r2[0], r2[1], zr)], nx: 1, ny: 0, base: ROOF });
        } else {
          var mx = (minX + maxX) / 2, ra1 = [mx, ly0 + ins], ra2 = [mx, ly1 - ins];
          faces.push({ pts: [P(lx0, ly0, wallTop), P(lx0, ly1, wallTop), P(ra2[0], ra2[1], zr), P(ra1[0], ra1[1], zr)], nx: -1, ny: 0, base: ROOF });
          faces.push({ pts: [P(lx1, ly0, wallTop), P(lx1, ly1, wallTop), P(ra2[0], ra2[1], zr), P(ra1[0], ra1[1], zr)], nx: 1, ny: 0, base: ROOF });
          faces.push({ tri: 1, pts: [P(lx0, ly0, wallTop), P(lx1, ly0, wallTop), P(ra1[0], ra1[1], zr)], nx: 0, ny: -1, base: ROOF });
          faces.push({ tri: 1, pts: [P(lx0, ly1, wallTop), P(lx1, ly1, wallTop), P(ra2[0], ra2[1], zr)], nx: 0, ny: 1, base: ROOF });
        }
      } else if (Wd >= Dp) {
        var midY = (minY + maxY) / 2;
        faces.push({ tri: 1, pts: [P(minX, minY, wallTop), P(minX, maxY, wallTop), P(minX, midY, zr)], nx: -1, ny: 0, base: GABLE });
        faces.push({ tri: 1, pts: [P(maxX, minY, wallTop), P(maxX, maxY, wallTop), P(maxX, midY, zr)], nx: 1, ny: 0, base: GABLE });
        faces.push({ pts: [P(lx0, ly0, wallTop), P(lx1, ly0, wallTop), P(lx1, midY, zr), P(lx0, midY, zr)], nx: 0, ny: -1, base: ROOF });
        faces.push({ pts: [P(lx0, ly1, wallTop), P(lx1, ly1, wallTop), P(lx1, midY, zr), P(lx0, midY, zr)], nx: 0, ny: 1, base: ROOF });
      } else {
        var midX = (minX + maxX) / 2;
        faces.push({ tri: 1, pts: [P(minX, minY, wallTop), P(maxX, minY, wallTop), P(midX, minY, zr)], nx: 0, ny: -1, base: GABLE });
        faces.push({ tri: 1, pts: [P(minX, maxY, wallTop), P(maxX, maxY, wallTop), P(midX, maxY, zr)], nx: 0, ny: 1, base: GABLE });
        faces.push({ pts: [P(lx0, ly0, wallTop), P(lx0, ly1, wallTop), P(midX, ly1, zr), P(midX, ly0, zr)], nx: -1, ny: 0, base: ROOF });
        faces.push({ pts: [P(lx1, ly0, wallTop), P(lx1, ly1, wallTop), P(midX, ly1, zr), P(midX, ly0, zr)], nx: 1, ny: 0, base: ROOF });
      }
      faces.forEach(function (f) { f.d = f.pts.reduce(function (s2, p) { return s2 + p.d; }, 0) / f.pts.length; });
      faces.sort(function (a, b) { return a.d - b.d; });
      faces.forEach(function (f) {
        var lit = f.flat ? 1.0 : (0.72 + 0.5 * Math.max(0, f.nx * lx + f.ny * ly));
        if (f.tri) { fillP(f.pts, shade(f.base, lit)); strokeP(f.pts, 'rgba(90,92,88,0.45)', 1); }
        else { grad(f.pts, f.base, lit * 0.92, lit * 1.08, 'rgba(96,98,94,0.55)'); }
      });
      // chimney only on pitched (non-flat) traditional roofs
    }
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
