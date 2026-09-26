// Earth as seen from low Earth orbit, shaded analytically per view ray:
//  - spherical Earth (R = 6371 km) with NASA Blue Marble albedo (generic, cloud-free)
//  - ocean: dark water body + shallow-bank brightening from the albedo map,
//    Cox-Munk sun glint (wind ~6 m/s) with wave-facet glitter
//  - boundary-layer cumulus / thin cirrus layer from footprint-aware 3D noise,
//    lit by the (reddened) low sun with sun-side rim brightening and shadows
//  - single-scattering atmosphere: Rayleigh + Mie + ozone absorption, 16-step
//    view march, Chapman-function sun transmittance (gives the Earth shadow and
//    the reddening of a low sun), bright limb haze where the ray grazes.
// Units: km. Radiance is in "sun = 1" units; the camera exposure scales it.
// The same GLSL drives the fisheye camera pass and the env-map sky sphere.

export const EARTH_R = 6371.0;

export const EARTH_GLSL = /* glsl */`
uniform sampler2D tEarth;
uniform mat3 uEarthRot;      // world -> earth-fixed (ECEF-like, z = north pole)
uniform vec3 uNadir;         // world unit vector from camera toward Earth centre
uniform float uAlt;          // camera altitude, km
uniform vec3 uSun;           // world unit vector toward the sun
uniform float uPixAng;       // radians per output pixel near the axis (footprint)
uniform float uCloudSeed;

const float ER = 6371.0;
const float AT = 80.0;       // top of the marched atmosphere, km
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);   // Rayleigh scattering, 1/km at sea level
const float HR = 8.0;
const vec3 BM = vec3(8.0e-3);                           // Mie (maritime aerosol) scattering, 1/km
const vec3 BMe = vec3(9.0e-3);
const float HM = 1.4;
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);     // ozone absorption at the 25 km peak, 1/km
const float PI = 3.14159265;

float eh13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float en3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  return mix(mix(mix(eh13(i), eh13(i+vec3(1,0,0)), u.x), mix(eh13(i+vec3(0,1,0)), eh13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(eh13(i+vec3(0,0,1)), eh13(i+vec3(1,0,1)), u.x), mix(eh13(i+vec3(0,1,1)), eh13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
// fbm with octave fade by footprint (fp = footprint in noise units at octave 0)
float efbm(vec3 p, float fp, int oct){
  float s = 0., a = .5, w = 0., f = 1.;
  for (int i = 0; i < 9; i++){
    if (i >= oct) break;
    float fade = 1. - smoothstep(.3, .8, fp * f);
    s += a * mix(.5, en3(p * f), fade); w += a;
    f *= 2.07; a *= .52;
    p = p.yzx * vec3(1.01, .99, 1.) + vec3(1.7, 9.2, 4.1);
  }
  return s / w;
}

vec2 sphHit(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd); float cc = dot(oc, oc) - r*r; float h = b*b - cc;
  if (h < 0.) return vec2(-1.);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
// Schuler's Chapman-function approximation: returns airmass * density at the point
float chapman(float X, float h, float cz){
  float c = sqrt(X + h);
  if (cz >= 0.) return c / (c * cz + 1.) * exp(-h);
  float x0 = sqrt(1. - cz*cz) * (X + h); float c0 = sqrt(x0);
  return 2. * c0 * exp(X - x0) - c / (1. - c * cz) * exp(-h);
}
float ozoneProfile(float h){ return max(0., 1. - abs(h - 25.) / 15.); }
// transmittance from a point at altitude h (km) with sun zenith cosine cz
vec3 sunTrans(float h, float cz){
  float tR = HR * chapman(ER / HR, h / HR, cz);
  float tM = HM * chapman(ER / HM, h / HM, cz);
  // ozone: slab ~30 km thick above most points, airmass from the Rayleigh ratio
  float am = tR / (HR * exp(-h / HR));
  float tO = 15. * (h < 40. ? 1. : 0.) * min(am, 40.);
  return exp(-(BR * tR + BMe * tM + BO * tO));
}
float phaseR(float mu){ return 3. / (16. * PI) * (1. + mu*mu); }
float phaseM(float mu){ float g = .76; float g2 = g*g;
  return 3. / (8. * PI) * (1. - g2) * (1. + mu*mu) / ((2. + g2) * pow(1. + g2 - 2. * g * mu, 1.5)); }

// cloud density at an earth-fixed point q (km), footprint fp (km)
float cloudDen(vec3 q, float fp){
  vec3 s = q + uCloudSeed * 13.7;
  // regime: trade cumulus fields with clear lanes, organised on ~150-400 km
  float reg = efbm(s / 260., fp / 260., 3);
  float reg2 = efbm(s / 70. + 3.1, fp / 70., 3);
  // cumulus cells ~1-4 km
  float cu = efbm(s / 5.5, fp / 5.5, 5);
  float cov = smoothstep(.40, .70, reg) * .75 + smoothstep(.45, .8, reg2) * .45;
  float c = smoothstep(.60 - .22 * cov, .76 - .18 * cov, cu + .12 * cov);
  // thin stratiform/cirrus veils: stretched noise
  float ci = efbm(vec3(s.x / 60., s.y / 18., s.z / 60.) + 7.3, fp / 18., 5);
  float veil = smoothstep(.56, .78, ci) * smoothstep(.45, .7, reg2) * .35;
  return clamp(c * (.35 + .75 * cov) + veil, 0., 1.);
}

// radiance arriving at the camera (at the origin) along world direction rd
vec3 earthRadiance(vec3 rd, out float hitGround){
  vec3 C = uNadir * (ER + uAlt);
  vec2 ta = sphHit(vec3(0.), rd, C, ER + AT);
  hitGround = 0.;
  if (ta.y < 0.) return vec3(0.);
  vec2 tg = sphHit(vec3(0.), rd, C, ER);
  float t0 = max(ta.x, 0.), t1 = ta.y;
  bool ground = tg.x > 0.;
  if (ground) t1 = tg.x;
  hitGround = ground ? 1. : 0.;
  // view march (exponentially spaced toward the far end where density is)
  const int N = 16;
  vec3 Lp = vec3(0.), tauV = vec3(0.);
  float mu = dot(rd, uSun);
  float pR = phaseR(mu), pM = phaseM(mu);
  float prevT = t0;
  for (int i = 0; i < N; i++){
    float a = (float(i) + .5) / float(N);
    float ai = (float(i) + 1.) / float(N);
    float t = mix(t0, t1, 1. - pow(1. - a, 2.2));
    float tn = mix(t0, t1, 1. - pow(1. - ai, 2.2));
    float dt = tn - prevT; prevT = tn;
    vec3 p = rd * t - C; float r = length(p); float h = max(r - ER, 0.);
    float dR = exp(-h / HR), dM = exp(-h / HM), dO = ozoneProfile(h);
    vec3 ext = BR * dR + BMe * dM + BO * dO;
    vec3 Ts = sunTrans(h, dot(p / r, uSun));
    vec3 Tv = exp(-(tauV + ext * dt * .5));
    Lp += Tv * Ts * (BR * dR * pR + BM * dM * pM) * dt;
    tauV += ext * dt;
  }
  vec3 Tview = exp(-tauV);
  if (!ground) return Lp;

  // ---- surface ----
  vec3 P = rd * t1 - C; vec3 N = normalize(P);
  vec3 e = uEarthRot * N;
  float lat = asin(clamp(e.z, -1., 1.)), lon = atan(e.y, e.x);
  vec2 uv = vec2(lon / (2. * PI) + .5, .5 + lat / PI);
  vec3 tex = texture2D(tEarth, uv).rgb;            // linear (sRGB-decoded)
  float cz = dot(N, uSun);
  vec3 Tsg = sunTrans(0.02, cz);
  float muv = max(dot(N, -rd), 1e-3);
  // footprint (km) of one pixel on the ground
  float fp = t1 * uPixAng / sqrt(muv);
  vec3 q = e * ER;
  // water / land split from the albedo map (Blue Marble ocean is a flat navy)
  float water = smoothstep(.02, .06, tex.b - max(tex.r, tex.g) * 1.1) * (1. - smoothstep(.12, .25, tex.r));
  vec3 deep = vec3(.0105, .0215, .034);
  // shallow carbonate banks: brightness above the deep-ocean navy, turquoise-ish
  vec3 bank = max(tex - vec3(.004, .010, .06), 0.) * vec3(.55, .75, .55);
  float bankN = efbm(q / 3.0 + 11., fp / 3.0, 5);
  bank *= .7 + .6 * bankN;
  vec3 albW = deep + bank;
  vec3 albL = tex * 1.05;
  vec3 alb = mix(albL, albW, water);
  // sky + direct illumination of the ground
  float skyAmb = .06 * smoothstep(-.12, .3, cz) + .02;
  vec3 skyE = vec3(.55, .75, 1.) * skyAmb;
  vec3 Ld = alb / PI * (Tsg * max(cz, 0.) + skyE);
  // sun glint (Cox-Munk isotropic, wind 6.5 m/s), glitter from wave facets
  vec3 H = normalize(uSun - rd);
  float cb = max(dot(H, N), 1e-3);
  float tb2 = (1. - cb*cb) / (cb*cb);
  float s2 = .003 + .00512 * 6.5;
  float gl = efbm(q * 2.5, fp * 2.5, 4);
  float s2l = s2 * (.75 + .5 * gl);
  float pdf = exp(-tb2 / s2l) / (PI * s2l * cb*cb*cb*cb);
  float cosi = max(dot(uSun, H), 0.);
  float F = .02 + .98 * pow(1. - cosi, 5.);
  vec3 Lg = Tsg * F * pdf / (4. * muv) * step(0., cz) * water;
  vec3 Ls = Ld + Lg;
  // ---- clouds ----
  float cd = cloudDen(q, fp);
  if (cd > .002){
    // sun-side rim: less cloud toward the sun -> lit face, more -> self-shadowed
    vec3 sh = normalize(uSun - N * cz);             // horizontal toward sun
    vec3 shE = uEarthRot * sh;
    float cdS = cloudDen(q + shE * 1.6, fp);
    float lit = clamp(.62 + 1.4 * (cd - cdS), .1, 1.25);
    // low sun: cloud tops at ~1.5 km see a slightly less reddened sun
    vec3 Tsc = sunTrans(1.5, cz + .02);
    float sunCos = max(cz + .06, 0.);               // turrets catch the low sun on their flanks
    vec3 Lc = Tsc * (.30 + .9 * sunCos) * lit * .55 + skyE * .9;
    Ls = mix(Ls, Lc, smoothstep(0., .55, cd));
  }
  // cloud shadows cast downsun (long for a low sun)
  float tanE = max(cz, .02) / sqrt(max(1. - cz*cz, 1e-4));
  vec3 sh2 = normalize(uSun - N * cz);
  float shd = cloudDen(q + (uEarthRot * sh2) * (1.2 / tanE), fp * 2.);
  Ls *= 1. - .55 * smoothstep(.1, .6, shd) * (1. - smoothstep(0., .5, cd));
  return Ls * Tview + Lp;
}
`;

