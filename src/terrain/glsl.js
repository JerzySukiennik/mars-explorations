// Shared GLSL for the Mars surface terrain: hashing, gradient noise (with analytic
// derivatives), Voronoi, and the procedural height function of the Jezero-floor-like
// ground: basaltic sand with impact ripples, light-toned fractured bedrock slabs that
// are partially buried by the sand, and loose angular rocks drawn from the Golombek
// (Viking/Pathfinder/MER-derived) rock size-frequency model.
//
// Everything is seeded and pure (no time), so shots are deterministic.

export const NOISE_GLSL = /* glsl */`
#define PI 3.14159265359
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint hash3u(ivec2 c, uint s){ return pcg(uint(c.x) + pcg(uint(c.y) + pcg(s))); }
float rnd(ivec2 c, uint s){ return float(hash3u(c, s) >> 8u) * (1.0 / 16777216.0); }
vec2 rnd2(ivec2 c, uint s){ uint h = hash3u(c, s); return vec2(float(h & 0xffffu), float(h >> 16u)) * (1.0 / 65536.0); }
vec2 grad2(ivec2 c, uint s){ float a = rnd(c, s) * 6.2831853; return vec2(cos(a), sin(a)); }

// gradient noise, value in ~[-1,1], with analytic derivatives: vec3(n, dn/dx, dn/dy)
vec3 gnoised(vec2 p, uint s){
  vec2 i = floor(p); vec2 f = p - i; ivec2 c = ivec2(i);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga = grad2(c, s), gb = grad2(c+ivec2(1,0), s), gc = grad2(c+ivec2(0,1), s), gd = grad2(c+ivec2(1,1), s);
  float va = dot(ga, f), vb = dot(gb, f-vec2(1,0)), vc = dot(gc, f-vec2(0,1)), vd = dot(gd, f-vec2(1,1));
  float k = va - vb - vc + vd;
  float v = va + u.x*(vb-va) + u.y*(vc-va) + u.x*u.y*k;
  vec2 d = ga + u.x*(gb-ga) + u.y*(gc-ga) + u.x*u.y*(ga-gb-gc+gd) + du*(u.yx*k + vec2(vb-va, vc-va));
  return vec3(v, d) * 1.5;
}
float gnoise(vec2 p, uint s){ return gnoised(p, s).x; }
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm(vec2 p, int oct, uint s){
  float a = 0.5, v = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; v += a * gnoise(p, s + uint(i) * 101u); p = ROT * p * 2.03; a *= 0.5; }
  return v;
}
// fbm with derivative (w.r.t. the input p)
vec3 fbmd(vec2 p, int oct, uint s, float gain){
  float a = 0.5; vec3 v = vec3(0.0); mat2 m = mat2(1.0); float f = 1.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    vec3 n = gnoised(p, s + uint(i) * 101u);
    v.x += a * n.x; v.yz += a * f * (transpose(m) * n.yz);
    p = ROT * p * 2.03; m = ROT * m; f *= 2.03; a *= gain;
  }
  return v;
}
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
`;

