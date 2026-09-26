// Loads the physics modules the game can use. Each is imported on its own with
// dynamic import() so a missing or broken module (other teams are still
// editing src/physics/*) degrades that feature to its built-in fallback
// instead of breaking the page. Modules are returned as namespaces; callers
// feature-detect individual exports.

const MODULES = {
  V: '../physics/vehicle.js',
  B: '../physics/mars_body.js',
  A: '../physics/mars_atmosphere.js',
  T: '../physics/transfer.js',
  E: '../physics/ephemeris.js',
  L: '../physics/lambert.js',
  RV: '../physics/rover.js',
  PR: '../physics/printer.js',
  R: '../physics/refill.js',          // optional: propellant transfer / boil-off
  X: '../physics/entry.js',           // optional: entry heating / aero
  AS: '../physics/ascent.js',         // optional: ascent model
};

let cache = null;

export async function loadPhysics() {
  if (cache) return cache;
  const keys = Object.keys(MODULES);
  const res = await Promise.allSettled(keys.map((k) => import(MODULES[k])));
  const deps = { available: {}, missing: [] };
  res.forEach((r, i) => {
    const k = keys[i];
    if (r.status === 'fulfilled') { deps[k] = r.value; deps.available[k] = MODULES[k].replace('../', 'src/'); }
    else { deps[k] = null; deps.missing.push(MODULES[k].replace('../', 'src/')); }
  });
  cache = deps;
  return deps;
}
