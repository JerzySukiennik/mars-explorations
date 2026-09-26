// Phase 6: surface base. Drive the rover (Perseverance speed limits, slip on
// slopes), keep it powered (MMRTG + batteries, charging station), haul
// regolith from the dig site to the printers, and print the base: structures
// appear in the scene and grow layer by layer.
import * as Sf from '../sims/surface.js';
import { el, esc, panel, controlPad, fmt, every, fitCanvas } from '../ui.js';
import { hook, sceneObject } from './common.js';
import { synthKey } from '../input.js';

const CAMS = ['chase', 'navcam', 'mastcam', 'hazcam', 'scene'];
const CAM_LABEL = { chase: 'CHASE', navcam: 'NAVCAM', mastcam: 'MASTCAM-Z', hazcam: 'FRONT HAZCAM', scene: 'SCENE VIEW' };

function vec(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : null; }

export async function create(game) {
  const { ctx, THREE, deps, input, layer, auto } = game;
  const scene = ctx.scene, camera = ctx.camera;
  const sceneHeight = typeof ctx.heightAt === 'function' ? ctx.heightAt.bind(ctx)
    : typeof ctx.terrain?.heightAt === 'function' ? ctx.terrain.heightAt.bind(ctx.terrain)
    : typeof ctx.getHeightAt === 'function' ? ctx.getHeightAt.bind(ctx) : null;
  const heightAt = (x, z) => { const y = sceneHeight ? sceneHeight(x, z) : Sf.fallbackHeight(x, z); return Number.isFinite(y) ? y : 0; };
  const base = ctx.base || ctx.sites || {};
  const sites = {};
  for (const [k, names] of Object.entries({ charger: ['charger', 'chargingStation'], printer: ['printer', 'printers'], dig: ['dig', 'digSite', 'excavation'] })) {
    for (const n of names) { const v = vec(base[n]?.position || base[n]); if (v) { sites[k] = v; break; } }
  }
  const s = Sf.createSurface({ RV: deps.RV, PR: deps.PR, heightAt, sites });

  // ---- scene objects (only what the scene does not already provide)
  const added = [];
  const add = (o) => { scene.add(o); added.push(o); return o; };
  const mat = (color, rough = 0.9, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (!sceneHeight) add(makeGround(THREE, heightAt));
  if (!vec(base.charger?.position || base.charger)) add(makeCharger(THREE, s.sites.charger, heightAt, mat));
  if (!vec(base.printer?.position || base.printer)) add(makePrinterStation(THREE, s.sites.printer, heightAt, mat));
  if (!vec(base.dig?.position || base.dig || base.digSite)) add(makeDigSite(THREE, s.sites.dig, heightAt));
  if (!base.solar && !base.solarField) add(makeSolarField(THREE, { x: -38, z: -18 }, heightAt, mat));
  // The scene's rover: ctx.rover as an Object3D, or {group, mastcamL, setMast,
  // casters} as returned by src/rover/rover.js. Forward is -z (heading 0 = north).
  const sceneRover = ctx.rover && ctx.rover.group?.position ? ctx.rover : null;
  let rover = sceneRover ? sceneRover.group : sceneObject(ctx, 'rover');
  if (!rover) rover = add(makeRover(THREE, mat));
  // Scenes built like src/scenes/surface.js toggle their own mastcam/chase view
  // on C and hide the rover in mastcam view; keep that view in step with ours.
  let sceneView = sceneRover?.mastcamL ? 'mastcam' : null;
  const onSceneKey = (e) => { if (e.code === 'KeyC' && sceneView) sceneView = sceneView === 'mastcam' ? 'chase' : 'mastcam'; };
  if (sceneView) addEventListener('keydown', onSceneKey);
  const layerTex = makeLayerTexture(THREE);
  const structMat = new THREE.MeshStandardMaterial({ color: 0xb49a82, roughness: 0.95, map: layerTex, side: THREE.DoubleSide });
  const meshes = new Map();       // job/built id -> {mesh, key, layers}
  const gantry = add(makeGantry(THREE, mat));
  gantry.visible = false;

  // ---- HUD
  const rp = panel('ROVER', 'g-left');
  rp.row('lmst', 'LMST').text('msg', 'g-msg').bar('soc', 'BATTERY').row('gen', 'MMRTG', 'W').row('load', 'LOAD', 'W').row('chg', 'CHARGER', 'W')
    .row('spd', 'SPEED', 'cm/s').row('slope', 'SLOPE', 'deg').row('slip', 'SLIP', '%').row('odo', 'ODOMETER', 'm').bar('whl', 'WHEELS').bar('cart', 'CART')
    .row('mode', 'MODE');
  layer.append(rp.root);
  const bp = panel('BASE', 'g-right g-base');
  bp.row('solar', 'SOLAR FIELD', 'kW').bar('bank', 'BATTERY BANK').row('prt', 'PRINTER DRAW', 'kW').row('stock', 'REGOLITH STOCK', 'kg').row('spare', 'SPARE WHEELS').text('queue', 'g-queue').text('obj', 'g-obj');
  layer.append(bp.root);
  const camLabel = el('div', 'g-camlabel', 'CHASE');
  layer.append(camLabel);
  const mapBox = el('section', 'g-panel g-minimap');
  const mapCv = el('canvas', 'g-mapcv');
  mapBox.append(mapCv);
  layer.append(mapBox);
  const buildMenu = el('div', 'g-build hidden');
  layer.append(buildMenu);

  const pad = controlPad(input, [
    [{ label: 'LEFT', code: 'KeyA' }, { label: 'FWD', code: 'KeyW' }, { label: 'RIGHT', code: 'KeyD' }],
    [{ label: 'ACTION', code: 'KeyE', hold: false, cls: 'primary' }, { label: 'BACK', code: 'KeyS' }, { label: 'BUILD', code: 'KeyB', hold: false }],
    [{ label: 'CAM', code: 'KeyC', hold: false }, { label: 'AUTO', code: 'KeyU', hold: false }],
  ], 'g-pad-right g-pad-low');
  layer.append(pad);

  let cam = 'chase', focal = 34, mastAz = 0, mastEl = -0.3, autopilot = auto, buildOpen = false, finished = false;
  const tick = every(8);
  game.setWarpLevels([1, 10, 100, 500, 2000], ['1x', '10x', '100x', '500x', '2000x']);
  if (auto) { Sf.queueJob(s, 'pad'); game.setWarp(3); }
  const home = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, near: camera.near };

  function renderBuildMenu() {
    const rows = Object.entries(Sf.RECIPES).map(([k, r], i) => {
      const p = Sf.planRecipe(k, s.PR);
      return `<tr data-k="${k}"><td><kbd>${i + 1}</kbd></td><td><b>${esc(r.name)}</b><div class="g-note">${esc(r.desc)}</div></td>
        <td class="num">${fmt(p.regolithMass)} kg</td><td class="num">${fmt(p.printTime / 3600, 1)} h</td><td class="num">${fmt(p.power / 1e3, 1)} kW</td><td class="num">${fmt(p.energy / 3.6e6)} kWh</td></tr>`;
    }).join('');
    buildMenu.innerHTML = `<h3 class="g-ptitle">PRINT QUEUE: ADD ITEM</h3>
      <table class="g-score"><tr><th></th><th>ITEM</th><th>REGOLITH</th><th>TIME</th><th>POWER</th><th>ENERGY</th></tr>${rows}</table>
      <p class="g-note">Printers draw regolith from the stockpile as they print and pause when it runs out or base power is short. Stockpile: ${fmt(s.stockpile)} kg. Press 1-4 or click; B closes.</p>`;
    buildMenu.querySelectorAll('tr[data-k]').forEach((tr) => tr.addEventListener('click', () => queue(tr.dataset.k)));
  }
  function queue(k) {
    const r = Sf.queueJob(s, k);
    if (r.ok) game.toast(`${Sf.RECIPES[k].name} queued: ${fmt(r.plan.regolithMass)} kg regolith, ${fmt(r.plan.printTime / 3600, 1)} h`);
    buildOpen = false; buildMenu.classList.add('hidden');
  }

  // ---- rover autopilot: haul regolith between dig site and printer
  function autoDrive() {
    const site = Sf.nearSite(s);
    if (s.digging || s.unloading) return { drive: 0, steer: 0 };
    if (site === 'dig' && s.cart < Sf.CART_KG - 1) return { drive: 0, steer: 0, action: true };
    if (site === 'printer' && s.cart > 0) return { drive: 0, steer: 0, action: true };
    const tgt = s.cart >= Sf.CART_KG - 1 ? s.sites.printer : s.rover.battery.soc < 0.3 ? s.sites.charger : s.sites.dig;
    if (s.rover.battery.soc < 0.3 && site === 'charger') return { drive: 0, steer: 0 };
    const want = Sf.headingTo(s.rover.x, s.rover.z, tgt.x, tgt.z);
    let d = want - s.rover.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { drive: Math.abs(d) < 0.5 ? 1 : 0, steer: Math.max(-1, Math.min(1, d * 3)) };
  }

  function update(dt, warp) {
    if (input.wasPressed('KeyC')) { cam = CAMS[(CAMS.indexOf(cam) + 1) % CAMS.length]; if (cam === 'scene') restoreCam(); }
    if (input.wasPressed('KeyU')) { autopilot = !autopilot; game.toast(`Haul autopilot ${autopilot ? 'ON' : 'OFF'}`); }
    if (input.wasPressed('KeyB')) { buildOpen = !buildOpen; buildMenu.classList.toggle('hidden', !buildOpen); if (buildOpen) renderBuildMenu(); }
    if (buildOpen) { for (let i = 1; i <= 4; i++) if (input.wasPressed(`Digit${i}`)) queue(Object.keys(Sf.RECIPES)[i - 1]); }
    if (!buildOpen) { const z = { Digit1: 26, Digit2: 34, Digit3: 48, Digit4: 63, Digit5: 79, Digit6: 100, Digit7: 110 }; for (const k in z) if (input.wasPressed(k)) focal = z[k]; }
    mastAz += input.axis(['ArrowLeft'], ['ArrowRight']) * 0.5 * dt;
    mastEl = Math.max(-1.4, Math.min(1.2, mastEl + input.axis(['ArrowDown'], ['ArrowUp']) * 0.4 * dt));
    let c;
    if (autopilot) c = autoDrive();
    else c = { drive: input.axis(['KeyS'], ['KeyW']), steer: input.axis(['KeyD'], ['KeyA']), action: input.wasPressed('KeyE') };
    const before = s.message;
    Sf.stepSurface(s, dt * warp, c);
    if (s.message !== before && s.message) game.toast(s.message);
    placeRover();
    updateStructures(dt);
    hook(ctx, 'setSurfaceState', { t_h: s.t_h, sol: s.sol, rover: { x: s.rover.x, z: s.rover.z, heading: s.rover.heading }, built: s.built.map((b) => b.key) });
    hook(ctx, 'setSolTime', s.t_h / Sf.SOL_H);
    updateCamera(dt);
    if (tick(dt)) render();
    if (!finished && s.objectives.pad && s.objectives.habitat) {
      finished = true;
      const r = Sf.surfaceResult(s);
      game.finish(r, {}, { headline: 'BASE ESTABLISHED', summaryHtml: `Landing pad and habitat shell printed in ${fmt(r.sols, 2)} sols. Rover odometer ${fmt(r.odometer)} m.`, delayMs: 2500 });
    }
  }

  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  function placeRover() {
    const R = s.rover;
    const [fx, fz] = Sf.forward(R.heading), rx = -fz, rz = fx;
    const hF = heightAt(R.x + fx * 0.9, R.z + fz * 0.9), hB = heightAt(R.x - fx * 0.9, R.z - fz * 0.9);
    const hR = heightAt(R.x + rx * 1.1, R.z + rz * 1.1), hL = heightAt(R.x - rx * 1.1, R.z - rz * 1.1);
    rover.position.set(R.x, (hF + hB + hL + hR) / 4, R.z);
    e.set(Math.atan2(hF - hB, 1.8), R.heading, Math.atan2(hL - hR, 2.2));
    rover.quaternion.setFromEuler(e);
    sceneRover?.setMast?.(mastAz, mastEl);
    rover.updateMatrixWorld(true);
    if (sceneRover?.casters && typeof ctx.terrain?.setShadowBoxes === 'function') ctx.terrain.setShadowBoxes(sceneRover.casters.map((m) => m.matrixWorld));
  }

  const tmp = new THREE.Vector3(), look = new THREE.Vector3(), camPos = new THREE.Vector3();
  function restoreCam() { camera.position.copy(home.pos); camera.quaternion.copy(home.quat); camera.fov = home.fov; camera.near = home.near; camera.updateProjectionMatrix(); }
  function updateCamera(dt) {
    camLabel.textContent = cam === 'mastcam' ? `MASTCAM-Z  ${focal} MM` : CAM_LABEL[cam];
    if (sceneView) {
      const want = cam === 'mastcam' || cam === 'navcam' ? 'mastcam' : 'chase';   // hides the rover body from mast cameras
      if (cam !== 'scene' && sceneView !== want) synthKey('KeyC');
    }
    if (cam === 'scene') return;
    if (hook(ctx, 'roverCamera', cam, camera, rover)) return;
    const local = (x, y, z) => tmp.set(x, y, z).applyMatrix4(rover.matrixWorld);
    const R = s.rover;
    const aspect = camera.aspect || innerWidth / innerHeight;
    let fov = 50;
    camera.rotation.order = 'YXZ';
    if (cam === 'chase') {
      const target = local(0, 1.0, 0).clone();
      const [fx, fz] = Sf.forward(R.heading);
      const want = camPos.set(R.x - fx * 7.5, 0, R.z - fz * 7.5);
      want.y = Math.max(heightAt(want.x, want.z) + 1.5, target.y + 2.6);
      if (camera.position.distanceTo(want) > 40) camera.position.copy(want);
      camera.position.lerp(want, Math.min(1, dt * 4));
      camera.lookAt(target);
      fov = 55;
    } else if (cam === 'hazcam') {
      // front Hazcams: ~0.7 m up on the body front, 124 deg fisheye (perspective approximation)
      camera.position.copy(local(0, 0.72, -1.3));
      camera.rotation.set(-0.5, R.heading, 0);
      fov = 100;
    } else {
      // Remote Sensing Mast head (~2 m): Navcam 96 x 73 deg; Mastcam-Z zoom 26-110 mm
      if (sceneRover?.mastcamL) sceneRover.mastcamL.getWorldPosition(camera.position);
      else camera.position.copy(local(0.52, 1.98, -0.72));
      camera.rotation.set(mastEl, R.heading - mastAz, 0);
      if (cam === 'navcam') fov = 73;
      else { const fovH = 2 * Math.atan(12.2 / 2 / focal); fov = 2 * Math.atan(Math.tan(fovH / 2) / aspect) * 180 / Math.PI; }
    }
    if (camera.fov !== fov || camera.near > 0.05) { camera.fov = fov; camera.near = Math.min(camera.near, 0.05); camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    if (typeof ctx.terrain?.follow === 'function') ctx.terrain.follow(camera);
  }

  // ---- printed structures, grown layer by layer
  function structureMesh(key) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BufferGeometry(), structMat);
    m.castShadow = m.receiveShadow = true;
    g.add(m); g.userData.mesh = m; g.userData.key = key;
    return g;
  }
  const LAYERS = { pad: 12, wall: 30, habitat: 36, wheel: 20 };
  function geometryFor(key, frac) {
    const r = Sf.RECIPES[key];
    if (key === 'pad') { const [d, t] = r.args; return new THREE.CylinderGeometry(d / 2, d / 2, Math.max(0.005, t * frac), 48).translate(0, t * frac / 2, 0); }
    if (key === 'wall') { const [l, h, t] = r.args; return new THREE.BoxGeometry(l, Math.max(0.01, h * frac), t).translate(0, h * frac / 2, 0); }
    if (key === 'habitat') {
      const [ri, t] = r.args; const R = ri + t;
      // hemisphere printed bottom-up: band from the equator up to height frac*R
      const top = Math.acos(Math.min(1, Math.max(0, frac)));
      return new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, top, Math.PI / 2 - top);
    }
    return new THREE.CylinderGeometry(0.2635, 0.2635, 0.2 * Math.max(0.02, frac), 24).rotateZ(Math.PI / 2).translate(0, 0.27, 0);
  }
  function syncMesh(id, key, plot, frac) {
    let rec = meshes.get(id);
    if (!rec) {
      const g = structureMesh(key);
      g.position.set(plot.x, heightAt(plot.x, plot.z) - (key === 'pad' ? 0.02 : 0), plot.z);
      if (key === 'wheel') g.position.x += 2.2;
      add(g); rec = { g, layer: -1 }; meshes.set(id, rec);
    }
    const n = LAYERS[key];
    const layerNow = Math.round(frac * n);
    if (layerNow !== rec.layer) {
      rec.layer = layerNow;
      const m = rec.g.userData.mesh;
      m.geometry.dispose();
      m.geometry = geometryFor(key, Math.max(0.02, layerNow / n));
    }
    return rec;
  }
  let gantryT = 0;
  function updateStructures(dt) {
    gantryT += dt;
    let active = null;
    for (const j of s.jobs) {
      if (j.key === 'wheel' && j.progress <= 0) continue;
      const rec = syncMesh(j.id, j.key, j.plot, j.progress);
      if (j.status === 'printing' && j.key !== 'wheel') active = { j, rec };
    }
    for (const b of s.built) syncMesh(b.id, b.key, b.plot, 1);
    gantry.visible = !!active;
    if (active) {
      const { j } = active;
      const r = Sf.RECIPES[j.key];
      const size = j.key === 'wall' ? r.args[0] / 2 + 0.6 : j.key === 'pad' ? r.args[0] / 2 + 0.6 : r.args[0] + r.args[1] + 0.6;
      const hgt = j.key === 'habitat' ? r.args[0] + r.args[1] : j.key === 'wall' ? r.args[1] : 0.4;
      gantry.position.set(j.plot.x, heightAt(j.plot.x, j.plot.z), j.plot.z);
      gantry.scale.set(size, hgt + 0.8, size);
      const head = gantry.userData.head;
      const a = gantryT * 2.2;
      const layerY = (j.key === 'habitat' ? j.progress : j.progress) * hgt;
      head.position.set(Math.cos(a) * 0.8, (layerY + 0.35) / (hgt + 0.8), Math.sin(a) * 0.8);
      head.scale.set(0.3 / size, 0.3 / (hgt + 0.8), 0.3 / size);
    }
  }

  // ---- HUD render
  function render() {
    const R = s.rover, B = s.base;
    rp.set('lmst', `SOL ${s.sol}  ${Sf.lmst(s.t_h)}`);
    const site = Sf.nearSite(s);
    let msg = R.lowPower ? '<b class="bad">SAFE MODE: battery low. Charging from MMRTG (or drive-in charger when recovered).</b>'
      : s.digging ? 'Excavating regolith into the cart...' : s.unloading ? 'Unloading cart into the printer feed hopper...'
      : site === 'dig' ? (s.cart < Sf.CART_KG ? 'At the dig site: E to excavate.' : 'Cart full: drive to the printer.')
      : site === 'printer' ? (s.cart > 0 ? 'At the printer: E to unload the cart.' : B.spareWheels > 0 && R.wheelHealth < 0.999 ? 'E to fit a spare wheel.' : 'At the printer. B opens the build menu.')
      : site === 'charger' ? 'Docked at the charging station.' : 'Drive with W/A/S/D. Haul regolith from the dig site (brown ring) to the printer.';
    rp.set('msg', msg);
    rp.setBar('soc', R.battery.soc, `${fmt(R.battery.soc * 100)} %`, R.battery.soc < 0.2 ? 'bad' : '');
    rp.set('gen', fmt(R.gen)); rp.set('load', fmt(R.load)); rp.set('chg', fmt(R.charging));
    rp.set('spd', fmt(Math.abs(R.speed) * 100, 2)); rp.set('slope', fmt(R.slopeDeg, 1)); rp.set('slip', fmt(R.slip * 100));
    rp.set('odo', fmt(R.odometer, 1));
    rp.setBar('whl', R.wheelHealth, `${fmt(R.wheelHealth * 100)} %`, R.wheelHealth < 0.4 ? 'bad' : '');
    rp.setBar('cart', s.cart / Sf.CART_KG, `${fmt(s.cart)} kg`);
    rp.set('mode', R.mode.toUpperCase() + (R.sliding ? ' SLIDING' : ''));
    bp.set('solar', fmt(B.solarW / 1e3, 1)); bp.setBar('bank', B.bankWh / B.bankMaxWh, `${fmt(B.bankWh / 1e3)} kWh`);
    bp.set('prt', fmt(B.printerW / 1e3, 1)); bp.set('stock', fmt(s.stockpile)); bp.set('spare', String(B.spareWheels));
    const jobs = s.jobs.map((j) => `<div class="g-job" data-state="${j.status === 'printing' ? 'ok' : j.status === 'queued' ? '' : 'bad'}"><span>${esc(Sf.RECIPES[j.key].name)}</span><span class="g-bar"><i style="width:${(j.progress * 100).toFixed(1)}%"></i></span><span class="g-small">${esc(j.status.toUpperCase())}</span></div>`).join('');
    bp.set('queue', jobs || '<div class="g-note">Print queue empty. Press B to build.</div>');
    const ob = s.objectives;
    bp.set('obj', `<div class="g-ptitle">OBJECTIVES</div><div data-state="${ob.pad ? 'ok' : ''}">${ob.pad ? '[x]' : '[ ]'} Landing pad</div><div data-state="${ob.habitat ? 'ok' : ''}">${ob.habitat ? '[x]' : '[ ]'} Habitat shell</div>`);
    drawMap();
    game.setStatus(`<span>JEZERO BASE</span><span>${s.rm.source === 'fallback' ? 'fallback rover model' : ''}</span>${autopilot ? '<span class="g-ap">HAUL AUTOPILOT</span>' : ''}`);
  }

  function drawMap() {
    const { g, w, h } = fitCanvas(mapCv);
    g.clearRect(0, 0, w, h);
    const cx = 8, cz = -2, span = 62;
    const P = (x, z) => [w / 2 + (x - cx) / span * (w / 2), h / 2 + (z - cz) / span * (h / 2)];
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '10px ui-monospace, monospace'; g.fillText('BASE MAP', 6, 12);
    const dot = (p, col, r, label) => { const [x, y] = P(p.x, p.z); g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); if (label) { g.fillStyle = col; g.fillText(label, x + r + 2, y + 3); } };
    dot(s.sites.dig, '#c98a5a', 7, 'DIG'); dot(s.sites.printer, '#9ad0ff', 6, 'PRINTER'); dot(s.sites.charger, '#8fe3b0', 5, 'CHARGE');
    for (const b of s.built) { const [x, y] = P(b.plot.x, b.plot.z); g.fillStyle = '#d8c4ae'; g.fillRect(x - 3, y - 3, 6, 6); }
    for (const j of s.jobs) { const [x, y] = P(j.plot.x, j.plot.z); g.strokeStyle = '#d8c4ae'; g.strokeRect(x - 3, y - 3, 6, 6); }
    const R = s.rover; const [x, y] = P(R.x, R.z);
    g.save(); g.translate(x, y); g.rotate(-R.heading);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.restore();
  }

  // When the scene hands us its rover and terrain streaming, gameplay does the
  // scene's per-frame work itself (rover pose, mast, camera, terrain.follow,
  // shadow boxes). Running the scene's own update as well would re-bake the
  // terrain around its internal camera every frame, so it is skipped.
  const takeOver = !!(sceneRover && typeof ctx.terrain?.follow === 'function');

  return {
    update,
    sceneDt: takeOver ? () => 0 : undefined,
    help: [['W S', 'Drive forward / reverse'], ['A D', 'Steer'], ['E', 'Action: excavate / unload / fit spare wheel'], ['B', 'Build menu (then 1-4)'], ['C', 'Camera: chase / Navcam / Mastcam-Z / Hazcam / scene'], ['Arrows', 'Pan / tilt the mast'], ['1-7', 'Mastcam-Z focal length 26-110 mm'], ['U', 'Haul autopilot']],
    debug: () => ({ sol: s.sol, t_h: s.t_h, rover: { x: s.rover.x, z: s.rover.z, soc: s.rover.battery.soc }, cart: s.cart, stock: s.stockpile, jobs: s.jobs.map((j) => [j.key, j.status, j.progress]), built: s.built.map((b) => b.key) }),
    dispose() { for (const o of added) scene.remove(o); removeEventListener('keydown', onSceneKey); },
  };
}

