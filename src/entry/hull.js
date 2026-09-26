// Close-up Starship hull for the onboard entry camera: stainless barrel with
// the black hexagonal TPS tiles on the windward half (stepped, hex-quantised
// tile boundary with a few white "crunch-wrap" / felt spots), weld rings,
// aft skirt, the aft flap with its tiled hinge fairing, and small fittings.
// Ship frame (= world frame of the scene): +z aft, -y windward belly, +x the
// camera side. All shading is from the plasma sources and the cloud deck
// (LIGHTING in glsl.js); there is no sun on the hull.
import { NOISE, LIGHTING } from './glsl.js';

export const R_SHIP = 4.5;

const VS = /* glsl */`
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vLN;
void main(){
  vL = position; vLN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.);
  vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */`
${NOISE}
${LIGHTING}
uniform int uMode;          // 0 barrel, 1 flap, 2 steel fitting, 3 tiled fairing, 4 aft cap
uniform vec3 uCamPos;
uniform float uTileEdge, uTileScale, uSteelF0, uAftZ, uExpo;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vLN;

struct Surf { float alb; float F0; float rough; vec3 N; float emis; };

Surf tiles(vec2 q, vec3 N, vec3 T, vec3 B){
  Surf s;
  vec4 h = hexCell(q / uTileScale);
  float e = hexDist(h.xy);                       // .5 at the tile edge
  float rnd = hash12(h.zw), rnd2 = hash12(h.zw + 17.3);
  float gap = smoothstep(.455, .49, e);
  // each tile is a slightly curved, slightly tilted glassy ceramic shell
  vec2 tilt = (hash22(h.zw + 3.1) - .5) * .09 + h.xy * .10;
  s.N = normalize(N + T * tilt.x + B * tilt.y);
  s.alb = mix(.035 + .02 * rnd, .018, gap);
  s.F0 = mix(.045, .02, gap);
  s.rough = mix(.16 + .12 * rnd2, .6, gap);
  s.emis = 0.;
  return s;
}

Surf steel(vec2 q, vec3 N, vec3 T, vec3 B, float seam){
  Surf s;
  float n = fbm2(q * vec2(.9, 3.5), 4), m = fbm2(q * 7. + 4., 3);
  s.N = N;
  // weld seams / ring joints: a raised bead with a darker heat-tinted rim
  float sb = seam;
  s.N = normalize(N + B * sb * .35);
  s.alb = .05 + .03 * m;
  s.F0 = uSteelF0 * (.75 + .35 * n) * (1. - .45 * abs(sb));
  s.rough = .22 + .25 * m;
  s.emis = 0.;
  return s;
}

vec3 shade(Surf s, vec3 P, vec3 V){
  vec3 spec = vec3(0.);
  vec3 dI = plasmaLights(P, s.N, V, s.rough, s.F0, spec);
  vec3 R = reflect(-V, s.N);
  float nv = max(dot(s.N, V), 0.);
  float F = s.F0 + (1. - s.F0) * pow(1. - nv, 5.) * (1. - s.rough);
  vec3 envS = envRad(R, s.rough) * F;
  // diffuse from the cloud deck (cosine-weighted, horizon-clipped)
  vec3 envD = uEarthCol * clamp(dot(s.N, uNadir) * .5 + .45, 0., 1.) * .6;
  return s.alb * (dI + envD) + spec + envS;
}

