// Truecolors partner displays: 3D models of the Sunbox, Prism and Tower, built from the build-spec dimensions
// (TC-DSP-001). Drag to turn; the orange button (or "Press for sun") switches on the UV light and the demo
// shirt colours up. Loads three.js only once the viewer scrolls into view.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm';
const ROOM_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
const ROUND_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js/+esm';

const root = document.querySelector('[data-tcp-viewer]');
if (root) {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(root); }
  }, { rootMargin: '200px' });
  io.observe(root);
}

async function start(root) {
  const [THREE, { OrbitControls }, { RoomEnvironment }, { RoundedBoxGeometry }] = await Promise.all([import(THREE_URL), import(ORBIT_URL), import(ROOM_URL), import(ROUND_URL)]);
  const mm = (v) => v / 1000;
  const T = mm(18);
  const SUN_ON_MS = 9000; // the real unit runs 20 s; shorter here so people can press again
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stage = root.querySelector('.tcp-3d-stage');
  const canvas = stage.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4ce, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.6, 3.2, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 8 });
  key.shadow.radius = 6;
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, autoRotate: !reduceMotion, autoRotateSpeed: 1.1,
    minPolarAngle: Math.PI * 0.3, maxPolarAngle: Math.PI * 0.52 });
  controls.addEventListener('start', () => { controls.autoRotate = false; root.classList.add('touched'); });
  canvas.style.touchAction = 'pan-y';

  // ---------- textures ----------
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((ok) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ok(t); }, undefined, () => ok(null)));
  const loadImg = (url) => new Promise((ok) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
  const designList = Object.entries(JSON.parse(root.dataset.designs || '{}'));
  const [logoImg, ...designImgs] = await Promise.all([loadImg(root.dataset.logo), ...designList.flatMap(([, d]) => [loadImg(d.sun), loadImg(d.shade)])]);
  // Each design: its sun and shade photos (flat-lays on off-white) as images for the screen and textures for the shirts.
  const designs = Object.fromEntries(designList.map(([name, d], i) => {
    const sunImg = designImgs[i * 2], shadeImg = designImgs[i * 2 + 1];
    return [name, { sunImg, shadeImg, sun: sunImg && texFrom(sunImg), shade: shadeImg && texFrom(shadeImg), tee: d.tee || '#f6f4f0', screen: d.screen !== false }];
  }));
  const design = (name) => designs[name] || Object.values(designs)[0] || {};

  function texFrom(img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  function canvasTex(wPx, hPx, draw) {
    const c = document.createElement('canvas');
    c.width = wPx; c.height = hPx;
    draw(c.getContext('2d'), wPx, hPx);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  const GRAD = ['#c43fd3', '#e5603f', '#f29a0c', '#f2e600'];
  const gradTex = canvasTex(512, 4, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, w, 0);
    GRAD.forEach((c, i) => lg.addColorStop(i / 3, c));
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
  });
  const headerTex = (w, h) => canvasTex(1024, Math.round(1024 * h / w), (g, W, H) => {
    g.fillStyle = '#1b1a18'; g.fillRect(0, 0, W, H);
    if (!logoImg) return;
    const s = Math.min(W * 0.78 / logoImg.width, H * 0.5 / logoImg.height);
    g.drawImage(logoImg, (W - logoImg.width * s) / 2, (H - logoImg.height * s) / 2, logoImg.width * s, logoImg.height * s);
  });
  const textTex = (w, h, lines, bg = '#232220') => canvasTex(1024, Math.round(1024 * h / w), (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of lines) {
      g.font = `${l.weight || 500} ${l.size * W}px ${l.font || '"Space Grotesk", sans-serif'}`;
      g.fillStyle = l.color || '#faf9f8';
      if (l.spacing) g.letterSpacing = `${l.spacing}px`;
      g.fillText(l.text, (l.x ?? 0.5) * W, l.y * H);
    }
  });
  const qrTex = canvasTex(256, 256, (g) => {
    g.fillStyle = '#faf9f8'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#232220';
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if (rnd() > 0.52) g.fillRect(24 + x * 10, 24 + y * 10, 10, 10);
    for (const [x, y] of [[24, 24], [162, 24], [24, 162]]) {
      g.fillRect(x, y, 70, 70); g.fillStyle = '#faf9f8'; g.fillRect(x + 10, y + 10, 50, 50); g.fillStyle = '#232220'; g.fillRect(x + 20, y + 20, 30, 30);
    }
  });

  // ---------- materials ----------
  const M = {
    body: new THREE.MeshStandardMaterial({ color: 0x232220, roughness: 0.62 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x121110, roughness: 0.8 }),
    interior: new THREE.MeshStandardMaterial({ color: 0xf1eee9, roughness: 0.92, side: THREE.BackSide }),
    cubby: new THREE.MeshStandardMaterial({ color: 0x2c2b28, roughness: 0.7, side: THREE.BackSide }),
    alu: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.85, roughness: 0.32 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.3, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.03, metalness: 0, clearcoat: 1, depthWrite: false }),
    cotton: new THREE.MeshStandardMaterial({ color: 0xf6f4f0, roughness: 1 }),
    grad: new THREE.MeshBasicMaterial({ map: gradTex, toneMapped: false }),
    qr: new THREE.MeshStandardMaterial({ map: qrTex, roughness: 0.6 }),
  };
  const lit = (map, intensity = 1) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity, roughness: 0.4 });
  const flat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.75 });

  // ---------- building blocks (all sizes in metres, y up from the floor, front of a face at z = 0) ----------
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const plane = (w, h, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    return m;
  };

  // A face panel with rectangular openings; each opening gets a recess box (interior visible through it).
  function face(w, h, y0, holes) {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-w / 2, y0); s.lineTo(w / 2, y0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
    for (const o of holes) {
      const p = new THREE.Path();
      p.moveTo(o.x - o.w / 2, o.y); p.lineTo(o.x - o.w / 2, o.y + o.h); p.lineTo(o.x + o.w / 2, o.y + o.h); p.lineTo(o.x + o.w / 2, o.y); p.closePath();
      s.holes.push(p);
      if (!o.d) continue;
      const r = box(o.w - 0.001, o.h - 0.001, o.d - T, o.mat || M.interior, o.x, o.y + o.h / 2, -T - (o.d - T) / 2);
      r.castShadow = false;
      g.add(r);
    }
    const geo = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false });
    geo.translate(0, 0, -T);
    const m = new THREE.Mesh(geo, M.body);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
  }

  // Header lightbox + gradient stripe across a face.
  function header(g, w, yTop, hh) {
    g.add(plane(w, hh, lit(headerTex(w, hh), 1.15), 0, yTop - hh / 2, 0.0008));
    g.add(plane(w, mm(4), M.grad, 0, yTop - hh - mm(2), 0.0008));
  }

  // A demo window: glass, LED strips top and bottom, shirt planes (shade + sun overlay). Returns a "sun station".
  const stations = [];
  const clickables = [];
  function demoWindow(g, x, y, w, h, d, shirts) {
    g.add(plane(w, h, M.glass, x, y + h / 2, -mm(5)));
    const led = new THREE.MeshStandardMaterial({ color: 0x241a3a, emissive: 0x8a5cff, emissiveIntensity: 0.05, toneMapped: false });
    for (const ly of [y + mm(10), y + h - mm(10)]) g.add(box(w - mm(20), mm(8), mm(8), led, x, ly, -T - mm(8)));
    const sunMats = [];
    for (const s of shirts) {
      const crop = (t) => { if (!t) return null; const c = t.clone(); c.needsUpdate = true; c.repeat.set(s.rw || 1, s.rh || 1); c.offset.set(s.ox || 0, s.oy || 0); return c; };
      const dz = design(s.design);
      const shadeM = new THREE.MeshStandardMaterial({ map: crop(dz.shade), color: dz.shade ? 0xffffff : 0xdddddd, roughness: 1 });
      const sunMap = crop(dz.sun);
      const sunM = new THREE.MeshStandardMaterial({ map: sunMap, emissive: 0xffffff, emissiveMap: sunMap, emissiveIntensity: 0.55, roughness: 1, transparent: true, opacity: 0 });
      g.add(plane(s.w, s.h, shadeM, x + (s.x || 0), y + h / 2 + (s.y || 0), -d + mm(6)));
      g.add(plane(s.w, s.h, sunM, x + (s.x || 0), y + h / 2 + (s.y || 0), -d + mm(7)));
      sunMats.push(sunM);
    }
    const uv = new THREE.PointLight(0x8f63ff, 0, mm(Math.max(w, h) * 1000 * 1.6), 1.6);
    uv.position.set(x, y + h / 2, -mm(40));
    g.add(uv);
    // Violet light scaled to the window, so a small box doesn't blow out.
    const st = { sunMats, led, uv, uvMax: 0.35 * (w * h) / 0.13, level: 0, target: 0, timer: 0, buttons: [] };
    stations.push(st);
    return st;
  }

  // Orange illuminated button with a bezel; clicking it lights its station.
  function button(g, st, x, y) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(mm(19), mm(3.5), 16, 48), M.alu);
    ring.position.set(x, y, mm(2));
    g.add(ring);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(mm(15), mm(15), mm(10), 40),
      new THREE.MeshStandardMaterial({ color: 0xf29a0c, emissive: 0xff8a00, emissiveIntensity: 0.5, roughness: 0.35 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, y, mm(5));
    cap.userData.station = st;
    st.buttons.push(cap);
    clickables.push(cap);
    g.add(cap);
  }

  // Open-fronted carcass: back, sides, top, bottom.
  function shell(w, h, d, sides = true, back = true) {
    const g = new THREE.Group();
    if (sides) {
      g.add(box(T, h, d, M.body, -w / 2 + T / 2, h / 2, -d / 2));
      g.add(box(T, h, d, M.body, w / 2 - T / 2, h / 2, -d / 2));
    }
    g.add(box(w, T, d, M.body, 0, h - T / 2, -d / 2));
    g.add(box(w, T, d, M.body, 0, T / 2, -d / 2));
    if (back) g.add(box(w, h, T, M.body, 0, h / 2, -d + T / 2));
    return g;
  }

  // ---------- the three displays ----------
  function sunbox() {
    const W = mm(420), H = mm(600), D = mm(300);
    const g = new THREE.Group();
    const front = new THREE.Group();
    front.position.z = D / 2;
    const win = { x: 0, y: mm(140), w: mm(360), h: mm(360), d: mm(200) };
    front.add(face(W, H, 0, [win]));
    header(front, W, H, mm(84));
    const st = demoWindow(front, win.x, win.y, win.w, win.h, win.d, [{ design: 'target', w: mm(330), h: mm(330), rw: 0.78, rh: 0.78, ox: 0.11, oy: 0.12 }]);
    button(front, st, -mm(110), mm(62));
    front.add(plane(mm(110), mm(36), lit(textTex(110, 36, [{ text: 'PRESS FOR SUN', y: 0.5, size: 0.11, font: '"JetBrains Mono", monospace', color: '#d8d4cd' }]), 0.8), -mm(30), mm(62), 0.0008));
    front.add(plane(mm(70), mm(70), M.qr, mm(125), mm(65), 0.0008));
    g.add(front);
    const sh = shell(W, H, D - T);
    sh.position.z = D / 2 - T;
    g.add(sh);
    // 40 mm plinth, 20 mm proud all round, as in the concept render.
    const base = mm(40);
    g.children.forEach((c) => { c.position.y += base; });
    g.add(box(W + mm(40), base, D + mm(40), M.plinth, 0, base / 2, 0));
    return { g, h: H + base, w: Math.max(W, D) + mm(40) };
  }

  let screenTex = null;
  function prism() {
    const A = mm(600), H = mm(1850), r = A / (2 * Math.sqrt(3)), R = 2 * r, base = mm(100);
    const g = new THREE.Group();
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 540; screenCanvas.height = 960;
    // The screen plays the screen-loop video when the page provides one, else draws its own sweep on a canvas.
    screenTex = screenVideo ? new THREE.VideoTexture(screenVideo) : new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    screenTex.userData.canvas = screenCanvas;
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Group();
      const holes = k === 0 ? [] : [{ x: 0, y: mm(800), w: mm(420), h: mm(560), d: mm(80) }];
      f.add(face(A, H, base, holes));
      header(f, A - mm(30), H, mm(200));
      if (k === 0) {
        f.add(box(mm(420), mm(725), mm(30), M.bezel, 0, mm(880 + 362.5), mm(15)));
        f.add(plane(mm(398), mm(700), lit(screenTex, 1.05), 0, mm(880 + 362.5), mm(30.5)));
        f.add(plane(mm(460), mm(130), lit(textTex(460, 130, [
          { text: 'COLOUR-CHANGING TEES', y: 0.32, size: 0.05, font: '"JetBrains Mono", monospace', color: '#cdaa3d' },
          { text: 'Sizes at the counter', y: 0.68, size: 0.085 }]), 0.85), 0, mm(640), 0.0008));
        f.add(plane(mm(150), mm(150), M.qr, 0, mm(420), 0.0008));
      } else {
        const dname = k === 1 ? 'habibi' : 'newyork';
        const st = demoWindow(f, 0, mm(800), mm(420), mm(560), mm(80), [{ design: dname, w: mm(440), h: mm(440), y: -mm(10) }]);
        // Button beside the window at its mid-height (1080 mm): natural reach, out of kicking range.
        button(f, st, mm(255), mm(1080));
        const lbl = plane(mm(200), mm(36), lit(textTex(200, 36, [{ text: 'PRESS FOR SUN', y: 0.5, size: 0.075, font: '"JetBrains Mono", monospace', color: '#d8d4cd' }]), 0.8), mm(255), mm(1080) - mm(140), 0.0008);
        lbl.rotation.z = Math.PI / 2;
        f.add(lbl);
        f.add(plane(mm(460), mm(240), lit(textTex(460, 240, [
          { text: k === 1 ? 'HABIBI' : "FUHGEDDABOUD'IT", y: 0.36, size: k === 1 ? 0.12 : 0.085, weight: 500 },
          { text: 'GREY IN THE SHADE · COLOUR IN THE SUN', y: 0.66, size: 0.036, font: '"JetBrains Mono", monospace', color: '#a49f97' }]), 0.75), 0, mm(390), 0.0008));
      }
      f.position.set(Math.sin(k * 2 * Math.PI / 3) * r, 0, Math.cos(k * 2 * Math.PI / 3) * r);
      f.rotation.y = k * 2 * Math.PI / 3;
      g.add(f);
      // Aluminium angle on each vertical corner.
      const phi = k * 2 * Math.PI / 3 + Math.PI / 3;
      const trim = box(mm(26), H - base, mm(14), M.alu, Math.sin(phi) * (R - mm(5)), base + (H - base) / 2, Math.cos(phi) * (R - mm(5)));
      trim.rotation.y = phi;
      g.add(trim);
    }
    const tri = (rad) => {
      const s = new THREE.Shape();
      [0, 1, 2].forEach((i) => { const p = i * 2 * Math.PI / 3 + Math.PI / 3; const pt = [Math.sin(p) * rad, -Math.cos(p) * rad]; i ? s.lineTo(...pt) : s.moveTo(...pt); });
      s.closePath();
      return s;
    };
    const cap = new THREE.Mesh(new THREE.ExtrudeGeometry(tri(R), { depth: T, bevelEnabled: false }), M.body);
    cap.rotation.x = -Math.PI / 2; cap.position.y = H - T; cap.castShadow = true;
    g.add(cap);
    const plinth = new THREE.Mesh(new THREE.ExtrudeGeometry(tri(R - mm(50)), { depth: base, bevelEnabled: false }), M.plinth);
    plinth.rotation.x = -Math.PI / 2; plinth.castShadow = true;
    g.add(plinth);
    const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(tri(R), { depth: T, bevelEnabled: false }), M.body);
    deck.rotation.x = -Math.PI / 2; deck.position.y = base;
    g.add(deck);
    return { g, h: H, w: 2 * R };
  }

  // Tower: stock by size on the front (one design per row), and a 10-design gallery behind UV glass on each side.
  const CATALOGUE = ['habibi', 'newyork', 'target', 'beach', 'dune', 'emirati'];
  function tower() {
    const W = mm(1016), H = mm(1829), D = mm(559), SIDE = 70, cw = (1016 - 2 * SIDE - 54) / 4;
    const g = new THREE.Group();
    const cubbies = [];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 7; r++) {
      cubbies.push({ row: r, x: mm(-508 + SIDE + c * (cw + 18) + cw / 2), y: mm(118 + r * 216), w: mm(cw), h: mm(198) });
    }
    // Front and back are the same stock face: header, S–XL rail and 28 openings into through-cubbies.
    let frontFace;
    [1, -1].forEach((dir) => {
      const f = new THREE.Group();
      f.position.z = dir * D / 2;
      f.rotation.y = dir > 0 ? 0 : Math.PI;
      f.add(face(W, H, 0, cubbies));
      header(f, W, H, mm(129));
      f.add(plane(W, mm(100), M.plinth, 0, mm(50), 0.0008));
      f.add(plane(mm(1016 - 2 * SIDE), mm(40), lit(textTex(1016 - 2 * SIDE, 40, ['S', 'M', 'L', 'XL'].map((t, i) => (
        { text: t, x: (i * (cw + 18) + cw / 2) / (1016 - 2 * SIDE), y: 0.5, size: 0.017, font: '"JetBrains Mono", monospace', color: '#d8d4cd' })), '#1b1a18'), 0.8), 0, mm(1650), 0.0008));
      g.add(f);
      if (dir > 0) frontFace = f;
    });
    // Through-cubbies: open both ends, with a low lip in the middle so each side keeps its own stack.
    const tubeD = D - 2 * T;
    const tube = new THREE.MeshStandardMaterial({ color: 0x2c2b28, roughness: 0.7, side: THREE.DoubleSide });
    for (const o of cubbies) {
      const y0 = o.y, y1 = o.y + o.h, cx = o.x;
      const floor = plane(o.w, tubeD, tube, cx, y0 + 0.0005, 0); floor.rotation.x = -Math.PI / 2; g.add(floor);
      const roof = plane(o.w, tubeD, tube, cx, y1 - 0.0005, 0); roof.rotation.x = Math.PI / 2; g.add(roof);
      for (const sx of [-1, 1]) { const wall = plane(tubeD, o.h, tube, cx + sx * (o.w / 2 - 0.0005), y0 + o.h / 2, 0); wall.rotation.y = -sx * Math.PI / 2; g.add(wall); }
      g.add(box(o.w, mm(22), mm(12), M.body, cx, y0 + mm(11), 0));
    }
    // Folded stock on both sides: soft, slightly uneven stacks with the grey print on each front fold.
    const rowDesign = [...CATALOGUE, CATALOGUE[0]].reverse();
    const foldMats = {};
    const foldMat = (name) => foldMats[name] ??= (() => {
      const t = design(name).shade;
      if (!t) return M.cotton;
      const c = t.clone(); c.needsUpdate = true; c.repeat.set(0.62, 0.22); c.offset.set(0.19, 0.42);
      return flat(c);
    })();
    const cottons = {};
    const cottonOf = (name) => cottons[name] ??= new THREE.MeshStandardMaterial({ color: design(name).tee, roughness: 1 });
    let seed = 3;
    const jitter = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5);
    for (const o of cubbies) {
      const name = rowDesign[o.row];
      for (const dir of [1, -1]) {
        for (let i = 0; i < 5; i++) {
          const y = o.y + mm(13 + i * 25), dx = mm(jitter() * 8), z = dir * (tubeD / 2 - mm(135) + mm(jitter() * 10));
          const fold = new THREE.Mesh(new RoundedBoxGeometry(o.w - mm(30), mm(23), mm(240), 3, mm(9)), cottonOf(name));
          fold.position.set(o.x + dx, y, z);
          fold.rotation.y = jitter() * 0.04;
          fold.castShadow = fold.receiveShadow = true;
          g.add(fold);
          const label = plane(o.w - mm(50), mm(15), foldMat(name), o.x + dx, y, z + dir * (mm(120) + mm(0.6)));
          label.rotation.y = dir > 0 ? 0 : Math.PI;
          g.add(label);
        }
      }
    }
    // Side galleries: ten face-out tees behind UV glass on each side (the render's own gallery), lit by their button.
    const gal = { x: 0, y: mm(520), w: mm(470), h: mm(1140), d: mm(60) };
    [-1, 1].forEach((sideSign) => {
      const side = new THREE.Group();
      side.position.x = sideSign * W / 2;
      side.rotation.y = sideSign * Math.PI / 2;
      side.add(face(D, H, 0, [gal]));
      header(side, D, H, mm(129));
      side.add(plane(D, mm(100), M.plinth, 0, mm(50), 0.0008));
      const st = demoWindow(side, gal.x, gal.y, gal.w, gal.h, gal.d, [{ design: 'gallery', w: gal.w, h: gal.h }]);
      // Its button: on the front corner post next to this gallery, at 1050 mm (natural reach, not kick height).
      const bx = sideSign * mm(508 - 35);
      button(frontFace, st, bx, mm(1050));
      const lbl = plane(mm(200), mm(36), lit(textTex(200, 36, [{ text: 'PRESS FOR SUN', y: 0.5, size: 0.075, font: '"JetBrains Mono", monospace', color: '#d8d4cd' }]), 0.8), bx, mm(1050) - mm(140), 0.0008);
      lbl.rotation.z = Math.PI / 2;
      frontFace.add(lbl);
      g.add(side);
    });
    const sh = shell(W, H, D - 2 * T, false, false);
    sh.position.z = D / 2 - T;
    g.add(sh);
    return { g, h: H, w: Math.max(W, D) };
  }

  const builders = { sunbox, prism, tower };
  const screenVideo = root.dataset.screen ? Object.assign(document.createElement('video'), {
    src: root.dataset.screen, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous' }) : null;
  screenVideo?.play().catch(() => {});
  let current = null;

  function show(name) {
    if (current) scene.remove(current.g);
    stations.length = 0; clickables.length = 0; screenTex = null;
    current = builders[name]();
    scene.add(current.g);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(current.h / 2 / tan, current.w / 2 / (tan * camera.aspect)) * 1.22 + current.w / 2;
    // The Prism opens on the corner between its screen face and a demo face; the boxes at a three-quarter view.
    const angle = name === 'prism' ? Math.PI / 3 : Math.PI / 5;
    controls.target.set(0, current.h * 0.5, 0);
    camera.position.set(Math.sin(angle) * dist, current.h * 0.62, Math.cos(angle) * dist);
    controls.update();
    root.querySelectorAll('[data-model]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.model === name)));
  }

  // ---------- sun ----------
  function press(st) {
    st.target = 1;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { st.target = 0; }, SUN_ON_MS);
    st.buttons.forEach((b) => { b.position.z = mm(2); setTimeout(() => { b.position.z = mm(5); }, 160); });
  }
  root.querySelector('[data-sun]')?.addEventListener('click', () => stations.forEach(press));
  root.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => show(b.dataset.model)));

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  const pick = (e) => {
    const rect = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(clickables, false)[0];
  };
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) {
      const hit = pick(e);
      if (hit) press(hit.object.userData.station);
    }
    downAt = null;
  });
  canvas.addEventListener('pointermove', (e) => { if (!downAt) canvas.style.cursor = pick(e) ? 'pointer' : 'grab'; });

  // ---------- the Prism's screen loop: shade-to-sun sweep across the shirt ----------
  function drawScreen(t) {
    const c = screenTex.userData.canvas, g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.fillStyle = '#121118'; g.fillRect(0, 0, W, H);
    const phase = (t / 5200) % 1;
    const all = Object.values(designs).filter((d) => d.screen), dz = all[Math.floor(t / 5200) % Math.max(all.length, 1)] || {};
    const shadeImg = dz.shadeImg, sunImg = dz.sunImg;
    const sweep = phase < 0.45 ? phase / 0.45 : phase < 0.75 ? 1 : 1 - (phase - 0.75) / 0.25;
    const size = W * 0.96, x = (W - size) / 2, y = H * 0.2;
    if (shadeImg) g.drawImage(shadeImg, x, y, size, size);
    if (sunImg) {
      g.save(); g.beginPath(); g.rect(x, y, size * sweep, size); g.clip(); g.drawImage(sunImg, x, y, size, size); g.restore();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + size * sweep - 1, y, 2, size);
    }
    g.textAlign = 'center';
    g.fillStyle = '#faf9f8'; g.font = '500 40px "Space Grotesk", sans-serif';
    g.fillText('Shade.', W / 2 - 80, H * 0.11);
    g.fillStyle = '#f29a0c'; g.fillText('Sun.', W / 2 + 80, H * 0.11);
    g.fillStyle = '#cdaa3d'; g.font = '22px "JetBrains Mono", monospace';
    g.fillText(phase < 0.5 ? 'TRY IT ON THE NEXT SIDE →' : 'SIZES AT THE COUNTER', W / 2, H * 0.92);
    screenTex.needsUpdate = true;
  }

  // ---------- loop ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  let visible = true, last = performance.now();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(stage);
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const st of stations) {
      st.level += Math.sign(st.target - st.level) * Math.min(Math.abs(st.target - st.level), dt / (st.target ? 1.4 : 2.2));
      st.sunMats.forEach((m) => { m.opacity = st.level; });
      st.led.emissiveIntensity = 0.05 + (st.target ? 1 : st.level) * 3.2;
      st.uv.intensity = st.level * st.uvMax;
    }
    if (screenTex && !screenVideo) drawScreen(now);
    controls.update();
    renderer.render(scene, camera);
  }
  show(root.dataset.start || 'prism');
  // Handle for the page (and for checking angles): root.viewer.turn(degrees) stops the spin and faces that way.
  root.viewer = {
    show, sun: () => stations.forEach(press),
    turn(deg) {
      controls.autoRotate = false;
      const d = camera.position.clone().sub(controls.target), flatDist = Math.hypot(d.x, d.z), a = deg * Math.PI / 180;
      camera.position.set(controls.target.x + Math.sin(a) * flatDist, camera.position.y, controls.target.z + Math.cos(a) * flatDist);
      controls.update();
    },
  };
  root.classList.add('ready');
  requestAnimationFrame(frame);
}
