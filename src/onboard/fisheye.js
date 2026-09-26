// Booster onboard camera model: equidistant fisheye (r = f * theta), as used by the
// small ruggedised wide-angle cameras bolted to Super Heavy. Everything is expressed in
// output-pixel units referenced to a 957 px wide frame and scaled to the real canvas.
//
// Camera frame: +X right, +Y up, -Z forward (three.js convention). Pixel y grows downward.

export const REF_W = 957;

export function makeFisheye(THREE, opts = {}) {
  const cam = {
    f: opts.f ?? 318,                // px / rad at REF_W
    cx: opts.cx ?? 478.5,            // optical centre (px)
    cy: opts.cy ?? 270,
    circleR: opts.circleR ?? 505,    // image-circle radius (px)
    circleCx: opts.circleCx ?? 492,
    circleCy: opts.circleCy ?? 282,
    quat: new THREE.Quaternion(),
  };
  cam.setEuler = (yawDeg, pitchDeg, rollDeg) => {
    const d = Math.PI / 180;
    cam.quat.setFromEuler(new THREE.Euler(pitchDeg * d, yawDeg * d, rollDeg * d, 'YXZ'));
    return cam;
  };
  cam.pixelToCamDir = (px, py) => {
    const dx = px - cam.cx, dy = cam.cy - py;
    const r = Math.hypot(dx, dy), th = r / cam.f, ph = Math.atan2(dy, dx);
    return new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), -Math.cos(th));
  };
  cam.pixelToWorldDir = (px, py) => cam.pixelToCamDir(px, py).applyQuaternion(cam.quat);
  cam.place = (px, py, dist) => cam.pixelToWorldDir(px, py).multiplyScalar(dist);
  cam.worldDirToPixel = (v) => {
    const c = v.clone().normalize().applyQuaternion(cam.quat.clone().invert());
    const th = Math.acos(Math.max(-1, Math.min(1, -c.z)));
    const ph = Math.atan2(c.y, c.x);
    return [cam.cx + cam.f * th * Math.cos(ph), cam.cy - cam.f * th * Math.sin(ph)];
  };
  return cam;
}

// GLSL: pixel (in REF_W units, y down) -> camera-space direction
export const FISHEYE_GLSL = /* glsl */`
uniform float uF; uniform vec2 uC; uniform mat3 uCamRot;
vec3 pixelDir(vec2 p){
  vec2 d = vec2(p.x - uC.x, uC.y - p.y);
  float r = length(d); float th = r / uF;
  vec2 u = r > 1e-6 ? d / r : vec2(1.0, 0.0);
  return vec3(sin(th) * u, -cos(th));
}
`;