void main(){
  vec3 V = normalize(uCamPos - vP);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  Surf s;
  if (uMode == 0) {
    float phi = atan(vP.y, vP.x);
    vec2 q = vec2(phi * ${R_SHIP.toFixed(2)}, vP.z);
    vec3 T = vec3(-sin(phi), cos(phi), 0.), B = vec3(0., 0., 1.);
    // tile boundary quantised to whole hex tiles: a cell is tiled if its centre is windward of the edge
    vec4 h = hexCell(q / uTileScale);
    vec2 cc = (q / uTileScale - h.xy) * uTileScale;         // cell centre in (s, z)
    float edgeS = uTileEdge * ${R_SHIP.toFixed(2)} + .10 * sin(cc.y * 1.3) + .06 * (hash12(h.zw + 9.) - .5);
    bool tiled = cc.x < edgeS;
    // ring welds every 1.83 m (72-inch rings) and the aft skirt joint
    float zr = mod(vP.z + .4, 1.83) - .915;
    float seam = smoothstep(.02, 0., abs(zr)) * sign(zr);
    float zs = vP.z - (uAftZ - .95);
    seam += smoothstep(.035, 0., abs(zs)) * sign(zs);
    // longitudinal stringer seam on the lee side
    float ls = q.x - 2.9;
    seam += .6 * smoothstep(.025, 0., abs(ls));
    if (tiled) {
      s = tiles(q, N, T, B);
      // white felt / crunch-wrap showing at a few edge tiles
      float edgeCell = step(edgeS - uTileScale * .9, cc.x);
      if (edgeCell > .5 && hash12(h.zw + 41.) > .86) { s.alb = .55; s.F0 = .03; s.rough = .8; }
    } else {
      s = steel(q, N, T, B, seam);
      // soot / heat staining creeping from the tile edge onto the steel
      float st = smoothstep(.9, 0., q.x - edgeS) * (.6 + .4 * fbm2(q * 2., 3));
      s.F0 *= 1. - .55 * st; s.alb *= 1. - .3 * st;
    }
  } else if (uMode == 1 || uMode == 3) {
    // flap / hinge fairing: tiles on everything except the lee (+w) face
    vec3 an = abs(vLN);
    vec2 q = an.z > .5 ? vL.xy : (an.y > .5 ? vL.xz : vL.yz);
    vec3 T = normalize(cross(N, vec3(0., 0., 1.)) + 1e-4), B = cross(N, T);
    if (uMode == 1 && vLN.z < -.5) s = steel(vL.xy, N, T, B, 0.);
    else s = tiles(q * 1.0, N, T, B);
  } else if (uMode == 2) {
    vec3 T = normalize(cross(N, vec3(0., 0., 1.)) + 1e-4), B = cross(N, T);
    s = steel(vL.xy * 3., N, T, B, 0.);
    s.F0 *= .8; s.rough = .35;
  } else {
    s.alb = .03; s.F0 = .1; s.rough = .5; s.N = N; s.emis = 0.;
  }
  vec3 c = shade(s, vP, V);
  gl_FragColor = vec4(c, 1.);
}`;

export function makeHull(THREE, U, T) {
  const group = new THREE.Group();
  const mat = (mode) => new THREE.ShaderMaterial({
    uniforms: { ...U, uMode: { value: mode } }, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
  });
  const R = R_SHIP, L = T.aftZ;
  // barrel: from well forward of the camera to the aft skirt
  const zf = -45;
  const barrel = new THREE.CylinderGeometry(R, R, L - zf, 720, 24, true);
  barrel.rotateX(Math.PI / 2); barrel.translate(0, 0, (L + zf) / 2);
  group.add(new THREE.Mesh(barrel, mat(0)));
  const cap = new THREE.CircleGeometry(R, 256); cap.translate(0, 0, L);
  group.add(new THREE.Mesh(cap, mat(4)));

  // aft flap: hinge along z at azimuth phiF, extends outward (radial) with a
  // lee-side deflection; slightly tapered planform (trapezoid in u-v)
  const phiF = T.flapPhi;
  const fl = T.flapLen, fs = T.flapSpan, ft = T.flapThick;
  const flapG = new THREE.BoxGeometry(fs, fl, ft, 8, 16, 1);
  // taper: outer end shorter (leading edge swept back)
  const pos = flapG.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getX(i) / fs + .5, u = pos.getY(i);   // v: 0 root .. 1 tip
    if (u < 0) pos.setY(i, u + v * T.flapSweep);
    // round the thick leading/tip edges a touch
  }
  flapG.computeVertexNormals();
  flapG.translate(fs / 2, 0, 0);
  const flap = new THREE.Mesh(flapG, mat(1));
  // local frame: x = radial out, y = axial (+z world), z = thickness (tangential +phi = lee side)
  const pivot = new THREE.Group();
  pivot.position.set(R * Math.cos(phiF), R * Math.sin(phiF), L - T.flapAftGap - fl / 2);
  // build the basis explicitly
  const er = new THREE.Vector3(Math.cos(phiF), Math.sin(phiF), 0), ez = new THREE.Vector3(0, 0, 1), et = new THREE.Vector3(-Math.sin(phiF), Math.cos(phiF), 0);
  const dfl = T.flapDeflect;  // rotate about hinge (ez): + toward lee side
  const x1 = er.clone().multiplyScalar(Math.cos(dfl)).addScaledVector(et, Math.sin(dfl));
  const z1 = et.clone().multiplyScalar(-Math.cos(dfl)).addScaledVector(er, Math.sin(dfl)); // = x1 x ez (right-handed), windward normal
  pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x1, ez, z1));
  pivot.add(flap);
  group.add(pivot);

  // hinge fairing / flap root aeroshell ahead of the flap: tiled wedge on the hull
  const fw = new THREE.BoxGeometry(T.fairH, T.fairLen, T.fairW, 4, 12, 4);
  const fp = fw.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const u = fp.getY(i) / T.fairLen + .5;                  // 0 fore .. 1 aft
    const x = fp.getX(i);
    if (x > 0) fp.setX(i, -T.fairH / 2 + (x + T.fairH / 2) * Math.min(1, .05 + u * 1.4));
    fp.setZ(i, fp.getZ(i) * (.55 + .45 * u));
  }
  fw.computeVertexNormals();
  fw.translate(T.fairH / 2 - .05, 0, 0);
  const fair = new THREE.Mesh(fw, mat(3));
  const fpv = new THREE.Group();
  fpv.position.set(R * Math.cos(phiF), R * Math.sin(phiF), L - T.flapAftGap - fl - T.fairLen / 2 + .3);
  fpv.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(er, ez, et.clone().negate()));
  fpv.add(fair); group.add(fpv);

  // small steel fittings on the lee side near the aft end (vents, RCS/umbilical
  // covers, lift-point brackets): boxes sitting on the skin
  const fitMat = mat(2);
  const put = (phiDeg, z, w, l, h) => {
    const p = phiDeg * Math.PI / 180;
    const g = new THREE.BoxGeometry(h, l, w);
    const m = new THREE.Mesh(g, fitMat);
    const e1 = new THREE.Vector3(Math.cos(p), Math.sin(p), 0), e2 = new THREE.Vector3(-Math.sin(p), Math.cos(p), 0);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, ez, e2.clone().negate()));
    m.position.set((R + h / 2 - .01) * Math.cos(p), (R + h / 2 - .01) * Math.sin(p), z);
    group.add(m);
  };
  for (const f of T.fittings) put(...f);
  return group;
}