// ---------------------------------------------------------------- props --
function makeGround(THREE, heightAt) {
  const size = 240, n = 120;
  const geo = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9c6b4c, roughness: 1 }));
  m.receiveShadow = true; m.name = 'game-fallback-ground';
  return m;
}

function makeRover(THREE, mat) {
  const g = new THREE.Group(); g.name = 'game-proxy-rover';
  const white = mat(0xd9d6d0, 0.7), dark = mat(0x3a3a3a, 0.8), alu = mat(0x9a9a9a, 0.5, 0.6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 2.4), white); body.position.y = 1.0; g.add(body);
  // forward is -z: MMRTG at the back (+z), mast at the front left (-z)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.8), dark); deck.position.set(0, 1.25, 1.0); deck.rotation.x = -0.5; g.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9), white); mast.position.set(0.52, 1.6, -0.72); g.add(mast);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.25), white); head.position.set(0.52, 1.98, -0.72); g.add(head);
  const wheelGeo = new THREE.CylinderGeometry(0.2635, 0.2635, 0.4, 20).rotateZ(Math.PI / 2);
  for (const z of [-1.0, 0, 1.0]) for (const x of [-1.25, 1.25]) { const w = new THREE.Mesh(wheelGeo, alu); w.position.set(x, 0.2635, z); g.add(w); }
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.1), alu);
  for (const x of [-1.25, 1.25]) { const r = rocker.clone(); r.position.set(x, 0.62, 0); g.add(r); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function onGround(obj, p, heightAt) { obj.position.set(p.x, heightAt(p.x, p.z), p.z); return obj; }

function makeCharger(THREE, p, heightAt, mat) {
  const g = new THREE.Group(); g.name = 'game-charger';
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), mat(0xcfcac2, 0.6)); post.position.y = 0.8; g.add(post);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x33ff99, emissiveIntensity: 0.6 })); lamp.position.y = 1.5; g.add(lamp);
  const padm = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.05, 32), mat(0x6f6258, 1)); padm.position.y = 0.02; g.add(padm);
  return onGround(g, p, heightAt);
}

