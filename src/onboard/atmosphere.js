// Earth + atmosphere seen from ~72 km: single-scattering Rayleigh + Mie + ozone absorption,
// spherical Earth (R = 6371 km) so limb dip / curvature follow from geometry, Earth-shadowed
// light paths (sun near the horizon at this T+ for an evening launch), a procedural cloud deck
// on a dusk ocean. Units: metres, Earth-centred frame whose +Y is the local vertical at the camera.

export const R_EARTH = 6371e3;
export const R_ATM = 6471e3;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];   // Rayleigh scattering (Bruneton 2017)
const HR = 8000;
const BM = 3.996e-6, BM_EXT = 4.44e-6, HM = 1200;
const BO = [0.650e-6, 1.881e-6, 0.085e-6];    // ozone absorption

function ozone(h) { return Math.max(0, 1 - Math.abs(h - 25e3) / 15e3); }

function raySphere(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

// Transmittance from point ro along rd to space (0 if the Earth blocks it). JS mirror of the GLSL.
export function transmittance(ro, rd, steps = 200) {
  const g = raySphere(ro, rd, R_EARTH);
  if (g && g[0] > 0) return [0, 0, 0];
  const a = raySphere(ro, rd, R_ATM);
  if (!a) return [1, 1, 1];
  const L = a[1], dt = L / steps;
  let dr = 0, dm = 0, dozo = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const p = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const h = Math.hypot(p[0], p[1], p[2]) - R_EARTH;
    dr += Math.exp(-h / HR) * dt; dm += Math.exp(-h / HM) * dt; dozo += ozone(h) * dt;
  }
  return [0, 1, 2].map(i => Math.exp(-(BR[i] * dr + BM_EXT * dm + BO[i] * dozo)));
}

export const ATMOS_GLSL = /* glsl */`
uniform vec3 uCamE;      // camera position, Earth-centred (m)
uniform vec3 uSun;       // unit vector to the sun (world == Earth frame orientation)
uniform float uSunI;     // solar irradiance scale
uniform float uSeed;
const float RE = 6371e3; const float RA = 6471e3;
const vec3 BR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float HR = 8000.0;
const float BM = 3.996e-6; const float BMX = 4.44e-6; const float HM = 1200.0;
const vec3 BO = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float PI = 3.14159265;

vec2 rsph(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(1e30, -1e30);
  float s = sqrt(d); return vec2(-b - s, -b + s);
}
vec3 densities(vec3 p){
  float h = length(p) - RE;
  return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25e3) / 15e3));
}
// optical depth (rayleigh, mie, ozone) from p toward the sun; x<0 flags Earth shadow
vec3 lightDepth(vec3 p, vec3 l){
  vec2 g = rsph(p, l, RE);
  if (g.x > 0.0 && g.x < 1e29) return vec3(-1.0);
  vec2 a = rsph(p, l, RA);
  float L = a.y; float dt = L / 8.0; vec3 od = vec3(0.0);
  for (int j = 0; j < 8; j++) od += densities(p + l * (float(j) + 0.5) * dt) * dt;
  return od;
}
vec3 odTrans(vec3 od){ return exp(-(BR * od.x + BMX * od.y + BO * od.z)); }

float h31(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419) + uSeed); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

// returns radiance (arbitrary linear units, sun irradiance = uSunI)
vec3 atmosphere(vec3 rd, out float hitSurface){
  vec3 ro = uCamE;
  vec2 a = rsph(ro, rd, RA);
  float tEnd = a.y;
  vec2 g = rsph(ro, rd, RE);
  hitSurface = 0.0;
  const float HC = 7000.0;   // cloud-top shell
  vec2 gc = rsph(ro, rd, RE + HC);
  float tSurf = 1e30; vec3 surfAlbedo = vec3(0.0); vec3 surfN = vec3(0.0);
  if (gc.x > 0.0 && gc.x < 1e29){
    vec3 pc = ro + rd * gc.x; vec3 n = normalize(pc);
    // cloud field: stratocumulus cells + larger organisation (scale in km)
    vec3 q = n * RE / 1000.0;
    float big = fbm(q / 180.0);
    float cell = fbm(q / 22.0 + big * 2.0);
    float cov = smoothstep(0.50, 0.66, cell * 0.65 + big * 0.55);
    if (cov > 0.02){ tSurf = gc.x; surfAlbedo = vec3(0.72) * cov; surfN = n; }
    if (g.x > 0.0 && g.x < 1e29 && cov <= 0.02){ tSurf = g.x; surfAlbedo = vec3(0.035, 0.045, 0.06); surfN = normalize(ro + rd * g.x); }
    else if (g.x > 0.0 && g.x < 1e29 && cov < 0.98){
      // thin cloud: blend ocean seen through
      surfAlbedo += (1.0 - cov) * vec3(0.035, 0.045, 0.06);
    }
  }
  if (tSurf < 1e29) { tEnd = tSurf; hitSurface = 1.0; }
  const int N = 72;
  float dt = tEnd / float(N);
  vec3 odv = vec3(0.0); vec3 sumR = vec3(0.0); vec3 sumM = vec3(0.0);
  float mu = dot(rd, uSun);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float gg = 0.76;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - gg * gg) * (1.0 + mu * mu)) / ((2.0 + gg * gg) * pow(1.0 + gg * gg - 2.0 * gg * mu, 1.5));
  for (int i = 0; i < N; i++){
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    vec3 d = densities(p) * dt;
    odv += d;
    vec3 ld = lightDepth(p, uSun);
    if (ld.x < 0.0) continue;
    vec3 T = odTrans(odv - 0.5 * d + ld);
    sumR += T * d.x; sumM += T * d.y;
  }
  vec3 col = uSunI * (sumR * BR * pR + sumM * BM * pM);
  // weak multiple-scattering / twilight airglow floor so the night side is not pure zero
  col += uSunI * 2.0e-4 * vec3(0.25, 0.35, 0.6) * (1.0 - exp(-odv.x * 1.2e-5));
  if (hitSurface > 0.5){
    vec3 ps = ro + rd * tEnd;
    vec3 ld = lightDepth(ps + surfN * 50.0, uSun);
    float ndl = max(dot(surfN, uSun), 0.0);
    // clouds catch grazing light: add a little so terminator clouds glow
    float wrap = clamp((dot(surfN, uSun) + 0.06) / 1.06, 0.0, 1.0);
    vec3 Ts = ld.x < 0.0 ? vec3(0.0) : odTrans(ld);
    vec3 surf = uSunI * Ts * surfAlbedo / PI * wrap;
    surf += uSunI * 1.2e-4 * surfAlbedo;       // twilight skylight
    col += surf * odTrans(odv);
  }
  return col;
}
`;
