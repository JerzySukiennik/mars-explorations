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
  const flameLightCol = new THREE.Vector3(1.0, .165, .018); // exhaust + afterburning, as seen by the camera

  // ascent state
  let tNow = 10;
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
  const sun = new THREE.DirectionalLight(new THREE.Color(sunCol.x, sunCol.y, sunCol.z), 5.0);
  sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
  const hemi = new THREE.HemisphereLight(new THREE.Color(.25, .235, .235), new THREE.Color(.09, .06, .04), 2.4);
  scene.add(hemi);
  const flameLight = new THREE.PointLight(new THREE.Color(flameLightCol.x, flameLightCol.y, flameLightCol.z), 1, 0, 2);
  scene.add(flameLight);
  // the sunlit/plume-lit steam cloud itself is a huge warm area light for the
  // lower booster and the tower (represented by two broad point lights)
  const cloudGlowL = new THREE.PointLight(new THREE.Color(1.0, .30, .07), 1.6e5, 0, 2);
  cloudGlowL.position.set(-90, 45, 140); scene.add(cloudGlowL);
  const cloudGlowR = new THREE.PointLight(new THREE.Color(1.0, .34, .08), 1.6e5, 0, 2);
  cloudGlowR.position.set(110, 50, 120); scene.add(cloudGlowR);

  // terrain + SPI skyline
  const terrain = makeTerrain(THREE, { camPos: camera.position, sunDir, sunCol, skyIrr, flamePos: colBase, flameCol: new THREE.Vector3(flameLightCol.x * 4e4, flameLightCol.y * 4e4, flameLightCol.z * 4e4) });
  scene.add(terrain);
  const rng = mulberry(20240613);
  const bldMat = new THREE.MeshStandardMaterial({ color: 0xb8b2aa, roughness: .9 });
  scene.add(makeSPI(THREE, rng, bldMat, camera.position));

  // towers: Pad A (with the stack) and Pad B further north-west
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: .7, metalness: .2, envMap });
  const towerA = makeTower(THREE, towerMat, null, { w: 13, faceDir: new THREE.Vector3(Math.cos(0.45), 0, Math.sin(0.45) + .15), armY: 127, armOpen: .45, qdY: 90 });
  towerA.position.set(-31, 0, -6); towerA.rotation.y = 0.45; scene.add(towerA);
  const towerB = makeTower(THREE, towerMat, null, { faceDir: new THREE.Vector3(.6, 0, .8), armY: 60, armOpen: .1, withArms: true, qdY: 120 });
  towerB.position.set(-331, 0, -580); scene.add(towerB);
  const olm = makeOLM(THREE, towerMat); scene.add(olm);
  const olmB = makeOLM(THREE, towerMat); olmB.position.set(-300, 0, -580); scene.add(olmB);

  // vehicle
  const stack = makeStack(THREE, { envMap, tileCenter: 0.5 });
  scene.add(stack);

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
    uCol: { value: colBase }, uFlameCol: { value: new THREE.Vector3(1.0, .075, .016) }, uFlameI: { value: 12 },
    uFlameLight: { value: 620 }, uFlameLightCol: { value: flameLightCol },
    uHazeS: { value: 1 / 15000 }, uHazeH: { value: 420 }, uCloudSun: { value: new THREE.Vector3(3.2, 1.25, .16) }, uCloudSigma: { value: .30 },
  };
  const compMat = makeCompositeMaterial(THREE, cu);
  const fsScene = new THREE.Scene(); const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat); fsScene.add(fsQuad);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sensor = makeSensor(THREE, renderer, W, H);

  const aim = new THREE.Vector3();
  function place() {
    st = asc();
    colBase.set(0, OLM_DECK + st.h, 0);
    stack.position.set(0, colBase.y, 0);
    // tower-avoidance manoeuvre: the booster gimbals to lean away from the tower
    stack.rotation.z = -0.042 * Math.min(1, Math.max(0, (tNow - 3) / 5));
    flameLight.position.set(0, colBase.y - 25, 0);
    flameLight.intensity = 2.5e5;
    // tracking camera: fixed position, framing held from the shot plan
    camera.position.set(CAM.x, CAM.y, CAM.z);
    aim.set(CAM.x, CAM.y - 0.0065 * CAM.z, 0);      // ~0.37 deg down: sea horizon near frame centre
    camera.lookAt(aim);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    const b = cloudBlobs(THREE, tNow);
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
    scene, camera, render,
    update(dt) { tNow = Math.min(tNow + dt, 60); if (tNow > 40) tNow = -3; place(); },
    async shot(id) {
      if (id === 'liftoff_t10_aerial') { tNow = 10; place(); }
    },
  };
}
