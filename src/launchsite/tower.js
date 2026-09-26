// Starbase launch towers ("Mechazilla"): square steel lattice with X-bracing,
// catch arms ("chopsticks") on a carriage, the ship quick-disconnect arm, and
// the orbital launch mount (OLM) table. Built from instanced box members.

function addMember(list, a, b, t) { list.push({ a, b, t }); }

function latticeMembers(THREE, H, w, sec, leg = 1.3, brace = 0.55) {
  const L = [];
  const hw = w / 2;
  const c = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [x, z] of c) addMember(L, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, H, z), leg);
  const n = Math.round(H / sec);
  for (let i = 0; i <= n; i++) {
    const y = i * H / n;
    for (let f = 0; f < 4; f++) {
      const [x0, z0] = c[f], [x1, z1] = c[(f + 1) % 4];
      addMember(L, new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1), brace * 1.3);
      if (i < n) {
        const y1 = (i + 1) * H / n;
        addMember(L, new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y1, z1), brace);
        addMember(L, new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y1, z0), brace);
      }
    }
  }
  return L;
}

function trussArm(THREE, L, origin, dir, len, h, wid) {
  // box truss: 4 chords + zig-zag webbing, dir = unit horizontal vector
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(wid / 2);
  const up = new THREE.Vector3(0, h / 2, 0);
  const chords = [side.clone().add(up), side.clone().sub(up), side.clone().negate().add(up), side.clone().negate().sub(up)];
  for (const cc of chords) addMember(L, origin.clone().add(cc), origin.clone().add(cc).addScaledVector(dir, len), 0.7);
  const n = Math.round(len / 3.2);
  for (let i = 0; i < n; i++) {
    const p0 = origin.clone().addScaledVector(dir, len * i / n), p1 = origin.clone().addScaledVector(dir, len * (i + 1) / n);
    for (const [a, b] of [[0, 1], [2, 3], [0, 2]]) {
      addMember(L, p0.clone().add(chords[a]), p1.clone().add(chords[b]), 0.35);
    }
    addMember(L, p0.clone().add(chords[0]), p0.clone().add(chords[1]), 0.35);
  }
}

export function buildMembers(THREE, list, mat) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const im = new THREE.InstancedMesh(g, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  list.forEach(({ a, b, t }, i) => {
    const d = b.clone().sub(a); const len = d.length();
    q.setFromUnitVectors(yAxis, d.clone().normalize());
    m.compose(a.clone().add(b).multiplyScalar(.5), q, new THREE.Vector3(t, len, t));
    im.setMatrixAt(i, m);
  });
  im.frustumCulled = false;
  return im;
}

/**
 * opts: { H, w, armY, armOpen (rad), armLen, faceDir (unit vector toward OLM), withArms }
 */
export function makeTower(THREE, mat, darkMat, { H = 146, w = 11, armY = 118, armOpen = 0.32, armLen = 36, faceDir, withArms = true, qdY = 128 } = {}) {
  const grp = new THREE.Group();
  const L = latticeMembers(THREE, H, w, 7.3, 1.5, 0.65);
  // top cap / lightning mast
  // top platform
  addMember(L, new THREE.Vector3(-w / 2, H, 0), new THREE.Vector3(w / 2, H, 0), 1.6);
  if (withArms) {
    const f = faceDir.clone().normalize();
    const side = new THREE.Vector3(-f.z, 0, f.x);
    // carriage (box frame on the face)
    const cy = armY;
    const face = f.clone().multiplyScalar(w / 2 + 1.2);
    for (const sy of [-4, 4]) for (const sx of [-1, 1])
      addMember(L, face.clone().addScaledVector(side, sx * (w / 2 + 1)).add(new THREE.Vector3(0, cy - 4, 0)),
        face.clone().addScaledVector(side, sx * (w / 2 + 1)).add(new THREE.Vector3(0, cy + 4, 0)), 1.0);
    addMember(L, face.clone().addScaledVector(side, -(w / 2 + 1)).add(new THREE.Vector3(0, cy + 4, 0)), face.clone().addScaledVector(side, (w / 2 + 1)).add(new THREE.Vector3(0, cy + 4, 0)), 1.0);
    addMember(L, face.clone().addScaledVector(side, -(w / 2 + 1)).add(new THREE.Vector3(0, cy - 4, 0)), face.clone().addScaledVector(side, (w / 2 + 1)).add(new THREE.Vector3(0, cy - 4, 0)), 1.0);
    // chopsticks: two arms pivoting at the carriage edges, opened by armOpen
    for (const sx of [-1, 1]) {
      const pivot = face.clone().addScaledVector(side, sx * (w / 2 + 1)).add(new THREE.Vector3(0, cy, 0));
      const dir = f.clone().multiplyScalar(Math.cos(armOpen)).addScaledVector(side, sx * Math.sin(armOpen)).normalize();
      trussArm(THREE, L, pivot, dir, armLen, 6.5, 3.0);
    }
    // ship quick-disconnect arm (swung back against the tower for flight)
    const qd = face.clone().add(new THREE.Vector3(0, qdY, 0));
    trussArm(THREE, L, qd, f.clone().addScaledVector(side, -0.25).normalize(), 13, 2.6, 2.2);
  }
  grp.add(buildMembers(THREE, L, mat));
  return grp;
}

export function makeOLM(THREE, mat) {
  // orbital launch mount: 6 legs + table ring (engine plane rests ~21 m up)
  const L = [];
  const R = 11, top = 19.5;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    addMember(L, new THREE.Vector3(x, 0, z), new THREE.Vector3(x * .8, top, z * .8), 3.2);
  }
  const grp = new THREE.Group();
  grp.add(buildMembers(THREE, L, mat));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 3.5, 32, 1, true), mat);
  ring.position.y = top; grp.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(10.5, 1.3, 8, 32), mat);
  ring2.rotation.x = Math.PI / 2; ring2.position.y = top + 1.5; grp.add(ring2);
  return grp;
}