function makePrinterStation(THREE, p, heightAt, mat) {
  const g = new THREE.Group(); g.name = 'game-printer';
  const frame = mat(0xbfc4c8, 0.5, 0.5);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 1.6, 16), frame); hopper.position.y = 1.6; g.add(hopper);
  const legs = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { const l = new THREE.Mesh(legs, frame); l.position.set(x, 0.5, z); g.add(l); }
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), mat(0xdedad3, 0.6)); box.position.set(2.2, 0.6, 0); g.add(box); // part printer (DED)
  return onGround(g, p, heightAt);
}

function makeDigSite(THREE, p, heightAt) {
  const g = new THREE.Group(); g.name = 'game-dig-site';
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 5.0, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a3522, roughness: 1 }));
  ring.position.y = 0.04; g.add(ring);
  const pit = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d4330, roughness: 1 }));
  pit.position.y = 0.03; g.add(pit);
  return onGround(g, p, heightAt);
}

function makeSolarField(THREE, p, heightAt, mat) {
  const g = new THREE.Group(); g.name = 'game-solar-field';
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.35, metalness: 0.4 });
  const geo = new THREE.BoxGeometry(18, 0.06, 2.4);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geo, panelMat);
    m.position.set(0, 0.9, i * 3.6); m.rotation.x = -0.35; g.add(m);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), mat(0x999999, 0.5, 0.5)); leg.position.set(0, 0.45, i * 3.6); g.add(leg);
  }
  return onGround(g, p, heightAt);
}

function makeGantry(THREE, mat) {
  // unit gantry: posts at the corners of a 2x2 square, height 1; scaled per job
  const g = new THREE.Group(); g.name = 'game-print-gantry';
  const m = mat(0xe0e3e6, 0.4, 0.6);
  const post = new THREE.BoxGeometry(0.04, 1, 0.04).translate(0, 0.5, 0);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = new THREE.Mesh(post, m); p.position.set(x, 0, z); g.add(p); }
  const beam = new THREE.BoxGeometry(2, 0.04, 0.04);
  for (const z of [-1, 1]) { const b = new THREE.Mesh(beam, m); b.position.set(0, 1, z); g.add(b); }
  const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0x552200, roughness: 0.5 }));
  g.add(head); g.userData.head = head;
  return g;
}

function makeLayerTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 4; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#d6c7b6'; g.fillRect(0, 0, 4, 16);
  g.fillStyle = '#a89480'; g.fillRect(0, 12, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 30);             // ~5 cm print layers on a 1.5 m wall
  return t;
}
