// Starship + Super Heavy (Block 2) stack. Dimensions from src/physics/vehicle.js
// (booster 71 m, ship 52.1 m, 9 m diameter). Stainless tanks carry a layer of
// water/air frost while loaded with subcooled LOX/CH4; the ship's windward half
// is covered in black hexagonal TUFROC-style tiles. Origin = booster engine
// plane, +y up.
import { CONFIGS, DEFAULT_CONFIG } from '../physics/vehicle.js';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Procedural surface maps: (u around, v along), RGBA = albedo, and a second
// map holding roughness (G) / metalness (B) like glTF ORM.
function makeMaps(THREE, W, H, fn) {
  const col = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const r = fn(i / W, (j + .5) / H);
    const k = (j * W + i) * 4;
    col[k] = r.c[0] * 255; col[k + 1] = r.c[1] * 255; col[k + 2] = r.c[2] * 255; col[k + 3] = 255;
    orm[k] = 255; orm[k + 1] = r.rough * 255; orm[k + 2] = r.metal * 255; orm[k + 3] = 255;
  }
  const t1 = new THREE.DataTexture(col, W, H); t1.colorSpace = THREE.SRGBColorSpace;
  const t2 = new THREE.DataTexture(orm, W, H);
  for (const t of [t1, t2]) { t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; }
  return { map: t1, orm: t2 };
}

export function makeStack(THREE, { envMap, tileCenter = 0.35 } = {}) {
  const cfg = CONFIGS[DEFAULT_CONFIG];
  const R = cfg.booster.diameter / 2, LB = cfg.booster.length, LS = cfg.ship.length;
  const rng = mulberry(1234);
  const grp = new THREE.Group();

  // --- Super Heavy: frosted steel ---
  const streak = Array.from({ length: 512 }, () => rng());
  const bmaps = makeMaps(THREE, 512, 512, (u, v) => {
    const y = v * LB;
    const s = streak[Math.floor(u * 512)] * .5 + streak[Math.floor(u * 128) * 4 % 512] * .5;
    // frost where propellant is: LOX tank ~ 4-44 m, CH4 tank ~ 46-66 m
    const frostLox = y > 3.5 && y < 45.5 ? 1 : 0, frostCh4 = y > 46.5 && y < 67 ? 1 : 0;
    let fr = Math.max(frostLox, frostCh4) * (.75 + .25 * s);
    const ring = Math.abs(((y / 1.83) % 1) - .5) < .03 ? .08 : 0;   // barrel-section welds
    const steel = [.55, .54, .52];
    const frost = [.80, .77, .74];
    const c = steel.map((a, i) => (a * (1 - fr) + frost[i] * fr) * (1 - ring));
    if (y < 3.2) c.forEach((_, i) => c[i] *= .45);                   // aft skirt / heat shield
    return { c, rough: fr > .3 ? .85 : .32, metal: fr > .3 ? .15 : 1 };
  });
  const bMat = new THREE.MeshStandardMaterial({ map: bmaps.map, roughnessMap: bmaps.orm, metalnessMap: bmaps.orm, roughness: 1, metalness: 1, envMap, envMapIntensity: .35 });
  const booster = new THREE.Mesh(new THREE.CylinderGeometry(R, R, LB, 64, 8, false), bMat);
  booster.position.y = LB / 2; grp.add(booster);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: .7, metalness: .3, envMap });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: .35, metalness: 1, envMap });
  // grid fins (4) near the top of the booster
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 4.4), steelMat);
    fin.position.set(Math.sin(a) * (R + 2.2), LB - 4.5, Math.cos(a) * (R + 2.2));
    fin.rotation.y = a; grp.add(fin);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.8, .8, 2.2), dark);
    arm.position.set(Math.sin(a) * (R + .8), LB - 4.5, Math.cos(a) * (R + .8)); arm.rotation.y = a; grp.add(arm);
  }
  // chines (aerocover strakes)
  for (const a of [Math.PI / 2 - .25, -Math.PI / 2 + .25]) {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(.6, 38, .7), steelMat);
    ch.position.set(Math.sin(a) * (R + .3), 30, Math.cos(a) * (R + .3)); ch.rotation.y = a; grp.add(ch);
  }
  // hot-staging ring (vented interstage)
  const hsr = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.9, 48), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: .6, metalness: .6, envMap }));
  hsr.position.y = LB + .95; grp.add(hsr);
  // engine section: 33 Raptor bells (mostly hidden in the plume)
  const bell = new THREE.CylinderGeometry(.55, .65, 2.2, 12, 1, true);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: .5, metalness: .8, side: THREE.DoubleSide, envMap });
  const rings = [[3, 1.1], [10, 2.7], [20, 3.9]];
  for (const [n, r] of rings) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2; const b = new THREE.Mesh(bell, bellMat);
    b.position.set(Math.cos(a) * r, -1.1, Math.sin(a) * r); grp.add(b);
  }

  // --- Starship: steel + black tiles on the windward half ---
  const y0 = LB + 1.9;
  const pts = [];
  const cyl = 33.5, N = 40;
  const prof = (t) => { // t in [0,1] along ship length -> radius
    const y = t * LS;
    if (y <= cyl) return R;
    const k = (y - cyl) / (LS - cyl);             // tangent ogive
    return Math.max(R * Math.sqrt(Math.max(0, 1 - k * k * (1 + .15 * k))), .05);
  };
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(prof(t), t * LS)); }
  const tileHalf = Math.PI * .5;
  const smaps = makeMaps(THREE, 512, 512, (u, v) => {
    const th = u * Math.PI * 2;                     // LatheGeometry: x=r sin, z=r cos
    let d = Math.abs(((th - tileCenter) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const y = v * LS;
    const hex = (Math.abs(Math.sin(u * 900) * Math.sin(v * 800)) > .96) ? .6 : 1; // grout lines
    if (d < tileHalf) return { c: [.20 * hex, .19 * hex, .185 * hex], rough: .6, metal: 0 };   // sRGB-encoded; ~5 % linear albedo
    const fr = y > 3 && y < 26 ? .35 : 0;          // ship tanks lightly frosted
    const c = [.56 + fr * .25, .55 + fr * .25, .53 + fr * .26];
    return { c, rough: .3 + fr * .4, metal: 1 - fr * .6 };
  });
  const sMat = new THREE.MeshStandardMaterial({ map: smaps.map, roughnessMap: smaps.orm, metalnessMap: smaps.orm, roughness: 1, metalness: 1, envMap });
  const ship = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), sMat);
  ship.position.y = y0; grp.add(ship);
  // flaps: forward pair high on the nose, aft pair at the base; on the tile/leeward boundary
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: .7, metalness: .1, envMap });
  for (const s of [-1, 1]) {
    const a = tileCenter + s * Math.PI / 2;
    const ff = new THREE.Mesh(new THREE.BoxGeometry(.4, 7, 1.8), flapMat);
    ff.position.set(Math.sin(a) * (prof(40 / LS) + .9), y0 + 40, Math.cos(a) * (prof(40 / LS) + .9)); ff.rotation.y = a; grp.add(ff);
    const af = new THREE.Mesh(new THREE.BoxGeometry(.4, 9, 2.2), flapMat);
    af.position.set(Math.sin(a) * (R + 1.2), y0 + 6.5, Math.cos(a) * (R + 1.2)); af.rotation.y = a; grp.add(af);
  }
  grp.userData.height = y0 + LS;
  return grp;
}
