/* Orchamind house3d — zero-dependency canvas renderer.
   Turns a floor-plan takeoff (rooms + wall height) into a realistic massing
   model: stucco walls, pitched hip roof, windows, front door, sky + ground.
   Shared by the estimator app (demo.html) and the /ai-estimating hero. */
(function (root) {
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    f = Math.max(0.3, Math.min(1.3, f));
    return 'rgb(' + Math.min(255, r * f | 0) + ',' + Math.min(255, g * f | 0) + ',' + Math.min(255, b * f | 0) + ')';
  }
  // Materials
  var WALL = '#E7DFD1', ROOF = '#464C57', ROOF_RIDGE = '#3A404A',
      GLASS = '#93B6D6', DOOR = '#6B4E34', TRIM = 'rgba(70,58,42,0.35)',
      EDGE = 'rgba(40,32,22,0.55)';

  // opts: { canvas, geom:{wallHeightFt,rooms:[{name,x,y,w,h}]}, theta, pitch, zoom }
  function render(o) {
    var cv = o.canvas, g = o.geom; if (!cv || !g || !g.rooms || !g.rooms.length) return;
    var theta = o.theta || 0, zoom = o.zoom || 1;
    var pitch = o.pitch == null ? 0.5 : o.pitch;        // 0 = eye level, 1 = top-down
    pitch = Math.max(0.12, Math.min(0.92, pitch));       // clamp so it never flips
    var flat = pitch;               // vertical foreshortening of the ground plane
    var zscale = 0.66 + (1 - pitch) * 0.55;              // taller elevation when lower angle
    var dpr = root.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight || 300;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

    // sky
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#D6E6F5'); sky.addColorStop(0.5, '#E7F0F8'); sky.addColorStop(1, '#EFEBE2');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    var rooms = g.rooms, hFt = g.wallHeightFt || 9;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    rooms.forEach(function (r) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); });
    var Wd = maxX - minX, Dp = maxY - minY, cvirt = Math.max(Wd, Dp) || 1;
    var span = cvirt * 1.85;
    var s = (Math.min(W, H) * 0.92 / span) * zoom;
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var cosT = Math.cos(theta), sinT = Math.sin(theta);
    function P(x, y, z) {
      var rx = (x - cx) * cosT - (y - cy) * sinT, ry = (x - cx) * sinT + (y - cy) * cosT;
      return { x: W / 2 + rx * s, y: H * 0.68 + ry * s * flat - z * s * zscale, d: ry };
    }
    function poly(pts, fill, st, lw) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (st) { ctx.strokeStyle = st; ctx.lineWidth = lw || 1; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    var o1 = Math.max(0.8, cvirt * 0.035); // roof overhang / margin

    // soft contact shadow
    ctx.save(); ctx.globalAlpha = 0.18;
    var sh = [P(minX - o1, minY - o1, 0), P(maxX + o1, minY - o1, 0), P(maxX + o1, maxY + o1, 0), P(minX - o1, maxY + o1, 0)];
    sh.forEach(function (p) { p.x += 7; p.y += 9; }); poly(sh, '#233', null); ctx.restore();

    // ground plane + subtle grid
    var gm = Math.max(3, cvirt * 0.5);
    poly([P(minX - gm, minY - gm, 0), P(maxX + gm, minY - gm, 0), P(maxX + gm, maxY + gm, 0), P(minX - gm, maxY + gm, 0)], '#E3E9DF', 'rgba(150,160,140,0.25)', 1);
    ctx.strokeStyle = 'rgba(120,140,120,0.16)'; ctx.lineWidth = 0.5;
    var gx0 = Math.floor((minX - gm) / 5) * 5, gx1 = Math.ceil((maxX + gm) / 5) * 5;
    var gy0 = Math.floor((minY - gm) / 5) * 5, gy1 = Math.ceil((maxY + gm) / 5) * 5;
    for (var gx = gx0; gx <= gx1; gx += 5) { var a = P(gx, gy0, 0), b = P(gx, gy1, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (var gy = gy0; gy <= gy1; gy += 5) { var a2 = P(gx0, gy, 0), b2 = P(gx1, gy, 0); ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }

    // sun
    var lightAng = theta + 0.7, lx = Math.cos(lightAng), ly = Math.sin(lightAng);

    // ---- exterior walls (bbox shell) with windows + door ----
    var wallFaces = [];
    var ex = [
      [minX, minY, maxX, minY, 0, -1, 1], // front (-Y) gets the door
      [maxX, minY, maxX, maxY, 1, 0, 0],  // right
      [maxX, maxY, minX, maxY, 0, 1, 0],  // back
      [minX, maxY, minX, minY, -1, 0, 0]  // left
    ];
    ex.forEach(function (w) {
      var nx = w[4], ny = w[5], isFront = w[6];
      var lit = 0.82 + 0.42 * Math.max(0, nx * lx + ny * ly);
      var a = P(w[0], w[1], 0), b = P(w[2], w[3], 0), c = P(w[2], w[3], hFt), d = P(w[0], w[1], hFt);
      var f = { d: (a.d + b.d) / 2, pts: [a, b, c, d], fill: shade(WALL, lit), st: EDGE, lw: 1.2, ov: [] };
      var dxx = w[2] - w[0], dyy = w[3] - w[1], L = Math.hypot(dxx, dyy), ux = dxx / L, uy = dyy / L;
      var count = Math.max(1, Math.round(L / 9));
      var doorAt = isFront ? Math.ceil((count + 1) / 2) : -1;
      for (var k = 1; k <= count; k++) {
        var px = w[0] + ux * (L * k / (count + 1)), py = w[1] + uy * (L * k / (count + 1));
        if (k === doorAt) {
          var dh = 0.8;
          f.ov.push({ pts: [P(px - ux * dh, py - uy * dh, 0), P(px + ux * dh, py + uy * dh, 0), P(px + ux * dh, py + uy * dh, 6.8), P(px - ux * dh, py - uy * dh, 6.8)], fill: shade(DOOR, lit), st: EDGE });
          continue;
        }
        var hw = Math.min(1.6, L / (count + 1) * 0.32), sill = 3, head = 6.4;
        f.ov.push({ pts: [P(px - ux * hw, py - uy * hw, sill), P(px + ux * hw, py + uy * hw, sill), P(px + ux * hw, py + uy * hw, head), P(px - ux * hw, py - uy * hw, head)], fill: shade(GLASS, Math.max(0.9, lit + 0.28)), st: 'rgba(50,60,75,0.7)' });
      }
      wallFaces.push(f);
    });
    wallFaces.sort(function (a, b) { return a.d - b.d; });
    wallFaces.forEach(function (f) { poly(f.pts, f.fill, f.st, f.lw); f.ov.forEach(function (v) { poly(v.pts, v.fill, v.st, 1); }); });

    // ---- hip roof over the footprint ----
    var rise = Math.max(2.2, Math.min(Wd, Dp) * 0.42), zr = hFt + rise;
    var E1 = [minX - o1, minY - o1], E2 = [maxX + o1, minY - o1], E3 = [maxX + o1, maxY + o1], E4 = [minX - o1, maxY + o1];
    var rf = [];
    if (Wd >= Dp) {
      var midY = (minY + maxY) / 2, ins = (Dp + 2 * o1) / 2;
      var R1 = [E1[0] + ins, midY], R2 = [E2[0] - ins, midY];
      rf.push(mkRoof([E1, E2, R2, R1], 0, -1)); // front slope
      rf.push(mkRoof([E4, E3, R2, R1], 0, 1));  // back slope
      rf.push(mkRoof([E1, E4, R1], -1, 0));     // left hip
      rf.push(mkRoof([E2, E3, R2], 1, 0));      // right hip
    } else {
      var midX = (minX + maxX) / 2, ins2 = (Wd + 2 * o1) / 2;
      var Ra = [midX, E1[1] + ins2], Rb = [midX, E4[1] - ins2];
      rf.push(mkRoof([E1, E2, Ra], 0, -1));
      rf.push(mkRoof([E4, E3, Rb], 0, 1));
      rf.push(mkRoof([E1, E4, Rb, Ra], -1, 0));
      rf.push(mkRoof([E2, E3, Rb, Ra], 1, 0));
    }
    function mkRoof(flatPts, nx, ny) {
      // eave corners sit at wall height; ridge points rise to zr
      var pts = flatPts.map(function (p) { return P(p[0], p[1], isRidge(p) ? zr : hFt); });
      var lit = 0.72 + 0.5 * Math.max(0, nx * lx + ny * ly);
      var dsum = 0; pts.forEach(function (q) { dsum += q.d; });
      return { d: dsum / pts.length, pts: pts, fill: shade(ROOF, lit), st: 'rgba(30,34,42,0.6)' };
    }
    function isRidge(p) {
      // ridge points are the R-endpoints (interior), identified by not being an eave corner
      return !(p === E1 || p === E2 || p === E3 || p === E4);
    }
    rf.sort(function (a, b) { return a.d - b.d; });
    rf.forEach(function (f) { poly(f.pts, f.fill, f.st, 1.2); });
    // ridge line highlight
    ctx.strokeStyle = ROOF_RIDGE; ctx.lineWidth = 1.5;
  }

  root.OrchaHouse3D = { render: render, shade: shade };
})(typeof window !== 'undefined' ? window : this);
