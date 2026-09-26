// Close-up geometry around the ship's aft-flap camera: a stretch of the 9 m
// stainless hull, the aft flap (trapezoidal planform, leeward stainless face
// with lap seams, rivet rows, doubler straps and oil-canned skins), leading-
// edge rim brackets, trailing-edge tie-down pins, the tiled aft hinge cowl and
// the blanket-wrapped forward hinge.
// Ship frame: +x aft along the ship axis, the flap lies in the x-y plane
// (y = radially outward at the flap root), the hull axis is at (y=-R, z=0).

export const SHIP_R = 4.5;
// flap planform (m): root chord from x=0 (LE) to x=CR (TE), span S
export const FLAP = { CR: 9.08, LEX: 5.50, TEX: 8.21, S: 2.39, TH: 0.22 };

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 2D value noise (deterministic)
function makeNoise(seed) {
  const rng = mulberry(seed); const P = new Float32Array(256 * 256); for (let i = 0; i < P.length; i++) P[i] = rng();
  const at = (i, j) => P[((j & 255) << 8) | (i & 255)];
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y); const fx = x - i, fy = y - j; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v; };
}

// Flap skin maps. Canvas spans x in [X0, X0+WM], y in [Y0, Y0+HM] metres.
const X0 = -0.3, WM = 9.8, Y0 = -0.7, HM = 3.3;
function flapMaps(THREE) {
  const W = 4096, H = Math.round(W * HM / WM);
  const ppm = W / WM;
  const rng = mulberry(77);
  const px = (x) => (x - X0) * ppm, py = (y) => (Y0 + HM - y) * ppm;   // canvas y down
  // --- seams & rivets drawn into a canvas height layer ---
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, W, H);
  const { CR, LEX, TEX, S } = FLAP;
  const seams = [];
  // spanwise lap joints between skin panels, slightly skewed like the real skins
  const xs = [0.95, 1.95, 2.9, 3.9, 4.95, 6.0, 7.05, 8.1];
  for (const x of xs) seams.push([[x, -0.2], [x + 0.28 + (rng() - .5) * .1, S + 0.2]]);
  // chordwise joints: root doubler and a mid-span joint on the aft bays
  seams.push([[-0.2, 0.42], [CR + 0.2, 0.36]]);
  seams.push([[-0.2, 0.05], [CR + 0.2, 0.02]]);
  seams.push([[4.0, 1.55], [CR + 0.2, 1.62]]);
  // diagonal doubler straps (internal rib attachment lines)
  seams.push([[2.0, 0.42], [3.5, 2.39]]);
  seams.push([[4.1, 0.42], [2.9, 1.7]]);
  seams.push([[7.3, 2.39], [5.2, 0.42]]);
  const segs = [];
  for (const s of seams) segs.push(s);
  // edge rims
  segs.push([[0, 0], [LEX, S]]); segs.push([[LEX, S], [TEX, S]]); segs.push([[TEX, S], [CR, 0]]);
  g.lineCap = 'round';
  for (const [a, b] of seams) {
    // lap joint: a step (one side raised) + dark gap line
    g.strokeStyle = 'rgb(112,112,112)'; g.lineWidth = 0.018 * ppm;
    g.beginPath(); g.moveTo(px(a[0]), py(a[1])); g.lineTo(px(b[0]), py(b[1])); g.stroke();
    g.strokeStyle = 'rgb(138,138,138)'; g.lineWidth = 0.05 * ppm;
    const nx = -(b[1] - a[1]), ny = (b[0] - a[0]); const nl = Math.hypot(nx, ny);
    const ox = nx / nl * 0.03, oy = ny / nl * 0.03;
    g.globalAlpha = .5; g.beginPath(); g.moveTo(px(a[0] + ox), py(a[1] + oy)); g.lineTo(px(b[0] + ox), py(b[1] + oy)); g.stroke(); g.globalAlpha = 1;
  }
  // rivets along seams (two staggered rows) and a dense field near the root
  const rivets = [];
  for (const [a, b] of seams) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.floor(L / 0.075);
    const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
    for (let i = 0; i <= n; i++) for (const side of [-1, 1]) {
      const t = (i + (side > 0 ? .5 : 0)) * 0.075;
      rivets.push([a[0] + tx * t - ty * side * 0.035, a[1] + ty * t + tx * side * 0.035]);
    }
  }
  for (let y = -0.35; y < 0.4; y += 0.11) for (let x = 0; x < CR; x += 0.12) rivets.push([x + (rng() - .5) * .02 + (y * 3 % .12), y]);
  const rr = 0.0085 * ppm;
  for (const [x, y] of rivets) {
    const gr = g.createRadialGradient(px(x), py(y), 0, px(x), py(y), rr * 1.6);
    gr.addColorStop(0, 'rgba(200,200,200,1)'); gr.addColorStop(.6, 'rgba(160,160,160,.8)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(px(x), py(y), rr * 1.6, 0, Math.PI * 2); g.fill();
  }
  // a few larger fasteners / inspection plugs
  for (const [x, y] of [[4.35, 0.7], [7.2, 0.25], [2.6, 0.3]]) {
    g.fillStyle = 'rgb(190,190,190)'; g.beginPath(); g.arc(px(x), py(y), 0.03 * ppm, 0, Math.PI * 2); g.fill();
  }
  const seamImg = g.getImageData(0, 0, W, H).data;
  // --- height = seams + oil-canning (pillowed skins) + chordwise rolling marks ---
  const n1 = makeNoise(5), n2 = makeNoise(9), n3 = makeNoise(21);
  const hgt = new Float32Array(W * H);
  const panelOf = (x) => { let k = 0; for (const s of xs) if (x > s) k++; return k; };
  for (let j = 0; j < H; j++) {
    const y = Y0 + HM - (j + .5) / ppm;
    for (let i = 0; i < W; i++) {
      const x = X0 + (i + .5) / ppm;
      const p = panelOf(x - 0.12 * y);
      // skins bow between frames: low-frequency pillows, longer chordwise
      let h = (n1(x * 1.3 + p * 7.1, y * 2.6) - .5) * 1.0 + (n2(x * 3.1, y * 5.5 + p * 3.3) - .5) * .45;
      // chordwise rolling / handling streaks (strongly anisotropic)
      h += (n3(x * 1.1, y * 38) - .5) * .20 + (n2(x * .6 + 40, y * 90) - .5) * .08;
      hgt[j * W + i] = h * 0.0035 + (seamImg[(j * W + i) * 4] - 128) / 128 * 0.0022;
    }
  }
  // normals (tangent space, +z out of the face); x->u, y->v
  const nrm = new Uint8Array(W * H * 4), col = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  const d = 1 / ppm;
  const n4 = makeNoise(33), n5 = makeNoise(44);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const hx = (hgt[j * W + Math.min(i + 1, W - 1)] - hgt[j * W + Math.max(i - 1, 0)]) / (2 * d);
    const hy = -(hgt[Math.min(j + 1, H - 1) * W + i] - hgt[Math.max(j - 1, 0) * W + i]) / (2 * d);
    let nx = -hx, ny = -hy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nrm[k * 4] = (nx * .5 + .5) * 255; nrm[k * 4 + 1] = (-ny * .5 + .5) * 255; /* v runs toward -y */ nrm[k * 4 + 2] = (nz * .5 + .5) * 255; nrm[k * 4 + 3] = 255;
    const x = X0 + (i + .5) / ppm, y = Y0 + HM - (j + .5) / ppm;
    const sm = seamImg[k * 4] < 118 ? 1 : 0;
    // stainless: neutral with faint straw heat tint; smudges / handling marks
    const sm2 = n4(x * 2.2, y * 3.1), tint = n5(x * .35, y * .6);
    const base = .56 + (sm2 - .5) * .12 - sm * .25;
    col[k * 4] = Math.min(255, (base + .03 * tint) * 255); col[k * 4 + 1] = Math.min(255, (base + .012 * tint) * 255); col[k * 4 + 2] = Math.min(255, (base - .015 * tint) * 255); col[k * 4 + 3] = 255;
    const rough = .30 + (n3(x * 1.1, y * 38) - .5) * .12 + (sm2 - .5) * .14 + sm * .25;
    orm[k * 4] = 255; orm[k * 4 + 1] = Math.max(0, Math.min(1, rough)) * 255; orm[k * 4 + 2] = 255; orm[k * 4 + 3] = 255;
  }
  const mk = (arr, srgb) => { const t = new THREE.DataTexture(arr, W, H); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
    // shape uv (metres) -> [0,1]; DataTexture row 0 is the canvas top (y = Y0+HM)
    t.repeat.set(1 / WM, -1 / HM); t.offset.set(-X0 / WM, (Y0 + HM) / HM); return t; };
  return { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(orm, false) };
}

