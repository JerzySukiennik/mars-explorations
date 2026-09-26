// Shared GLSL snippets for the launch scene: hashing/noise, the hazy dawn sky
// model over the Gulf coast, and the height-dependent marine-haze model.
// All colours are scene-linear radiance in "camera exposure units" (the sensor
// pass maps x -> 1-exp(-x) per channel before the sRGB/Rec.709 OETF).

export const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
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
// fbm with footprint-based octave fade (fp = pixel footprint in noise units)
float fbm2f(vec2 p, float fp, int oct){
  float s = 0., a = .5, w = 0., f = 1.;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float fade = 1. - smoothstep(.25, .6, fp * f);
    s += a * fade * vnoise2(p * f) + a * (1. - fade) * .5; w += a;
    f *= 2.03; a *= .5; p = mat2(.8,.6,-.6,.8) * p + 1.7;
  }
  return s / w;
}
`;

// Sky: dawn over the Gulf. Elevation-banded marine haze: grey-blue overcast
// above, a warm forward-scattering band 1-2 deg up, and a darker bank of low
// stratus/haze right on the horizon. Brighter toward the sun azimuth (Mie lobe).
export const SKY = /* glsl */`
uniform vec3 uSunDir;
const float EARTH_R = 6.371e6;
vec3 skyColor(vec3 dir){
  float e = degrees(asin(clamp(dir.y, -1., 1.)));
  vec2 hz = normalize(dir.xz + 1e-6);
  // brightest low sky sits between the view axis and the sun azimuth, where
  // the haze layer is thinnest; it falls off quickly to the west (left)
  float az = atan(hz.x, -hz.y);                          // rad, + to the right (east) of north
  float lobe = exp(-pow((az - 0.03) / 0.21, 2.)) * .85 + .15 * smoothstep(-.35, .45, az);
  vec3 top  = vec3(.205, .235, .268);
  vec3 mid  = vec3(.255, .266, .284);
  vec3 warm = mix(vec3(.205, .172, .166), vec3(.45, .272, .195), lobe);
  vec3 bank = mix(vec3(.080, .092, .110), vec3(.24, .158, .13), lobe);
  vec3 c = mix(mid, top, smoothstep(5.0, 9.5, e));
  c = mix(c, warm, exp(-pow((e - 2.9) / 1.55, 2.)) * .96);
  c = mix(c, bank, smoothstep(1.9, 0.25, e));
  return c;
}
// Horizon haze colour in the azimuth of dir (what distant things fade into)
vec3 hazeColor(vec3 dir){
  vec3 d = normalize(vec3(dir.x, 0.0035, dir.z));
  return skyColor(d);
}
`;
