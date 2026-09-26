// Scene router. ?scene=<id> picks a scene; ?shot=<id> selects a fixed, deterministic
// camera shot inside that scene for the critic harness (tools/shoot.mjs).
// Every scene module exports: async create({renderer, params}) -> {scene, camera, update(dt), shots?}
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const sceneId = params.get('scene') || 'menu';
const shotId = params.get('shot');
if (shotId) document.body.classList.add('shot');

const SCENES = {
  menu: () => import('./scenes/menu.js'),
  launch: () => import('./scenes/launch.js'),
  orbit: () => import('./scenes/orbit.js'),
  refill: () => import('./scenes/refill.js'),
  transfer: () => import('./scenes/transfer.js'),
  entry: () => import('./scenes/entry.js'),
  landing: () => import('./scenes/landing.js'),
  surface: () => import('./scenes/surface.js'),
  onboard: () => import('./scenes/onboard.js'),
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!shotId, powerPreference: 'high-performance' });
renderer.setPixelRatio(shotId ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const loader = SCENES[sceneId] || SCENES.menu;
const mod = await loader();
const ctx = await mod.create({ renderer, params, THREE, hud: document.getElementById('hud') });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  ctx.camera.aspect = innerWidth / innerHeight;
  ctx.camera.updateProjectionMatrix();
});

if (shotId) {
  // Deterministic capture: let the scene set itself up for the shot, step the sim, render once.
  if (ctx.shot) await ctx.shot(shotId);
  (ctx.render || (() => renderer.render(ctx.scene, ctx.camera)))();
  window.__SHOT_READY = true;
} else {
  let last = performance.now();
  renderer.setAnimationLoop((t) => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    ctx.update?.(dt);
    (ctx.render || (() => renderer.render(ctx.scene, ctx.camera)))();
  });
}
