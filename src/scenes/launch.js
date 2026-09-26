// Scene: launch — Starship Flight Test liftoff from Starbase, Boca Chica, TX.
// Camera = the webcast's long-lens aerial tracking camera (helicopter/drone
// ~1.3 km south of the pad, ~210 m up, looking north along the beach toward
// South Padre Island).
//
// Pipeline (all passes deterministic, no wall-clock time in shot mode):
//   1. opaque scene (terrain shader, towers, OLM, vehicle) -> MSAA HDR RT + depth
//   2. composite: sky, curved-Earth marine haze, ray-marched steam/dust cloud lit
//      by the exhaust column + sun + sky, analytic emissive exhaust column
//   3. sensor: bloom/veiling glare, MTF, highlight roll-off, chroma 4:2:0, noise
import { makeTerrain, makeSPI } from '../launchsite/terrain.js';
import { makeTower, makeOLM } from '../launchsite/tower.js';
import { simulateAscent, OLM_DECK } from '../launchsite/ascent.js';
import { makeStack } from '../vehicle/starship.js';
import { makeCompositeMaterial, cloudBlobs, NB } from '../fx/plume.js';
import { makeSensor } from '../fx/sensor.js';
import { SKY } from '../fx/glsl.js';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Camera model: broadcast 2/3" box lens at long focal length. Focal length in
// pixels for the 1920x1080 raster; the shot renders the top 1920x884 (the
// webcast's telemetry strip covers the rest).
const F_PX = 3000;
const CAM = { x: 3, y: 210, z: 1310 };
const ASCENT = { tRelease: 1.3, ramp: 7.0, thrRelease: 0.73 };

