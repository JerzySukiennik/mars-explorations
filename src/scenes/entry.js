// Scene: entry — Starship atmospheric entry, onboard camera.
// Shot 'reentry_flap_plasma': IFT-5 style Earth entry at T+48:21, ~79 km,
// 26,650 km/h. The side camera on the ship's lee flank looks aft along the
// hull at the aft flap; the windward shock layer wraps round the side edge
// just beyond the limb and the separated shear layer streams away aft/lee.
// Clouds of the deck below show through where the plasma is thin.
//
// Pipeline (deterministic, no wall-clock time in shot mode):
//   1. hull / flap / fittings (custom shading lit by the plasma + cloud deck)
//      -> HDR RT with depth, rendered through a wide pinhole frustum
//   2. composite: cloud deck background + ray-marched shock-layer emission
//   3. sensor: barrel-distortion lens, veiling glare, MTF, clipping, 4:2:0, noise
import { makeHull, R_SHIP } from '../entry/hull.js';
import { makeComposite } from '../entry/plasma.js';
import { makeSensor } from '../entry/sensor.js';
import { plasmaColor } from '../entry/spectrum.js';
import { EARTH, STARSHIP_ENTRY, stagnationHeatFlux } from '../physics/entry.js';

const D2R = Math.PI / 180;

// Tunables (geometry in metres, ship frame: +z aft, -y belly, +x camera side)
const DEFAULT = {
  // flight state (IFT-5, T+00:48:21 HUD)
  alt: 79e3, vKmh: 26650, bankDeg: -62, sunElev: 5, sunAz: 115,
  // camera: azimuth on the hull, stand-off, axial position; aim yaw/pitch/roll (deg)
  camPhi: 21, camH: .30, camZ: 0, yaw: -24, pitch: 9, roll: 16,
  fpx: 780, lensMix: .7, ca: .0008,
  // ship
  aftZ: 11, tileEdge: 9 * D2R, tileScale: .30, steelF0: .55,
  flapPhi: -4 * D2R, flapLen: 5.2, flapSpan: 3.8, flapThick: .34, flapSweep: 1.2, flapAftGap: .3, flapDeflect: 10 * D2R,
  fairH: .75, fairLen: 2.6, fairW: 1.0,
  // plasma
  edgePhi: -7 * D2R, sheathI: 7.5, sheathD: .22, curtI: 5.5, curtW0: .25, curtW1: .10, curtL: 9, beta: 30 * D2R, curtCurv: .012, curtZ0: 0,
  hazeI: .012, hazeL: 14,
  plLight: 1.0, earth: .05, cloudGain: 1.0, cloudScale: 1.0,
  exposure: 1.0, bloom: .12, noise: 1.6, sat: 1.0,
};