// black hexagonal tiles (TPS) for the hinge cowl
function tileMaps(THREE) {
  const W = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = W; const g = cv.getContext('2d');
  g.fillStyle = '#1c1b1d'; g.fillRect(0, 0, W, W);
  const r = 32, rng = mulberry(3);
  for (let row = -1; row < W / (r * 1.5) + 1; row++) for (let c = -1; c < W / (r * 1.732) + 1; c++) {
    const cx = c * r * 1.732 + (row & 1) * r * .866, cy = row * r * 1.5;
    const v = 24 + rng() * 16; g.fillStyle = `rgb(${v},${v - 1},${v + 2})`;
    g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * (r - 1.5), cy + Math.sin(a) * (r - 1.5)); } g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function blanketMaps(THREE) {
  const W = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = W; const g = cv.getContext('2d');
  const n = makeNoise(12); const im = g.createImageData(W, W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const v = n(i / 9, j / 3) * .6 + n(i / 3, j / 23) * .4; const k = (j * W + i) * 4;
    im.data[k] = 190 + v * 50; im.data[k + 1] = 176 + v * 46; im.data[k + 2] = 140 + v * 40; im.data[k + 3] = 255; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function makeFlapRig(THREE, { envMap }) {
  const grp = new THREE.Group();
  const { CR, LEX, TEX, S, TH } = FLAP;
  const R = SHIP_R;
  const fm = flapMaps(THREE);
  const steel = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 1, map: fm.map, normalMap: fm.normalMap, roughnessMap: fm.roughnessMap, envMap, envMapIntensity: 1 });
  steel.normalScale.set(1, 1);
  // --- flap body: extruded trapezoid, root sunk into the hull ---
  const sh = new THREE.Shape();
  sh.moveTo(-0.35, -0.7); sh.lineTo(0, 0); sh.lineTo(LEX, S); sh.lineTo(TEX, S); sh.lineTo(CR, 0); sh.lineTo(CR + 0.1, -0.7); sh.closePath();
  const fg = new THREE.ExtrudeGeometry(sh, { depth: TH, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 4 });
  fg.translate(0, 0, -TH / 2);
  const flap = new THREE.Mesh(fg, steel); grp.add(flap);
  // --- leading-edge rim with clip brackets; tip rim ---
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8c, metalness: 1, roughness: .45, envMap });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: .6, roughness: .6, envMap });
  const addEdge = (a, b, w, mat, zoff) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, w, TH + 0.12), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zoff); m.rotation.z = Math.atan2(dy, dx); grp.add(m); return m;
  };
  addEdge([0.05, 0.02], [LEX, S], 0.07, darkMat, 0);
  addEdge([LEX, S], [TEX, S], 0.06, darkMat, 0);
  addEdge([TEX, S], [CR, 0], 0.05, darkMat, 0);
  // brackets along the leading edge
  {
    const n = 11; const bg = new THREE.BoxGeometry(0.1, 0.09, 0.12);
    for (let i = 1; i < n; i++) {
      const t = i / n; const x = LEX * t, y = S * t;
      const m = new THREE.Mesh(bg, rimMat); m.position.set(x - 0.03, y + 0.02, TH / 2 + 0.02); m.rotation.z = Math.atan2(S, LEX); grp.add(m);
    }
  }
  // trailing-edge tie-down pins (short rods normal to the TE, in-plane)
  {
    const tx = CR - TEX, ty = -S, L = Math.hypot(tx, ty); const ux = tx / L, uy = ty / L; const nx = -uy, ny = ux; // outward (aft)
    const pg = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6); pg.rotateZ(Math.PI / 2);
    const cap = new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8); cap.rotateZ(Math.PI / 2);
    for (let i = 1; i <= 9; i++) {
      const t = i / 10; const x = TEX + tx * t, y = S + ty * t;
      const ang = Math.atan2(ny, nx);
      const m = new THREE.Mesh(pg, rimMat); m.position.set(x + nx * 0.16, y + ny * 0.16, 0.06); m.rotation.z = ang; grp.add(m);
      const c = new THREE.Mesh(cap, rimMat); c.position.set(x + nx * 0.32, y + ny * 0.32, 0.06); c.rotation.z = ang; grp.add(c);
    }
  }
  // --- aft hinge cowl: tiled half-shell bulging toward the camera side ---
  const tileTex = tileMaps(THREE); tileTex.repeat.set(3, 2);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileTex, roughness: .8, metalness: 0, envMap, envMapIntensity: .6 });
  {
    const cg = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 28, 1, false, 0, Math.PI);
    const m = new THREE.Mesh(cg, tileMat); m.rotation.z = Math.PI / 2; m.rotation.y = 0; // axis along x
    m.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    m.position.set(CR + 0.35, -0.05, 0.0); grp.add(m);
  }
  // --- forward hinge: blanket-wrapped fairing ---
  const blanket = new THREE.MeshStandardMaterial({ color: 0xffffff, map: blanketMaps(THREE), roughness: .95, metalness: 0, envMap, envMapIntensity: .8 });
  {
    const sg = new THREE.SphereGeometry(0.5, 20, 12); sg.scale(1.5, 0.75, 0.8);
    const m = new THREE.Mesh(sg, blanket); m.position.set(-0.35, 0.05, 0.25); grp.add(m);
  }
  // --- hull: stainless barrel segment around the flap azimuth ---
  {
    const hg = new THREE.CylinderGeometry(R, R, 30, 180, 12, true, -Math.PI * 0.5, Math.PI);
    // CylinderGeometry axis = y; rotate to x, theta measured so that the arc covers +y/+z
    hg.rotateZ(-Math.PI / 2);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9c, metalness: 1, roughness: .38, envMap });
    const m = new THREE.Mesh(hg, hullMat); m.position.set(3, -R, 0); grp.add(m);
    // beige blanket raceway strip forward of the flap on the camera side
    const strip = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.12, 0.28), blanket);
    const a = 0.08; strip.position.set(-2.2, -R + Math.cos(a) * (R + .05), Math.sin(a) * (R + .05) + 0.18); strip.rotation.x = -a; grp.add(strip);
    // tiled fairing further aft on the hull
    const tf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.9), tileMat);
    tf.position.set(11.3, 0.05, 0.9); grp.add(tf);
  }
  return grp;
}