// Builds the world->earth-fixed rotation for a camera whose nadir sits at
// (lat, lon) and whose world direction `aftWorld` points toward azimuth azDeg.
export function earthFrame(THREE, { nadir, latDeg, lonDeg, refWorld, refAzDeg, sunElDeg, sunAzDeg }) {
  const d2r = Math.PI / 180;
  const U = nadir.clone().negate().normalize();
  const A = refWorld.clone().addScaledVector(U, -refWorld.dot(U)).normalize();
  const B = new THREE.Vector3().crossVectors(U, A);
  const az = refAzDeg * d2r;
  const E = A.clone().multiplyScalar(Math.sin(az)).addScaledVector(B, -Math.cos(az));
  const N = A.clone().multiplyScalar(Math.cos(az)).addScaledVector(B, Math.sin(az));
  const phi = latDeg * d2r, lam = lonDeg * d2r;
  const Ue = new THREE.Vector3(Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi));
  const Ee = new THREE.Vector3(-Math.sin(lam), Math.cos(lam), 0);
  const Ne = new THREE.Vector3(-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi));
  // M = [Ee Ne Ue] * [E N U]^T
  const Me = new THREE.Matrix3().set(Ee.x, Ne.x, Ue.x, Ee.y, Ne.y, Ue.y, Ee.z, Ne.z, Ue.z);
  const Mw = new THREE.Matrix3().set(E.x, E.y, E.z, N.x, N.y, N.z, U.x, U.y, U.z);
  const rot = Me.multiply(Mw);
  const se = sunElDeg * d2r, sa = sunAzDeg * d2r;
  const sun = E.clone().multiplyScalar(Math.cos(se) * Math.sin(sa)).addScaledVector(N, Math.cos(se) * Math.cos(sa)).addScaledVector(U, Math.sin(se)).normalize();
  return { rot, sun, E, N, U };
}

export async function loadEarthTexture(THREE, renderer) {
  const tex = await new THREE.TextureLoader().loadAsync('./assets/earth_bluemarble_8k.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}

// Background sphere using the same shading (for PMREM environment capture
// and for ordinary perspective views in play mode).
export function makeEarthSkyMaterial(THREE, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.)).xyz); vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.)).xyz, 1.); gl_Position = p.xyww; }`,
    fragmentShader: EARTH_GLSL + /* glsl */`
      varying vec3 vDir;
      void main(){ float hg; vec3 L = earthRadiance(normalize(vDir), hg); gl_FragColor = vec4(L, 1.); }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
}
