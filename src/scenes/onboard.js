// Scene: onboard — Super Heavy booster onboard camera at hot staging (~T+2:47, 72 km).
// Foreground hardware (grid fin, catch-pin fitting, hot-stage ring edge, ice/debris flakes)
// is real 3D geometry rendered into a cube map around the camera; the fisheye lens,
// Earth/atmosphere (single-scattering, spherical Earth) and sensor are in src/onboard/sensor.js.
import { makeFisheye } from '../onboard/fisheye.js';
import { makeSensor } from '../onboard/sensor.js';
import { R_EARTH, transmittance } from '../onboard/atmosphere.js';
import { buildHardware } from '../onboard/hardware.js';

const ALT = 72e3;

export async function create({ THREE, renderer, params }) {
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const fish = makeFisheye(THREE, { f: 600, cy: 280 }).setEuler(0, -24, 143.5);

  // --- sun: just above the apparent horizon (evening launch; sun sets behind the limb)
  const dip = Math.acos(R_EARTH / (R_EARTH + ALT));
  // sun ~at local horizontal (evening launch), just outside the right edge of the frame;
  // the lens ghosts in the frame line up with it through the optical centre.
  const sun = fish.pixelToWorldDir(1010, 90);
  const camE = [0, R_EARTH + ALT, 0];
  const Tsun = transmittance(camE, [sun.x, sun.y, sun.z]);
  const sunCol = new THREE.Vector3(...Tsun);

  const scene = new THREE.Scene();
  const hw = buildHardware(THREE, fish, { sun, sunCol, seed: 167 });
  scene.add(hw.group);

  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.05, 5000, cubeRT);
  scene.add(cubeCam);

  const sensor = makeSensor(THREE, renderer, fish, { width: W, height: H });
  const cu = sensor.composite.uniforms;
  cu.uCamRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(fish.quat));
  sensor.final.uniforms.uCamRot.value.copy(cu.uCamRot.value);
  cu.uCamE.value.set(...camE);
  cu.uSun.value.copy(sun);
  cu.uSunI.value = 1.0;
  cu.uSunCol.value.copy(sunCol);
  cu.uGlare.value = 1.0;
  cu.uPlume.value.copy(hw.plumeDir);
  cu.uPlumeCol.value.set(0.0, 0.0, 0.0);
  // brightest point of the sunset limb: where the lens ghosts originate
  const sp = fish.worldDirToPixel(sun);
  sensor.final.uniforms.uSunPx.value.set(sp[0], sp[1]);
  sensor.final.uniforms.uExposure.value = 350;
  sensor.final.uniforms.uBloom.value = 0.3;
  // auto white balance: the camera neutralises the (ozone/Rayleigh-filtered) low sun
  sensor.final.uniforms.uWB.value.set(0.62 / Tsun[0], 0.62 / Tsun[1], 0.66 / Tsun[2]);

  // a stand-in perspective camera for play mode / fallbacks
  const camera = new THREE.PerspectiveCamera(100, W / H, 0.05, 5000);
  camera.quaternion.copy(fish.quat);

  function probe() {
    const pts = [...Array(24)].map((_, i) => [640 + i * 6, 250]).concat([[50,100],[400,50],[600,60],[450,250],[550,300],[600,350],[500,470],[700,40],[800,100],[850,150],[930,60],[900,300],[920,400],[760,450],[360,420],[900,500]]);
    const buf = new Uint16Array(4); const out = [];
    const s = W / 957;
    for (const [x, y] of pts) {
      renderer.readRenderTargetPixels(sensor.rtA, Math.round(x * s), Math.round(H - 1 - y * s), 1, 1, buf);
      out.push(`${x},${y}: ` + [0, 1, 2].map(i => THREE.DataUtils.fromHalfFloat(buf[i]).toExponential(2)).join(' '));
    }
    console.log('PROBE sunPx', sp.map(v => v.toFixed(0)).join(','), 'Tsun', Tsun.map(v => v.toExponential(2)).join(' '), '\n' + out.join('\n'));
  }

  return {
    scene, camera,
    update() {},
    async shot() {},
    render() {
      const oldTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      const oc = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0);
      cubeCam.update(renderer, scene);
      renderer.setClearColor(0x000000, oc);
      renderer.toneMapping = oldTM;
      sensor.render(cubeRT.texture);
      if (params?.get('shot') === 'probe') probe();
    },
    debug: { fish, sun, sunCol, sp },
  };
}
