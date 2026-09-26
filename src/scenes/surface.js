// Scene: Mars surface (Jezero crater floor). The player drives the rover over a
// procedural terrain (sand ripples, partially buried fractured bedrock slabs, loose
// rocks after the Golombek size-frequency model, gravel lag) and looks through the
// Mastcam-Z camera model (optics + CCD + onboard compression chain).
//
// Controls: W/S drive, A/D turn, arrow keys pan/tilt the mast, 1..7 zoom
// (26/34/48/63/79/100/110 mm), C toggles Mastcam-Z view / chase view.
import { Terrain } from '../terrain/terrain.js';
import { MastcamZChain, MASTCAMZ } from '../sensors/mastcamz.js';
import { buildRover } from '../rover/rover.js';

const JEZERO_LAT = 18.44 * Math.PI / 180;

// Sun direction (world: +x east, -z north, +y up) from local true solar time and Ls.
export function marsSunDir(THREE, ltstHours, LsDeg, lat = JEZERO_LAT) {
  const dec = Math.asin(Math.sin(25.19 * Math.PI / 180) * Math.sin(LsDeg * Math.PI / 180));
  const H = (ltstHours - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H)); // from north, clockwise
  return { dir: new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)), el, az };
}

const SKY_VERT = /* glsl */`varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 40000.0, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir); float mu = dot(d, uSunDir);
  float h = max(d.y, 0.0);
  vec3 zen = vec3(0.050, 0.034, 0.022), hor = vec3(0.085, 0.062, 0.043);
  vec3 c = mix(hor, zen, pow(h, 0.45));
  c += vec3(0.05, 0.045, 0.045) * pow(max(mu, 0.0), 12.0) + vec3(0.9, 0.9, 0.9) * smoothstep(0.99996, 0.99998, mu) * 30.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export async function create({ THREE, renderer, params, hud }) {
  const scene = new THREE.Scene();
  const W = () => renderer.domElement.width, Hh = () => renderer.domElement.height;
  const camera = new THREE.PerspectiveCamera(19.2, innerWidth / innerHeight, 0.05, 100000);
  camera.rotation.order = 'YXZ';

  // ---- illumination: sol 211 at Jezero (Ls ~105), mid-afternoon ----
  const sol = { ltst: 15.7, Ls: 105 };
  const sun = marsSunDir(THREE, sol.ltst, sol.Ls);
  // Direct sun normalised to 1; sky diffuse irradiance on a horizontal surface relative
  // to the direct beam for tau ~0.5 (redder than the beam: forward scattering by dust).
  const sunI = new THREE.Vector3(1, 1, 1), skyI = new THREE.Vector3(0.17, 0.138, 0.110);

  const terrain = new Terrain(THREE, renderer, { rockK: 0.10, outcrop: 0.0 });
  terrain.setSun(sun.dir, sunI, skyI);
  scene.add(terrain.buildGrid(W(), Hh()));

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uSunDir: { value: sun.dir } }, side: THREE.BackSide, depthWrite: false }));
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);

  const rover = buildRover(THREE); scene.add(rover.group);
  const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.copy(sun.dir).multiplyScalar(10); scene.add(dl); scene.add(dl.target);
  const hl = new THREE.HemisphereLight(new THREE.Color(skyI.x, skyI.y, skyI.z).multiplyScalar(1.6), new THREE.Color(0.06, 0.045, 0.03), 1.0); scene.add(hl);

  const chain = new MastcamZChain(THREE, renderer, { expo: 7.2, vignette: 0.12, sigma: 0.62, jpegQuality: 90, seed: 211 });

  // ---- rover state ----
  const state = { x: 0, z: 0, heading: 0, mastAz: 0, mastEl: -0.47, focal: 34, view: 'mastcam' };
  const keys = new Set();
  addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyC') state.view = state.view === 'mastcam' ? 'chase' : 'mastcam'; const z = { Digit1: 26, Digit2: 34, Digit3: 48, Digit4: 63, Digit5: 79, Digit6: 100, Digit7: 110 }[e.code]; if (z) state.focal = z; });
  addEventListener('keyup', (e) => keys.delete(e.code));

  function placeRover() {
    const g = rover.group; const h = (x, z) => terrain.heightAt(x, z);
    const c = Math.cos(state.heading), s = Math.sin(state.heading);
    const fwd = [-s, -c], right = [c, -s];
    const hf = h(state.x + fwd[0] * 0.9, state.z + fwd[1] * 0.9), hb = h(state.x - fwd[0] * 0.9, state.z - fwd[1] * 0.9);
    const hr = h(state.x + right[0] * 1.1, state.z + right[1] * 1.1), hlft = h(state.x - right[0] * 1.1, state.z - right[1] * 1.1);
    g.position.set(state.x, (hf + hb + hr + hlft) / 4, state.z);
    g.rotation.set(0, 0, 0); g.rotation.order = 'YXZ';
    g.rotation.y = state.heading; g.rotation.x = Math.atan2(hf - hb, 1.8); g.rotation.z = Math.atan2(hlft - hr, 2.2);
    rover.setMast(state.mastAz, state.mastEl);
    g.updateMatrixWorld(true);
  }
  function placeCamera() {
    const fovH = MASTCAMZ.fovDeg(state.focal, 1648); const fovV = MASTCAMZ.fovDeg(state.focal, 1200);
    if (state.view === 'mastcam') {
      rover.group.updateMatrixWorld(true);
      rover.mastcamL.getWorldPosition(camera.position);
      // pointing: mast azimuth relative to rover heading; elevation absolute (RSM is gimballed)
      camera.rotation.set(state.mastEl, state.heading - state.mastAz, 0);
      // keep the sensor's aspect: vertical FOV scaled to the canvas height
      camera.fov = 2 * Math.atan(Math.tan(fovH * Math.PI / 360) / (W() / Hh())) * 180 / Math.PI;
    } else {
      const c = Math.cos(state.heading), s = Math.sin(state.heading);
      camera.position.set(state.x + s * 7, rover.group.position.y + 3.5, state.z + c * 7);
      camera.rotation.set(-0.3, state.heading, 0); camera.fov = 55;
    }
    camera.aspect = W() / Hh(); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function refreshShadows() { rover.group.updateMatrixWorld(true); terrain.setShadowBoxes(rover.casters.map((m) => m.matrixWorld)); }

  if (!params.get('shot')) { terrain.bakeCoarse(0, 0); placeRover(); placeCamera(); terrain.follow(camera, true); refreshShadows(); }

  function update(dt) {
    const v = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const w = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    const speed = 0.042 * 8; // Perseverance top speed 4.2 cm/s, sped up x8 for play
    state.heading += w * 0.25 * dt;
    state.x += -Math.sin(state.heading) * v * speed * dt; state.z += -Math.cos(state.heading) * v * speed * dt;
    if (keys.has('ArrowLeft')) state.mastAz -= 0.5 * dt; if (keys.has('ArrowRight')) state.mastAz += 0.5 * dt;
    if (keys.has('ArrowUp')) state.mastEl = Math.min(1.5, state.mastEl + 0.4 * dt); if (keys.has('ArrowDown')) state.mastEl = Math.max(-1.5, state.mastEl - 0.4 * dt);
    placeRover(); placeCamera(); terrain.follow(camera); refreshShadows();
    if (hud) hud.textContent = `Jezero crater floor  sol ${211}  LTST ${sol.ltst.toFixed(1)} h  sun el ${(sun.el * 57.3).toFixed(1)} deg\nrover (${state.x.toFixed(2)}, ${state.z.toFixed(2)}) m  heading ${(state.heading * 57.3).toFixed(0)} deg\nMastcam-Z ${state.focal} mm  az ${(state.mastAz * 57.3).toFixed(0)}  el ${(state.mastEl * 57.3).toFixed(0)}   [WASD drive, arrows mast, 1-7 zoom, C view]`;
  }

  const sync = () => { const gl = renderer.getContext(); const prt = renderer.getRenderTarget(); renderer.setRenderTarget(null); const b = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); renderer.setRenderTarget(prt); };
  const T = (label, t0) => { if (params.get('shot')) { sync(); console.log(`[timing] ${label} ${(performance.now() - t0).toFixed(0)} ms`); } };
  function render() {
    if (terrain.gridSize[0] !== W() || terrain.gridSize[1] !== Hh()) terrain.buildGrid(W(), Hh());
    rover.group.visible = state.view !== 'mastcam';
    const t0 = performance.now(); chain.render(scene, camera, T); T('render total', t0);
  }

  async function shot(id) {
    if (id === 'mastcam_34mm') {
      console.log('sun el', (sun.el * 57.3).toFixed(1), 'az', (sun.az * 57.3).toFixed(1));
      // Mastcam-Z left eye, 34 mm, looking ~27 deg down into the near field in front of
      // the rover, with the sun behind the camera's right shoulder.
      const camAz = sun.az - 105 * Math.PI / 180;         // compass azimuth of the view
      state.x = 3.0; state.z = -7.0; state.focal = 34; state.view = 'mastcam';
      state.mastAz = 22 * Math.PI / 180;                 // mast turned right of the rover's heading
      state.heading = -(camAz) + state.mastAz;           // three: heading = yaw about +y (0 = north)
      state.mastEl = -27 * Math.PI / 180;
      let t0 = performance.now(); terrain.bakeCoarse(state.x, state.z); T('bake coarse', t0);
      placeRover(); placeCamera(); t0 = performance.now(); terrain.follow(camera, true); T('bake fine', t0); refreshShadows();
    }
  }

  return { scene, camera, update, shot, render, terrain, rover };
}
