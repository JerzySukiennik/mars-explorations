// Perseverance-class rover, simplified: warm electronics box, deck, MMRTG, rocker-bogie
// with six 52.5 cm wheels, stowed arm with turret, and the Remote Sensing Mast (RSM)
// carrying Mastcam-Z. Dimensions after NASA fact sheets: ~3.0 m long, 2.7 m wide,
// 2.2 m tall; Mastcam-Z optical axis ~2.0 m above the ground, stereo baseline 24.1 cm.
// Every part is built from unit boxes/cylinders so its matrixWorld doubles as an
// analytic shadow-casting proxy for the terrain shader.

export function buildRover(THREE) {
  const group = new THREE.Group(); group.name = 'rover';
  const casters = [];
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7, metalness: 0.0 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.8 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8b4ad, roughness: 0.35, metalness: 0.8 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);

  function box(parent, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0, cast = true) {
    const m = new THREE.Mesh(unitBox, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); if (cast) casters.push(m); return m;
  }
  function cyl(parent, mat, d, len, x, y, z, rx = 0, ry = 0, rz = 0, castProxy = true) {
    const m = new THREE.Mesh(unitCyl, mat); m.scale.set(d, len, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m);
    if (castProxy) { const p = new THREE.Object3D(); p.scale.set(d * 0.9, len, d * 0.9); p.position.copy(m.position); p.rotation.copy(m.rotation); parent.add(p); casters.push(p); }
    return m;
  }
  // body: rover frame +x right, +y up, -z forward
  box(group, white, 1.20, 0.55, 1.95, 0, 0.95, 0.05);            // warm electronics box
  box(group, grey, 1.30, 0.05, 2.05, 0, 1.25, 0.05, 0, 0, 0, false); // deck plate
  cyl(group, dark, 0.62, 0.70, 0, 1.30, 1.15, -0.55, 0, 0);       // MMRTG (tilted at the back)
  box(group, dark, 0.95, 0.10, 0.45, 0, 1.35, 1.25, -0.55, 0, 0);  // RTG fins envelope
  box(group, grey, 0.35, 0.25, 0.30, -0.35, 1.40, 0.55);          // deck equipment
  box(group, alu, 0.55, 0.05, 0.55, -0.35, 1.62, 0.20, 0, 0, 0.2); // high-gain antenna
  box(group, grey, 0.25, 0.30, 0.25, 0.30, 1.42, 0.60);
  // rocker-bogie + wheels
  const wheelZ = [-0.95, 0.0, 0.85];
  for (const sx of [-1, 1]) {
    box(group, alu, 0.06, 0.08, 1.9, sx * 0.80, 0.72, -0.05, 0.08 * sx, 0, 0);
    for (const wz of wheelZ) {
      cyl(group, alu, 0.525, 0.40, sx * 1.12, 0.2625, wz, 0, 0, Math.PI / 2);
      box(group, alu, 0.08, 0.45, 0.08, sx * 1.02, 0.50, wz, 0, 0, 0, false);
    }
  }
  // stowed robotic arm + turret at the front
  box(group, grey, 1.60, 0.08, 0.08, 0.0, 0.85, -1.05);
  box(group, grey, 0.50, 0.45, 0.40, -0.55, 0.85, -1.15);
  // Remote Sensing Mast at the front-right of the deck
  const mastBase = new THREE.Group(); mastBase.position.set(0.52, 1.25, -0.72); group.add(mastBase);
  box(mastBase, alu, 0.10, 0.62, 0.10, 0, 0.31, 0);
  const mastAz = new THREE.Group(); mastAz.position.set(0, 0.62, 0); mastBase.add(mastAz);
  box(mastAz, alu, 0.08, 0.10, 0.08, 0, 0.05, 0);
  const mastEl = new THREE.Group(); mastEl.position.set(0, 0.12, 0); mastAz.add(mastEl);
  box(mastEl, white, 0.42, 0.20, 0.22, 0, 0.0, 0.0);   // RSM head: Mastcam-Z pair, SuperCam
  box(mastEl, grey, 0.10, 0.10, 0.10, 0, 0.14, 0.02);
  // optical centre of the Mastcam-Z left eye (ZL): half the stereo baseline to the left
  const zl = new THREE.Object3D(); zl.position.set(-0.1206, 0.0, -0.12); mastEl.add(zl);
  const zr = new THREE.Object3D(); zr.position.set(0.1206, 0.0, -0.12); mastEl.add(zr);

  function setMast(azRad, elRad) { mastAz.rotation.y = -azRad; mastEl.rotation.x = elRad; }
  return { group, casters, mastAz, mastEl, mastcamL: zl, mastcamR: zr, setMast };
}
