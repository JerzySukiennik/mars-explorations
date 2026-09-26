// Shared helpers for phase controllers: scene hooks and camera tracking.

/** Call a scene hook if the scene exposes it. Returns true when handled. */
export function hook(ctx, name, ...args) {
  const f = ctx && ctx[name];
  if (typeof f !== 'function') return false;
  try { f.apply(ctx, args); return true; } catch (e) { console.warn(`[game] scene hook ${name} threw`, e); return false; }
}

/** First Object3D-like property the scene exposes among names. */
export function sceneObject(ctx, ...names) {
  for (const n of names) { const o = ctx?.[n]; if (o && o.position && typeof o.position.set === 'function') return o; }
  return null;
}

/**
 * Camera tracker: 'scene' leaves the scene's camera alone; 'track' keeps the
 * camera's original viewing direction but follows the target, keeping it in
 * frame at a given distance.
 */
export function createTracker(THREE, camera) {
  const home = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  let mode = 'scene';
  return {
    get mode() { return mode; },
    set(m) {
      mode = m;
      if (m === 'scene') { camera.position.copy(home.pos); camera.quaternion.copy(home.quat); camera.fov = home.fov; camera.updateProjectionMatrix(); }
    },
    /** Follow target (Object3D) at distance d, looking from the home direction. */
    follow(target, d, heightBias = 0) {
      if (mode !== 'track' || !target) return;
      target.getWorldPosition(tmp);
      dir.copy(home.pos).sub(tmp);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
      dir.normalize().multiplyScalar(d);
      camera.position.copy(tmp).add(dir); camera.position.y += heightBias;
      camera.lookAt(tmp);
    },
  };
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