export async function create({ THREE, renderer, params }) {
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(2 * Math.atan(540 / F_PX) * 180 / Math.PI, 1920 / 1080, 5, 90000);
  const fullH = Math.round(W * 1080 / 1920);
  camera.setViewOffset(W, fullH, 0, 0, W, H);
  camera.position.set(CAM.x, CAM.y, CAM.z);

  // sun: ~5 deg up, azimuth ~70 deg right of the view axis (ENE at dawn)
  const sunDir = new THREE.Vector3(Math.sin(1.22), 0.085, -Math.cos(1.22)).normalize();
  const sunCol = new THREE.Vector3(1.05, .46, .19);        // strongly reddened through marine haze
  const skyIrr = new THREE.Vector3(.72, .70, .70);        // pi * mean sky radiance
  const flameLightCol = new THREE.Vector3(1.0, .23, .025); // exhaust + afterburning, as seen by the camera

  // ascent state. In shot mode the scene flies its own liftoff clip (simulateAscent);
  // in play mode the gameplay layer drives it through setFlightState() from the
  // full ascent sim, and the camera follows the vehicle (setCameraMode()).
  let tNow = 10;
  let flight = null;
  let camMode = 'fixed';      // 'fixed' = benchmark shot framing, 'tracking' = pan/zoom from the camera site, 'chase'
  const asc = () => simulateAscent(tNow, ASCENT);
  let st = asc();
  const colBase = new THREE.Vector3(0, OLM_DECK + st.h, 0);

  // env map for the stainless steel (the same analytic sky)
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uSunDir: { value: sunDir } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `${SKY} varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y > -.01 ? skyColor(d) : vec3(.035,.032,.025); gl_FragColor = vec4(c, 1.); }`,
  })));
  const envMap = pm.fromScene(envScene, 0.02).texture;

  // lights for the standard-material objects (towers, vehicle)
  const sun = new THREE.DirectionalLight(new THREE.Color(sunCol.x, sunCol.y, sunCol.z), 11.0);
  sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
  const hemi = new THREE.HemisphereLight(new THREE.Color(.25, .235, .235), new THREE.Color(.12, .06, .03), 1.6);
  scene.add(hemi);
  const flameLight = new THREE.PointLight(new THREE.Color(flameLightCol.x, flameLightCol.y, flameLightCol.z), 1, 0, 2);
  scene.add(flameLight);
  // the sunlit/plume-lit steam cloud itself is a huge warm area light for the
  // lower booster and the tower (represented by two broad point lights)
  const cloudGlowL = new THREE.PointLight(new THREE.Color(1.0, .30, .07), 2.1e5, 0, 2);
  cloudGlowL.position.set(-90, 45, 140); scene.add(cloudGlowL);
  const cloudGlowR = new THREE.PointLight(new THREE.Color(1.0, .34, .08), 2.1e5, 0, 2);
  cloudGlowR.position.set(110, 50, 120); scene.add(cloudGlowR);

  // terrain + SPI skyline
  const terrain = makeTerrain(THREE, { camPos: camera.position, sunDir, sunCol, skyIrr, flamePos: colBase, flameCol: new THREE.Vector3(flameLightCol.x * 4e4, flameLightCol.y * 4e4, flameLightCol.z * 4e4) });
  scene.add(terrain);
  const rng = mulberry(20240613);
  const bldMat = new THREE.MeshStandardMaterial({ color: 0xb8b2aa, roughness: .9 });
  scene.add(makeSPI(THREE, rng, bldMat, camera.position));

  // towers: Pad A (with the stack) and Pad B further north-west
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: .55, metalness: .45, envMap });
  const towerA = makeTower(THREE, towerMat, null, { w: 13, faceDir: new THREE.Vector3(Math.cos(0.45), 0, Math.sin(0.45) + .15), armY: 127, armOpen: .45, qdY: 90 });
  towerA.position.set(-31, 0, -6); towerA.rotation.y = 0.45; scene.add(towerA);
  const towerB = makeTower(THREE, towerMat, null, { faceDir: new THREE.Vector3(.6, 0, .8), armY: 60, armOpen: .1, withArms: false, qdY: 120 });
  towerB.position.set(-331, 0, -580); scene.add(towerB);
  const olm = makeOLM(THREE, towerMat); scene.add(olm);
  const olmB = makeOLM(THREE, towerMat); olmB.position.set(-300, 0, -580); scene.add(olmB);

  // vehicle
  const stack = makeStack(THREE, { envMap, tileCenter: 0.5 });
  scene.add(stack);
  // Booster parts are the stack's children below the ship's base (the ship is the lathe mesh).
  const shipMesh = stack.children.find((c) => c.geometry?.type === 'LatheGeometry');
  const shipBaseY = shipMesh ? shipMesh.position.y : 0;
  const boosterParts = stack.children.filter((c) => c.position.y < shipBaseY - 0.5);
  const stackH = stack.userData.height || 121;

  // render targets
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(W, H); rt.depthTexture.type = THREE.UnsignedIntType;
  const hdr = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

  const blobs = cloudBlobs(THREE, tNow);
  const cu = {
    tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: camera.position },
    uSunDir: { value: sunDir }, uSunCol: { value: sunCol }, uSkyIrr: { value: skyIrr },
    uBlob: { value: blobs.c }, uBlobR: { value: blobs.r },
    uCol: { value: colBase }, uFlameCol: { value: new THREE.Vector3(1.0, .075, .016) }, uFlameI: { value: 16 },
    uFlameLight: { value: 440 }, uFlameLightCol: { value: flameLightCol },
    uHazeS: { value: 1 / 15000 }, uHazeH: { value: 420 }, uCloudSun: { value: new THREE.Vector3(3.2, 1.5, .18) }, uCloudSigma: { value: .30 },
  };
  const compMat = makeCompositeMaterial(THREE, cu);
  const fsScene = new THREE.Scene(); const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat); fsScene.add(fsQuad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sensor = makeSensor(THREE, renderer, W, H);

  const aim = new THREE.Vector3();
  const up = new THREE.Vector3(), mid = new THREE.Vector3(), chaseOff = new THREE.Vector3(-0.45, -0.3, 1).normalize();
  const EARTH_R = 6371e3;
  const FOV0 = 2 * Math.atan(540 / F_PX) * 180 / Math.PI;
  function place() {
    let h, lean, x = 0, lit = true, shipOnly = false;
    if (flight) {
      // Sim-driven: altitude and downrange (east = +x) with the Earth's curvature
      // dropping distant points below the camera's horizon.
      h = Math.max(0, flight.altitude);
      x = Math.max(0, flight.downrange);
      h -= (x * x) / (2 * EARTH_R);
      lean = -(flight.pitchDeg || 0) * Math.PI / 180;
      shipOnly = !!flight.staged;
      lit = shipOnly ? (flight.shipLit || []).some((n) => n > 0) : (flight.boosterLit || []).some(Boolean);
    } else {
      st = asc();
      h = st.h;
      // tower-avoidance manoeuvre: the booster gimbals to lean away from the tower
      lean = -0.042 * Math.min(1, Math.max(0, (tNow - 3) / 5));
    }
    for (const b of boosterParts) b.visible = !shipOnly;
    // After staging the ship's base is the reference point, not the booster's.
    colBase.set(x, OLM_DECK + h, 0);
    stack.position.set(x, colBase.y - (shipOnly ? shipBaseY : 0), 0);
    stack.rotation.z = lean;
    flameLight.position.set(x, colBase.y - 25, 0);
    flameLight.intensity = lit ? (shipOnly ? 6e4 : 2.5e5) : 0;
    cu.uFlameI.value = lit ? (shipOnly ? 7 : 16) : 0;
    cu.uFlameLight.value = lit ? 440 : 0;

    // centre of the visible vehicle, along its (leaning) axis
    up.set(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean);
    const len = shipOnly ? stackH - shipBaseY : stackH;
    mid.copy(colBase).addScaledVector(up, len / 2);
    let fov = FOV0;
    if (camMode === 'chase') {
      // chase camera: behind and below the vehicle, looking up its side
      const d = 3.2 * len;
      camera.position.copy(mid).addScaledVector(chaseOff, d);
      camera.position.y = Math.max(camera.position.y, 8);
      camera.lookAt(mid);
      fov = 40;
    } else {
      camera.position.set(CAM.x, CAM.y, CAM.z);
      if (camMode === 'tracking') {
        // tracking camera: stays at the camera site, pans to the vehicle and zooms
        // in (down to a ~0.3 deg field) to hold it at ~40 % of the frame height
        camera.lookAt(mid);
        const dist = camera.position.distanceTo(mid);
        const want = 2 * Math.atan(len / 0.4 / 2 / dist) * 180 / Math.PI;
        fov = Math.max(0.3, Math.min(FOV0, want));
      } else {
        aim.set(CAM.x, CAM.y - 0.0065 * CAM.z, 0);    // ~0.37 deg down: sea horizon near frame centre
        camera.lookAt(aim);
      }
    }
    camera.fov = fov;
    camera.far = Math.max(90000, camera.position.distanceTo(mid) * 1.5);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const b = cloudBlobs(THREE, Math.min(tNow, 60));
    for (let i = 0; i < NB; i++) { cu.uBlob.value[i].copy(b.c[i]); cu.uBlobR.value[i].copy(b.r[i]); }
  }
  place();

  function render() {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, camera);
    cu.uInvProj.value.copy(camera.projectionMatrixInverse);
    cu.uCamWorld.value.copy(camera.matrixWorld);
    renderer.setRenderTarget(hdr);
    renderer.render(fsScene, ortho);
    sensor.run(hdr.texture);
  }

  return {
    scene, camera, render, stack,
    update(dt) {
      if (flight) { place(); return; }     // play mode: time comes from setFlightState()
      tNow = Math.min(tNow + dt, 60); if (tNow > 40) tNow = -3; place();
    },
    /** Play mode: drive the vehicle from the gameplay ascent sim (see src/game/phases/launch.js). */
    setFlightState(f) { flight = f; tNow = f.t; place(); },
    /** 'tracking' (default in play), 'chase' or 'fixed' (the benchmark shot framing). */
    setCameraMode(m) { camMode = m; place(); },
    get cameraMode() { return camMode; },
    async shot(id) {
      if (id === 'liftoff_t10_aerial') { tNow = 10; place(); }
    },
  };
}
