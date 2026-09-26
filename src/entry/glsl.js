// GLSL snippets for the entry scene (onboard camera during atmospheric entry).
// Scene-linear radiance in "camera exposure units": the sensor pass maps
// channel values ~1 to near full scale.

export const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm2(vec2 p, int oct){
  float s = 0., a = .5, w = 0.;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * vnoise2(p); w += a; a *= .5; p = mat2(1.6,1.2,-1.2,1.6) * p + 1.7; }
  return s / w;
}
// hexagonal grid: returns (local offset from cell centre .xy, cell id .zw)
vec4 hexCell(vec2 p){
  const vec2 s = vec2(1., 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(.5, 1.)) / s.xyxy) + .5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + .5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + .5);
}
// distance from the hex centre to its edge measure (0 at centre, .5 at edge) for pointy-top hexes of unit spacing
float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(.5, .8660254)), p.x); }
`;

// Lighting environment common to hull, flap and fittings: point-like plasma
// sources (the shock layer beyond the windward edge and around the flap),
// broad pink radiance from the separated shear layer (for steel reflections),
// and the dim cloud deck below.
export const LIGHTING = /* glsl */`
#define NPL 10
uniform vec3 uPlPos[NPL];
uniform vec3 uPlCol[NPL];
uniform vec3 uNadir, uEarthCol, uCurtDir, uCurtCol, uFrontCol;
uniform float uHorizonCos;
vec3 envRad(vec3 d, float rough){
  float c = dot(d, uNadir);
  float w = .08 + rough * .6;
  vec3 e = uEarthCol * smoothstep(uHorizonCos - w, uHorizonCos + w, c) * (.55 + .45 * c);
  float k = 3. / (rough * 6. + .35);
  e += uCurtCol * pow(max(dot(d, uCurtDir), 0.), k) * (1. + k * .15) * .45;
  return e;
}
// sum of plasma point lights: returns diffuse irradiance (rgb) and adds GGX-ish specular into spec
vec3 plasmaLights(vec3 P, vec3 N, vec3 V, float rough, float F0, inout vec3 spec){
  vec3 dsum = vec3(0.);
  float a2 = max(rough * rough, .002); a2 *= a2;
  for (int i = 0; i < NPL; i++){
    vec3 L = uPlPos[i] - P; float d2 = dot(L, L) + .25; L *= inversesqrt(d2);
    float nl = max(dot(N, L), 0.);
    // soft wrap: the sources are extended (metres across), not points
    float nlw = max((dot(N, L) + .35) / 1.35, 0.);
    vec3 E = uPlCol[i] / d2;
    dsum += E * nlw;
    vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.);
    float D = a2 / (3.14159 * pow(nh * nh * (a2 - 1.) + 1., 2.));
    float F = F0 + (1. - F0) * pow(1. - max(dot(H, V), 0.), 5.);
    spec += E * nl * D * F * .25 / max(dot(N, V) * .5 + .5, .2);
  }
  return dsum;
}
`;
