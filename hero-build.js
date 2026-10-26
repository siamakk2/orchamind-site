/* Homepage hero: a house that builds itself from its floor plan.
 *
 * Same sample house as the "From plans to 3D" section (48 x 36 ft single story,
 * 22 x 24 ft garage, front porch): blueprint lines -> slab -> framing at 16" ->
 * walls and windows -> trusses and roof -> porch and lights. The captions show
 * the real takeoff numbers for this geometry, computed below from the same
 * dimensions the model is built from.
 *
 * Loads three.js only after the page has loaded, pauses when off screen,
 * honours prefers-reduced-motion (finished house, no motion), and falls back
 * to the rendered 3D plan image when WebGL is not available.
 */
(function () {
  var stage = document.getElementById('buildStage');
  if (!stage) return;
  var canvasBox = stage.querySelector('.bs-canvas');
  var capEl = stage.querySelector('.bs-cap');
  var stepEls = stage.querySelectorAll('.bs-steps li');
  var replay = stage.querySelector('.bs-replay');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- The house, in feet. Plan y = 0 is the back wall; the porch is at the front (y = 36..42).
  var HOUSE = { w: 48, d: 36 }, GAR = { x: 48, w: 22, d: 24 };
  var WALLS = [ // exterior
    [0, 0, 48, 0], [48, 0, 70, 0], [70, 0, 70, 24], [48, 24, 70, 24], [48, 24, 48, 36], [0, 36, 48, 36], [0, 0, 0, 36]];
  var INNER = [[14, 0, 14, 36], [34, 0, 34, 36], [0, 13, 14, 13], [0, 21, 14, 21], [9, 13, 9, 21], [34, 10, 48, 10], [42, 0, 42, 10], [48, 0, 48, 24]];
  // windows: [x1,y1,x2,y2, sill, head]
  var WINS = [[3, 0, 10, 0], [18, 0, 24, 0], [26, 0, 31, 0], [37, 0, 40, 0], [3, 36, 10, 36], [17, 36, 20.5, 36], [24.5, 36, 31, 36], [37, 36, 45, 36],
    [0, 4, 0, 9], [0, 25, 0, 32], [48, 26, 48, 33]];
  var DOORS = [[21, 36, 24, 36], [52, 24, 66, 24]]; // entry, garage door
  var WALL_H = 9, STUD = 16 / 12;

  // ---- Takeoff for the captions (same numbers the geometry uses)
  function len(s) { return Math.hypot(s[2] - s[0], s[3] - s[1]); }
  var studs = 0;
  WALLS.concat(INNER).forEach(function (s) { studs += Math.floor(len(s) / STUD) + 1; });
  var slabSf = HOUSE.w * HOUSE.d + GAR.w * GAR.d;                    // 2,256
  var slabCy = Math.ceil(slabSf * (4 / 12) / 27 * 2) / 2;            // 4" slab, to the half yard
  var pitch = Math.sqrt(1 + 0.5 * 0.5);                               // 6:12
  var roofSq = Math.round(((HOUSE.w + 2) * (HOUSE.d + 2) + (GAR.w + 2) * (GAR.d + 2)) * pitch / 100);
  var STEPS = [
    { t: 0.0, label: 'Reading the plan', cap: 'Floor plan read: 48′ × 36′ + 22′ × 24′ garage, 3 bed / 2 bath' },
    { t: 1.6, label: 'Slab', cap: 'Slab: ' + slabSf.toLocaleString('en-US') + ' sq ft · 4″ · ' + slabCy + ' cubic yards of concrete' },
    { t: 2.7, label: 'Framing', cap: 'Framing: ' + studs + ' studs at 16″ on center, 9′ walls' },
    { t: 4.7, label: 'Walls & windows', cap: 'Walls & windows: ' + WINS.length + ' windows, 2 exterior doors' },
    { t: 6.2, label: 'Roof', cap: 'Roof: 6:12 gable · ' + roofSq + ' squares of metal roofing' },
    { t: 7.8, label: 'Done', cap: 'From the plan to a 3D model and a priced takeoff, in minutes' }];
  var END = 9.2;

  function setStep(i) {
    for (var k = 0; k < stepEls.length; k++) { stepEls[k].classList.toggle('on', k === i); stepEls[k].classList.toggle('done', k < i); }
    if (capEl && capEl.getAttribute('data-i') !== String(i)) { capEl.textContent = STEPS[i].cap; capEl.setAttribute('data-i', i); }
  }

  function fallback() {
    stage.classList.add('bs-static');
    canvasBox.innerHTML = '<img src="/media/home/plan3d-1200.webp" alt="3D floor plan of the sample house" width="1200" height="670" loading="lazy" decoding="async">';
    setStep(STEPS.length - 1);
  }

  function hasWebGL() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
  }

  function start() {
    if (!hasWebGL()) return fallback();
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.async = true;
    s.onload = function () { try { build(window.THREE); } catch (e) { fallback(); } };
    s.onerror = fallback;
    document.head.appendChild(s);
  }

  function build(THREE) {
    var W = canvasBox.clientWidth || 600, H = canvasBox.clientHeight || 420;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(W, H);
    renderer.outputEncoding = THREE.sRGBEncoding;
    var shadows = W > 520;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasBox.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(32, W / H, 1, 600);
    var S = 1;                                    // world units = feet
    var cx = 35, cz = 21;                         // centre of the whole footprint
    function X(x) { return (x - cx) * S; }
    function Z(y) { return (y - cz) * S; }

    scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x2a2016, 0.75));
    var sun = new THREE.DirectionalLight(0xffd29a, 1.15);
    sun.position.set(-60, 90, 70);
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(1024, 1024);
      var sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 260;
      sun.shadow.bias = -0.0008;
    }
    scene.add(sun);

    // Blueprint ground: a fading grid on a canvas texture
    var gc = document.createElement('canvas'); gc.width = gc.height = 1024;
    var g = gc.getContext('2d');
    var grad = g.createRadialGradient(512, 512, 60, 512, 512, 512);
    grad.addColorStop(0, 'rgba(45,127,249,0.20)'); grad.addColorStop(1, 'rgba(45,127,249,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 1024);
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(140,190,255,0.9)';
    for (var i = 0; i <= 1024; i += 32) { g.lineWidth = i % 128 === 0 ? 1.6 : 0.6; g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke(); }
    var gtex = new THREE.CanvasTexture(gc);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
    var shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), new THREE.ShadowMaterial({ opacity: 0.35 }));
    shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);

    var anims = [];                               // {obj, t0, t1, kind, ...}
    function at(obj, t0, t1, kind, extra) { var a = Object.assign({ obj: obj, t0: t0, t1: t1, kind: kind }, extra || {}); anims.push(a); return a; }
    function ease(x) { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

    // 1) Blueprint lines on the ground
    var lineMat = new THREE.LineBasicMaterial({ color: 0x8fc0ff, transparent: true, opacity: 0 });
    var pts = [];
    WALLS.concat(INNER).forEach(function (s) { pts.push(new THREE.Vector3(X(s[0]), 0.05, Z(s[1])), new THREE.Vector3(X(s[2]), 0.05, Z(s[3]))); });
    var lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    scene.add(lines);
    at(lines, 0.1, 1.2, 'lineIn');
    at(lines, 2.4, 3.4, 'lineOut');

    // 2) Slab
    var concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.95 });
    function slab(x, y, w, d) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), concrete);
      m.position.set(X(x + w / 2), 0.3, Z(y + d / 2)); m.receiveShadow = true; m.castShadow = shadows;
      scene.add(m); return m;
    }
    at(slab(-0.5, -0.5, 49, 37), 1.5, 2.4, 'rise');
    at(slab(48, -0.5, 22.5, 25), 1.7, 2.6, 'rise');
    at(slab(14, 36, 20, 6), 1.9, 2.8, 'rise');

    // 3) Studs (instanced), staggered along each wall
    var wood = new THREE.MeshStandardMaterial({ color: 0xd9a86b, roughness: 0.8 });
    var studList = [];
    WALLS.concat(INNER).forEach(function (s, wi) {
      var L = len(s), n = Math.floor(L / STUD) + 1;
      for (var k = 0; k < n; k++) {
        var f = n === 1 ? 0 : k / (n - 1);
        studList.push({ x: s[0] + (s[2] - s[0]) * f, y: s[1] + (s[3] - s[1]) * f, order: wi * 0.05 + f * 0.6, along: s[0] === s[2] ? 'z' : 'x' });
      }
    });
    var studGeo = new THREE.BoxGeometry(0.15, WALL_H, 0.45); studGeo.translate(0, WALL_H / 2, 0);
    var studMesh = new THREE.InstancedMesh(studGeo, wood, studList.length);
    studMesh.castShadow = shadows;
    var dummy = new THREE.Object3D();
    scene.add(studMesh);
    function placeStuds(t) {
      for (var k = 0; k < studList.length; k++) {
        var st = studList[k];
        var p = ease((t - 2.6 - st.order * 1.6) / 0.45);
        dummy.position.set(X(st.x), 0.6, Z(st.y));
        dummy.rotation.y = st.along === 'z' ? Math.PI / 2 : 0;
        dummy.scale.set(1, Math.max(0.0001, p), 1);
        dummy.updateMatrix(); studMesh.setMatrixAt(k, dummy.matrix);
      }
      studMesh.instanceMatrix.needsUpdate = true;
    }
    // top plates
    var plateWood = wood.clone();
    var plates = new THREE.Group(); scene.add(plates);
    WALLS.forEach(function (s) {
      var L = len(s);
      var m = new THREE.Mesh(new THREE.BoxGeometry(s[0] === s[2] ? 0.5 : L + 0.5, 0.3, s[0] === s[2] ? L + 0.5 : 0.5), plateWood);
      m.position.set(X((s[0] + s[2]) / 2), 0.6 + WALL_H, Z((s[1] + s[3]) / 2)); m.castShadow = shadows; plates.add(m);
    });
    at(plates, 4.1, 4.6, 'fade');

    // 4) Walls (board-and-batten white) with glass
    var siding = new THREE.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.85, transparent: true, opacity: 0 });
    var glass = new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.15, metalness: 0.3, emissive: 0xffb45a, emissiveIntensity: 0, transparent: true, opacity: 0 });
    var frame = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.6, transparent: true, opacity: 0 });
    var walls = new THREE.Group(); scene.add(walls);
    WALLS.forEach(function (s) {
      var L = len(s), vert = s[0] === s[2];
      var m = new THREE.Mesh(new THREE.BoxGeometry(vert ? 0.55 : L + 0.55, WALL_H, vert ? L + 0.55 : 0.55), siding);
      m.position.set(X((s[0] + s[2]) / 2), 0.6 + WALL_H / 2, Z((s[1] + s[3]) / 2)); m.castShadow = shadows; m.receiveShadow = true; walls.add(m);
    });
    WINS.concat(DOORS).forEach(function (s, i) {
      var isDoor = i >= WINS.length, L = len(s), vert = s[0] === s[2];
      var sill = isDoor ? 0.6 : 3.2, head = isDoor ? (s[2] - s[0] > 8 ? 8.4 : 7.6) : 7.6, h = head - sill;
      var out = s[1] === 0 ? -1 : (s[0] === 0 ? -1 : 1);
      var gm = new THREE.Mesh(new THREE.BoxGeometry(vert ? 0.12 : L, h, vert ? L : 0.12), isDoor && L > 8 ? frame : glass);
      gm.position.set(X((s[0] + s[2]) / 2) + (vert ? out * 0.3 : 0), 0.6 + sill + h / 2, Z((s[1] + s[3]) / 2) + (vert ? 0 : out * 0.3));
      walls.add(gm);
      if (!isDoor) {
        var fm = new THREE.Mesh(new THREE.BoxGeometry(vert ? 0.2 : L + 0.4, 0.25, vert ? L + 0.4 : 0.2), frame);
        fm.position.copy(gm.position); fm.position.y = 0.6 + sill - 0.1; walls.add(fm);
        var fh = fm.clone(); fh.position.y = 0.6 + head + 0.1; walls.add(fh);
      }
    });
    at(walls, 4.7, 5.9, 'walls');

    // 5) Trusses and roof: main gable (ridge along x), garage gable (ridge along z)
    var metal = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0 });
    function gable(x0, y0, w, d, ridgeAlongX, eave) {
      var span = ridgeAlongX ? d : w, run = span / 2 + eave, rise = (span / 2) * 0.5;
      var len2 = ridgeAlongX ? w + 2 * eave : d + 2 * eave;
      var slope = Math.hypot(run, rise + eave * 0.5);
      var grp = new THREE.Group();
      [-1, 1].forEach(function (side) {
        var plane = new THREE.Mesh(new THREE.BoxGeometry(ridgeAlongX ? len2 : slope, 0.25, ridgeAlongX ? slope : len2), metal);
        var ang = Math.atan2(rise, span / 2);
        if (ridgeAlongX) { plane.rotation.x = side * ang; plane.position.set(X(x0 + w / 2), 0.6 + WALL_H + rise / 2 - eave * 0.25, Z(y0 + d / 2) + side * run / 2); }
        else { plane.rotation.z = -side * ang; plane.position.set(X(x0 + w / 2) + side * run / 2, 0.6 + WALL_H + rise / 2 - eave * 0.25, Z(y0 + d / 2)); }
        plane.castShadow = shadows; grp.add(plane);
      });
      // gable-end walls
      var tri = new THREE.Shape(); tri.moveTo(-span / 2, 0); tri.lineTo(span / 2, 0); tri.lineTo(0, rise); tri.lineTo(-span / 2, 0);
      var tg = new THREE.ShapeGeometry(tri);
      [0, 1].forEach(function (e) {
        var t = new THREE.Mesh(tg, siding);
        if (ridgeAlongX) { t.rotation.y = Math.PI / 2; t.position.set(X(x0 + e * w) + (e ? 0.28 : -0.28), 0.6 + WALL_H, Z(y0 + d / 2)); }
        else { t.position.set(X(x0 + w / 2), 0.6 + WALL_H, Z(y0 + e * d) + (e ? 0.28 : -0.28)); }
        grp.add(t);
      });
      // trusses
      var trusses = new THREE.Group();
      var n = Math.floor((ridgeAlongX ? w : d) / 2);
      for (var k = 0; k <= n; k++) {
        var f = k / n;
        var tr = new THREE.Group();
        var chord = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, span), wood); tr.add(chord);
        [-1, 1].forEach(function (side) {
          var r = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, Math.hypot(span / 2, rise)), wood);
          r.rotation.x = side * Math.atan2(rise, span / 2); r.position.set(0, rise / 2, side * span / 4); tr.add(r);
        });
        var kp = new THREE.Mesh(new THREE.BoxGeometry(0.2, rise, 0.3), wood); kp.position.y = rise / 2; tr.add(kp);
        if (ridgeAlongX) tr.position.set(X(x0 + f * w), 0.6 + WALL_H, Z(y0 + d / 2));
        else { tr.rotation.y = Math.PI / 2; tr.position.set(X(x0 + w / 2), 0.6 + WALL_H, Z(y0 + f * d)); }
        tr.userData.f = f;
        trusses.add(tr);
      }
      scene.add(trusses); scene.add(grp);
      return { roof: grp, trusses: trusses };
    }
    var main = gable(0, 0, 48, 36, true, 1.2), gar = gable(48, 0, 22, 24, false, 1.2);
    [main, gar].forEach(function (r, i) {
      at(r.trusses, 5.6 + i * 0.3, 6.6 + i * 0.3, 'trusses');
      at(r.roof, 6.5 + i * 0.25, 7.4 + i * 0.25, 'roof');
    });

    // 6) Porch: cedar posts and a shed roof
    var cedar = new THREE.MeshStandardMaterial({ color: 0xb87a45, roughness: 0.7, transparent: true, opacity: 0 });
    var porch = new THREE.Group(); scene.add(porch);
    [14.5, 21, 27, 33.5].forEach(function (x) { var p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.6, 0.6), cedar); p.position.set(X(x), 0.6 + 4.3, Z(41.5)); p.castShadow = shadows; porch.add(p); });
    var pr = new THREE.Mesh(new THREE.BoxGeometry(21, 0.35, 7), cedar); pr.position.set(X(24), 9.4, Z(39)); pr.rotation.x = 0.12; pr.castShadow = shadows; porch.add(pr);
    at(porch, 7.4, 8.2, 'fade');
    var glow = at(glass, 7.8, 8.8, 'glow');

    // ---- Camera and loop
    var t0 = performance.now(), theta = -0.62, running = true, visible = true, last = performance.now();
    var radius = 100, height = 56;
    // Fit the whole house: narrower or squarer panels need the camera further back.
    function fit() { var a = (canvasBox.clientWidth || W) / (canvasBox.clientHeight || H); var f = Math.max(1, 1.55 / a); radius = 104 * f; height = 58 * f; }
    fit();
    function setCam(dt) {
      theta += dt * 0.00006;
      cam.position.set(Math.sin(theta) * radius, height, Math.cos(theta) * radius);
      cam.lookAt(0, 4.5, 0);
    }
    function apply(t) {
      anims.forEach(function (a) {
        var p = ease((t - a.t0) / (a.t1 - a.t0));
        var o = a.obj;
        if (a.kind === 'lineIn') o.material.opacity = 0.95 * p;
        else if (a.kind === 'lineOut') { if (t >= a.t0) o.material.opacity = 0.95 * (1 - p) + 0.12 * p; }
        else if (a.kind === 'rise') { o.scale.y = Math.max(0.0001, p); o.position.y = 0.3 * p; o.visible = p > 0; }
        else if (a.kind === 'fade') { o.visible = p > 0; o.traverse(function (c) { if (c.material) { c.material.transparent = true; c.material.opacity = p; } }); }
        else if (a.kind === 'walls') { siding.opacity = p; frame.opacity = p; glass.opacity = 0.92 * p; o.visible = p > 0; siding.transparent = p < 1; siding.depthWrite = p > 0.5; }
        else if (a.kind === 'trusses') { o.children.forEach(function (tr) { var q = ease((t - a.t0 - tr.userData.f * 0.7) / 0.35); tr.scale.y = Math.max(0.0001, q); tr.visible = q > 0; }); }
        else if (a.kind === 'roof') { o.visible = p > 0; metal.opacity = Math.max(metal.opacity, p); o.position.y = (1 - p) * 6; }
        else if (a.kind === 'glow') { glass.emissiveIntensity = 0.55 * p; }
      });
      placeStuds(t);
      // studs stay visible inside once walls are up only through windows; hide them when the roof is on to save draw cost
      studMesh.visible = t < 7.6;
      var si = 0; for (var k = 0; k < STEPS.length; k++) if (t >= STEPS[k].t) si = k;
      setStep(si);
    }
    function frameLoop(now) {
      if (!running) return;
      var dt = Math.min(64, now - last); last = now;
      var t = reduce ? END : (now - t0) / 1000;
      if (!reduce) setCam(dt); else setCam(0);
      apply(Math.min(t, END));
      renderer.render(scene, cam);
      if (reduce) { running = false; return; }
      requestAnimationFrame(frameLoop);
    }
    function play() { if (!running && visible && !reduce) { running = true; last = performance.now(); requestAnimationFrame(frameLoop); } }
    function pause() { running = false; }
    setCam(0);
    requestAnimationFrame(frameLoop);
    stage.classList.add('bs-live');

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) { var paused = (performance.now() - last); t0 += Math.max(0, paused - 64); play(); } else pause(); }).observe(stage);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else if (visible) { t0 += performance.now() - last; play(); } });
    if (replay) replay.addEventListener('click', function () { t0 = performance.now(); if (reduce) { reduce = false; } play(); });
    window.addEventListener('resize', function () {
      var w = canvasBox.clientWidth, h = canvasBox.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); fit(); setCam(0); if (!running) renderer.render(scene, cam);
    });
  }

  setStep(0);
  if (document.readyState === 'complete') setTimeout(start, 150);
  else window.addEventListener('load', function () { setTimeout(start, 150); });
})();
