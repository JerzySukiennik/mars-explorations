// Close-up booster hardware seen by the onboard camera. Filled in below.
export function buildHardware(THREE, fish, { sun, sunCol, seed }) {
  const group = new THREE.Group();
  const plumeDir = new THREE.Vector3(0, 1, 0);
  return { group, plumeDir };
}