export async function create({ THREE, renderer, params }) {
  const T = { ...DEFAULT };
  try { if (params.get('tune')) Object.assign(T, JSON.parse(params.get('tune'))); } catch (e) { console.warn('bad tune', e); }
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, W / H, .05, 3000);

  // ---- flight state -> attitude, plasma colour and brightness ---------------
  const v = T.vKmh / 3.6;
  const atm = EARTH.atm(T.alt);
  const qdot = stagnationHeatFlux(atm.rho, v, R_SHIP, 'earth');     // W/m^2 (convective)
  const core = plasmaColor({ v, rho: atm.rho, gas: 'air', region: 'core' });
  const front = plasmaColor({ v, rho: atm.rho, gas: 'air', region: 'front' });
  const Isc = core.scale;                                             // 1 at the IFT-5 reference state
  const alpha = STARSHIP_ENTRY.alphaHyp;
  // velocity (ship moves nose/belly first) and lift-up direction; bank about v
  const vdir = new THREE.Vector3(0, -Math.sin(alpha), -Math.cos(alpha));
  const up0 = new THREE.Vector3(0, Math.cos(alpha), -Math.sin(alpha));
  const upv = up0.clone().applyAxisAngle(vdir, T.bankDeg * D2R);
  const nadir = upv.clone().negate();
  const horizonCos = Math.cos(Math.PI / 2 - Math.acos(EARTH.R / (EARTH.R + T.alt)));
  // sun: low twilight sun, azimuth measured from the velocity direction about local up
  const hdir = vdir.clone().addScaledVector(upv, -vdir.dot(upv)).normalize();
  const sunDir = hdir.clone().applyAxisAngle(upv, T.sunAz * D2R).multiplyScalar(Math.cos(T.sunElev * D2R)).addScaledVector(upv, Math.sin(T.sunElev * D2R)).normalize();

  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const coreC = V3(core.rgb), frontC = V3(front.rgb);
  // ---- plasma light sources that illuminate the hull ------------------------
  const R = R_SHIP;
  const pl = [], plc = [];
  const ep = T.edgePhi;
  for (let i = 0; i < 6; i++) {
    const z = -6 + i * 3.4;
    pl.push(new THREE.Vector3((R + .45) * Math.cos(ep - .10), (R + .45) * Math.sin(ep - .10), z));
    plc.push(coreC.clone().multiplyScalar(T.plLight * 2.2 * Isc));
  }
  // curtain / flap-region sources (further out, lee-ward)
  const cdir = new THREE.Vector2(Math.sin(T.beta), Math.cos(T.beta));
  for (let i = 0; i < 4; i++) {
    const t = 1.5 + i * 2.5, z = 2 + i * 3;
    pl.push(new THREE.Vector3(R * Math.cos(ep) + cdir.x * t, R * Math.sin(ep) + cdir.y * t, z));
    plc.push(coreC.clone().lerp(frontC, .4).multiplyScalar(T.plLight * 3.0 * Isc * Math.exp(-t / T.curtL)));
  }
  const curtDir = new THREE.Vector3(cdir.x * .5, cdir.y * .5, 1).normalize();

  const hullU = {
    uPlPos: { value: pl }, uPlCol: { value: plc },
    uNadir: { value: nadir }, uEarthCol: { value: new THREE.Vector3(1, .95, .92).multiplyScalar(T.earth) },
    uCurtDir: { value: curtDir }, uCurtCol: { value: coreC.clone().lerp(frontC, .5).multiplyScalar(.25 * Isc * T.plLight) },
    uFrontCol: { value: frontC }, uHorizonCos: { value: horizonCos },
    uCamPos: { value: camera.position }, uTileEdge: { value: T.tileEdge }, uTileScale: { value: T.tileScale },
    uSteelF0: { value: T.steelF0 }, uAftZ: { value: T.aftZ }, uExpo: { value: 1 },
  };
  scene.add(makeHull(THREE, hullU, T));

  // ---- camera ----------------------------------------------------------------
  const phc = T.camPhi * D2R;
  const er = new THREE.Vector3(Math.cos(phc), Math.sin(phc), 0), et = new THREE.Vector3(-Math.sin(phc), Math.cos(phc), 0), ez = new THREE.Vector3(0, 0, 1);
  camera.position.copy(er).multiplyScalar(R + T.camH).setZ(T.camZ);
  const cp = Math.cos(T.pitch * D2R);
  const look = ez.clone().multiplyScalar(cp * Math.cos(T.yaw * D2R)).addScaledVector(et, cp * Math.sin(T.yaw * D2R)).addScaledVector(er, Math.sin(T.pitch * D2R));
  camera.up.copy(er);
  camera.lookAt(camera.position.clone().add(look));
  camera.rotateZ(T.roll * D2R);
  camera.updateMatrixWorld();

  // lens: output raster = rows 110..884 of a 1920x1080 frame, principal point at its centre
  const sx = W / 1920;
  const fullH = 1080 * sx, y0 = 110 * sx;
  const ppx = W / 2, ppy = fullH / 2 - y0, f = T.fpx * sx, m = T.lensMix;
  const undist = (px, py) => {
    const dx = (px - ppx) / f, dy = -(py - ppy) / f; const rd = Math.hypot(dx, dy);
    let th = Math.atan(rd);
    for (let i = 0; i < 8; i++) { const g = (1 - m) * Math.tan(th) + m * th - rd; th -= g / ((1 - m) / Math.cos(th) ** 2 + m); }
    const s = rd > 1e-9 ? Math.tan(th) / rd : 1; return [dx * s, dy * s];
  };
  let x0 = 1e9, x1 = -1e9, yb = 1e9, yt = -1e9;
  for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H], [ppx, 0], [ppx, H], [0, ppy], [W, ppy]]) {
    const [ux, uy] = undist(px, py); x0 = Math.min(x0, ux); x1 = Math.max(x1, ux); yb = Math.min(yb, uy); yt = Math.max(yt, uy);
  }
  x0 -= .01; x1 += .01; yb -= .01; yt += .01;
  const n = camera.near;
  camera.projectionMatrix.makePerspective(x0 * n, x1 * n, yt * n, yb * n, n, camera.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateProjectionMatrix = () => {};          // keep the custom frustum on resize
  // pinhole render resolution: ~1 px per output px at the centre, capped
  let rw = Math.round((x1 - x0) * f * 1.0), rh = Math.round((yt - yb) * f * 1.0);
  const cap = 3400 / Math.max(rw, rh); if (cap < 1) { rw = Math.round(rw * cap); rh = Math.round(rh * cap); }

  const rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(rw, rh, THREE.UnsignedIntType);
  // MSAA RT + depth texture need a resolve target in three: use a plain one
  const rt2 = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType });
  rt2.depthTexture = new THREE.DepthTexture(rw, rh, THREE.UnsignedIntType);
  const hdr = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });

  const sunCol = new THREE.Vector3(1.0, .80, .62).multiplyScalar(.075);
  const cu = {
    tColor: { value: rt2.texture }, tDepth: { value: rt2.depthTexture },
    uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld }, uCamPos: { value: camera.position },
    uNear: { value: camera.near }, uFar: { value: camera.far },
    uNadir: { value: nadir }, uSunDir: { value: sunDir }, uSunCol: { value: sunCol }, uSkyAmb: { value: new THREE.Vector3(.010, .010, .014) },
    uAlt: { value: T.alt }, uCloudTop: { value: 6000 },
    uCoreCol: { value: coreC.clone().multiplyScalar(Isc) }, uFrontCol: { value: frontC.clone().multiplyScalar(Isc) },
    uCurtCol2: { value: coreC.clone().lerp(frontC, .55).multiplyScalar(Isc) },
    uSheathI: { value: T.sheathI }, uSheathD: { value: T.sheathD }, uEdgePhi: { value: T.edgePhi }, uAftZ: { value: T.aftZ },
    uCurtI: { value: T.curtI }, uCurtW0: { value: T.curtW0 }, uCurtW1: { value: T.curtW1 }, uCurtL: { value: T.curtL },
    uBeta: { value: T.beta }, uCurtCurv: { value: T.curtCurv }, uCurtZ0: { value: T.curtZ0 },
    uHazeI: { value: T.hazeI }, uHazeL: { value: T.hazeL }, uCloudScale: { value: T.cloudScale }, uCloudGain: { value: T.cloudGain },
  };
  const comp = makeComposite(THREE, cu);
  const fsScene = new THREE.Scene(); fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), comp));
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sensor = makeSensor(THREE, renderer, W, H);
  sensor.lensMat.uniforms.uOut.value.set(W, H, ppx, ppy);
  sensor.lensMat.uniforms.uSrc.value.set(x0, x1, yb, yt);
  sensor.lensMat.uniforms.uF.value = f;
  sensor.lensMat.uniforms.uMix.value = m;
  sensor.lensMat.uniforms.uCA.value = T.ca;
  Object.assign(sensor.finalMat.uniforms.uExposure, { value: T.exposure });
  sensor.finalMat.uniforms.uBloom.value = T.bloom;
  sensor.finalMat.uniforms.uNoise.value = T.noise;
  sensor.finalMat.uniforms.uSat.value = T.sat;

  function render() {
    renderer.setRenderTarget(rt2);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(hdr);
    renderer.render(fsScene, ortho);
    sensor.run(hdr.texture);
  }

  if (params.get('debug')) console.log(JSON.stringify({ rho: atm.rho, qdot, core, front, rw, rh, x0, x1, yb, yt, nadir, sunDir }));

  return {
    scene, camera, render,
    info: { rho: atm.rho, v, qdot, plasma: { core: core.rgb, front: front.rgb, T: core.T } },
    update() {},
    async shot(id) { /* 'reentry_flap_plasma' is the default state */ },
  };
}