// Height function. Units: metres, world XZ. Returns vec4(height, rockMask, tint, rockKind).
export const HEIGHT_GLSL = /* glsl */`
uniform vec4 uRockA;   // loose rocks, small layer: cell, dmin, dmax, occupancy
uniform vec4 uRockB;   // loose rocks, large layer
uniform float uRockQ;  // Golombek q(k) = 1.79 + 0.152/k   [1/m]
uniform float uOutcrop; // bias of bedrock exposure

float baseH(vec2 p){ return 0.45 * fbm(p * 0.018, 4, 11u) + 0.10 * fbm(p * 0.11, 3, 12u) + 0.035 * fbm(p * 0.6, 3, 13u); }

float sandH(vec2 p){
  float h = 0.012 * fbm(p * 1.1, 3, 21u);
  // impact ripples (wavelength ~5-8 cm, few mm high), sinuous crests, patchy
  vec2 wd = normalize(vec2(0.35, 1.0));
  float warp = 0.30 * fbm(p * 0.6, 3, 22u) + 0.012 * fbm(p * 5.0, 2, 23u);
  const float lam = 0.08;
  float ph = (dot(p, wd) + warp) / lam;
  float s = fract(ph);
  float prof = s < 0.72 ? s / 0.72 : (1.0 - s) / 0.28;
  prof = prof * prof * (3.0 - 2.0 * prof); prof = mix(prof, 0.5 - 0.5 * cos(6.2831853 * s), 0.5);
  float amp = 0.0030 * smoothstep(-0.25, 0.35, fbm(p * 0.45, 2, 24u) + 0.1 * fbm(p * 3.0, 2, 27u));
  h += amp * prof;
  // broad wind-drift undulations
  h += 0.02 * fbm(vec2(dot(p, wd), dot(p, wd.yx * vec2(-1, 1))) * vec2(1.4, 0.5), 2, 25u);
  return h;
}

float outcropField(vec2 p){ return fbm(p * 0.30 + vec2(3.1, 7.2), 4, 31u) + 0.35 * fbm(p * 1.3, 2, 32u) + uOutcrop; }

// Voronoi with edge distance (iq). returns vec4(F1, edgeDist, cellCenter.xy) in voronoi space
vec4 voronoi(vec2 x, uint s, out ivec2 id){
  ivec2 n = ivec2(floor(x)); vec2 f = x - floor(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0); float md = 8.0; id = n;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    ivec2 g = ivec2(i, j); vec2 o = 0.08 + 0.84 * rnd2(n + g, s);
    vec2 r = vec2(g) + o - f; float d = dot(r, r);
    if (d < md){ md = d; mr = r; mg = vec2(g); id = n + g; }
  }
  float ed = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    ivec2 g = ivec2(mg) + ivec2(i, j); vec2 o = 0.08 + 0.84 * rnd2(n + g, s);
    vec2 r = vec2(g) + o - f; vec2 dd = r - mr;
    if (dot(dd, dd) > 1e-6) ed = min(ed, dot(0.5 * (mr + r), normalize(dd)));
  }
  return vec4(sqrt(md), ed, x + mr);
}

// fractured bedrock slabs; returns height relative to the local base, tint in 'tint'
float slabH(vec2 p, out float tint){
  const float FREQ = 2.1;
  const float ANG = 0.45;
  mat2 R = mat2(cos(ANG), sin(ANG), -sin(ANG), cos(ANG));
  vec2 q = R * p; q *= vec2(1.0, 1.6) * FREQ;
  q += 0.22 * vec2(fbm(p * 2.2, 3, 41u), fbm(p * 2.2 + 5.3, 3, 42u));
  ivec2 id; vec4 v = voronoi(q, 43u, id);
  float r1 = rnd(id, 44u), r2 = rnd(id, 45u), r3 = rnd(id, 46u), r4 = rnd(id, 47u);
  vec2 cq = v.zw / (vec2(1.0, 1.6) * FREQ);
  vec2 cw = transpose(R) * cq;          // approximate cell centre in world
  float oc = outcropField(cw) * 0.75 + outcropField(p) * 0.25;
  float e = 0.11 * oc + 0.05 * (r1 - 0.5) - 0.02;
  vec2 tilt = (vec2(r2, r3) - 0.5) * 0.22;
  float top = e + dot(tilt, p - cw);
  // rounded, weathered rim: convex (parabolic) drop towards the fracture / sand
  float edm = v.y / (FREQ * 1.25) + 0.022 * fbm(p * 11.0, 3, 48u) + 0.006 * gnoise(p * 50.0, 53u);
  float ew = 0.03 + 0.06 * r4;
  float sN = clamp(edm / ew, 0.0, 1.0);
  top -= 0.09 * (1.0 - sN) * (1.0 - sN);
  // lumpy, crumbly surface
  top += 0.018 * fbm(p * 3.5, 3, 49u) + 0.0055 * fbm(p * 14.0, 3, 50u) + 0.0018 * fbm(p * 55.0, 2, 52u);
  // faint lamination steps
  float lay = fbm(p * 1.7, 2, 51u) * 0.05 + top;
  float st = fract(lay / 0.022);
  top -= 0.002 * smoothstep(0.7, 0.95, st);
  tint = r1;
  return top;
}

// loose angular rocks drawn from Golombek SFD; layer params L = (cell, dmin, dmax, occ)
float rockLayer(vec2 p, vec4 L, uint s, inout float tint, inout float kind){
  float cell = L.x, dmin = L.y, dmax = L.z, occ = L.w;
  ivec2 c0 = ivec2(floor(p / cell));
  float best = -1.0;
  float pch = 0.55 + 0.9 * smoothstep(-0.5, 0.6, fbm(p * 0.8, 2, s + 7u));
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    ivec2 c = c0 + ivec2(i, j);
    float u = rnd(c, s);
    float D = dmin / (1.0 - u * (1.0 - dmin / dmax));
    if (rnd(c, s + 1u) > occ * pch * exp(-uRockQ * (D - dmin))) continue;
    vec2 ctr = (vec2(c) + 0.5 + 0.9 * (rnd2(c, s + 2u) - 0.5)) * cell;
    vec2 q = p - ctr; float r = 0.5 * D;
    if (dot(q, q) > r * r * 2.2) continue;
    float rot = rnd(c, s + 3u) * 6.2831853;
    float el = 1.0 + 1.3 * rnd(c, s + 4u);           // elongation (slab fragments)
    mat2 Rm = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
    vec2 ql = Rm * q; ql.y *= el; r *= sqrt(el) * 0.85;
    float H = D * (0.18 + 0.25 * rnd(c, s + 5u));
    vec2 tl = (rnd2(c, s + 6u) - 0.5) * 0.4;
    float h = H * (1.0 - 0.3 * dot(ql, ql) / (r * r)) + dot(tl, ql);
    for (int k = 0; k < 6; k++){
      float az = 6.2831853 * (float(k) + 0.8 * rnd(c, s + 10u + uint(k))) / 6.0;
      vec2 dir = vec2(cos(az), sin(az));
      float Ri = r * (0.72 + 0.4 * rnd(c, s + 20u + uint(k)));
      float sl = 1.3 + 2.2 * rnd(c, s + 30u + uint(k));
      h = smin(h, (Ri - dot(dir, ql)) * sl, 0.14 * r);
    }
    h += 0.10 * H * gnoise(p / (0.18 * D + 1e-3), s + 8u);
    h += 0.06 * H * gnoise(p / (0.25 * D + 1e-3), s + 8u);
    h -= H * 0.35 * rnd(c, s + 9u);                   // burial
    if (h > best){ best = h; tint = rnd(c, s + 40u); kind = 1.0; }
  }
  return best;
}

vec4 terrainH(vec2 p){
  float b = baseH(p);
  float s = sandH(p);
  float tint = 0.5, kind = 0.0;
  float sl = slabH(p, tint);
  float rk = -1.0; float tr = 0.5, kr = 0.0;
  float ra = rockLayer(p, uRockA, 101u, tr, kr);
  if (ra > rk){ rk = ra; }
  float tb = 0.5, kb = 0.0;
  float rb = rockLayer(p, uRockB, 202u, tb, kb);
  float loose = max(ra, rb);
  float trk = rb > ra ? tb : tr;
  float rock = max(sl, s + loose - 0.002);
  float useLoose = step(sl, s + loose - 0.002);
  float h = smax(s, rock, 0.005);
  float mask = smoothstep(-0.001, 0.0015, rock - s);
  float t = mix(tint, trk, useLoose);
  return vec4(b + h, mask, t, useLoose);
}
`;
