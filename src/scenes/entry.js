// Scene: entry. Placeholder until its builder replaces it.
export async function create({ THREE, renderer }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1e7);
  camera.position.set(0, 2, 6);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 5, 2); scene.add(sun);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 })));
  return { scene, camera, update() {}, async shot() {} };
}
