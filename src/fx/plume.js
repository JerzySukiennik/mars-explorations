// Composite pass for the launch scene: sky, marine-haze aerial perspective,
// and a ray-marched volumetric cloud of deluge steam + entrained sand/dust,
// lit by the low sun, the sky dome and (dominantly) the Raptor exhaust column.
// The exhaust column itself is an analytic emissive line source integrated in
// closed form along each ray and attenuated by the cloud in front of it.
//
// Cloud shape = smooth union of ellipsoid "masses" (the radial ground jet and
// the buoyant steam columns it feeds) + IQ-style sphere-grid SDF fbm for the
// cauliflower billows. Density comes from the SDF with a soft shell.
import { NOISE, SKY } from './glsl.js';

export const NB = 22;

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Cloud masses at time t (s after liftoff call). Grows from the pad outward.
export function cloudBlobs(THREE, t, seed = 7) {
  const rng = mulberry(seed);
  const g = Math.min(1, Math.max(0.05, (t + 4) / 14));
  // [x, y, z, rx, ry, rz, dustiness]  (metres, pad frame, +z toward camera)
  const base = [
    // ground jet ring under/around the mount (radial wall jet + deluge steam)
    [-80, 20, 15, 48, 30, 50, .35], [80, 24, 5, 48, 36, 50, .3], [0, 24, -70, 70, 40, 50, .3], [0, 8, 70, 55, 14, 40, .35],
    // left buoyant column (separate from the tower)
    [-150, 58, -45, 60, 62, 52, .6], [-128, 102, -55, 42, 32, 38, .55], [-75, 38, 10, 48, 34, 44, .5],
    // centre-right mass, immediately right of the exhaust column
    [48, 70, -35, 48, 70, 46, .3], [64, 118, -45, 36, 28, 34, .3],
    // right mass (sunlit), separated from the centre mass by a gap
    [188, 58, -15, 60, 58, 54, .4], [165, 98, -22, 40, 30, 38, .35], [220, 88, 0, 36, 30, 34, .45],
    // front, low (column visible over it)
    [-45, 10, 110, 50, 13, 42, .4], [60, 10, 100, 48, 13, 40, .4],
    // left low bank drifting west with the onshore breeze
    [-290, 24, 20, 80, 26, 60, .65], [-390, 16, 50, 72, 18, 55, .75], [-455, 11, 70, 55, 13, 45, .8],
    // right tail toward the beach: dustier, thinner
    [245, 40, -60, 30, 40, 30, .9], [150, 30, 40, 50, 30, 45, .5],
    // lower filler between masses
    [-215, 36, -10, 55, 32, 50, .6], [120, 40, -20, 45, 36, 45, .35], [-20, 55, -60, 40, 45, 40, .3],
  ];
  const c = [], r = [];
  for (let i = 0; i < NB; i++) {
    const b = base[i];
    const j = () => (rng() - .5);
    c.push(new THREE.Vector4(b[0] * (0.35 + 0.65 * g) + j() * 8, b[1] * g + j() * 4, b[2] * (0.35 + 0.65 * g) + j() * 8, b[6]));
    r.push(new THREE.Vector3(b[3] * (0.3 + 0.7 * g), b[4] * (0.3 + 0.7 * g), b[5] * (0.3 + 0.7 * g)));
  }
  return { c, r };
}

export function makeCompositeMaterial(THREE, u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${NOISE}
      ${SKY}
      #define NB ${NB}
      uniform sampler2D tColor, tDepth;
      uniform mat4 uInvProj, uCamWorld;
      uniform vec3 uCamPos, uSunCol, uSkyIrr, uCloudSun;
      uniform vec4 uBlob[NB]; uniform vec3 uBlobR[NB];
      uniform vec3 uCol;          // exhaust column axis (x, z) and base height (y)
      uniform vec3 uFlameCol;     // column emissive colour
      uniform float uFlameI, uFlameLight, uHazeS, uHazeH, uCloudSigma;
      uniform vec3 uFlameLightCol;
      varying vec2 vUv;

      float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
      float smax(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
      float sdEll(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.) / k1; }
      float sph(vec3 i, vec3 f, vec3 c){ vec3 h = hash33(i + c); float rad = .55 * h.x * h.x + .12; return length(f - c - (h - .5) * .3) - rad; }
      float sdGrid(vec3 p){
        vec3 i = floor(p), f = fract(p);
        return min(min(min(sph(i,f,vec3(0,0,0)), sph(i,f,vec3(0,0,1))), min(sph(i,f,vec3(0,1,0)), sph(i,f,vec3(0,1,1)))),
                   min(min(sph(i,f,vec3(1,0,0)), sph(i,f,vec3(1,0,1))), min(sph(i,f,vec3(1,1,0)), sph(i,f,vec3(1,1,1)))));
      }
      float dustAt;
      float sdBase(vec3 p){
        float d = 1e5; float wsum = 0., dsum = 0.;
        for (int i = 0; i < NB; i++){
          float di = sdEll(p - uBlob[i].xyz, uBlobR[i]);
          d = smin(d, di, 26.);
          float w = exp(-max(di, 0.) / 25.); wsum += w; dsum += w * uBlob[i].w;
        }
        dustAt = dsum / max(wsum, 1e-4);
        return max(d, -p.y - 2.);
      }
      const mat3 RM = mat3(0.00, 1.60, 1.20, -1.60, 0.72, -0.96, -1.20, -0.96, 1.28);
      float sdCloud(vec3 p, int oct){
        float d = sdBase(p);
        if (d > 30.) return d;
        float s = 1.; vec3 q = p / 50.;
        for (int o = 0; o < 4; o++){
          if (o >= oct) break;
          float n = s * 50. * sdGrid(q) + (o > 0 ? 1.5 : 0.);
          n = smax(n, d - .20 * s * 50., .32 * s * 50.);
          d = smin(n, d, .32 * s * 50.);
          q = RM * q; s *= .5;
        }
        return d;
      }
      float dens(float d){ return smoothstep(3.5, -6.0, d); }

      vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){
        vec3 inv = 1. / rd; vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
        vec3 tmin = min(t0, t1), tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }
      // haze optical depth along a ray over a curved Earth (height above sea level)
      float hazeTau(vec3 ro, vec3 rd, float L){
        float tau = 0.; float dt = L / 12.;
        for (int i = 0; i < 12; i++){
          float t = (float(i) + .5) * dt;
          vec3 p = ro + rd * t; vec2 dxz = p.xz - ro.xz;
          float h = p.y + dot(dxz, dxz) / (2. * EARTH_R);
          tau += exp(-max(h, 0.) / uHazeH) * dt;
        }
        return tau * uHazeS;
      }
      // irradiance from the exhaust column (finite vertical line source, y in [0, top])
      vec3 colLight(vec3 p, out vec3 ldir){
        vec2 dxz = p.xz - uCol.xz; float r = max(length(dxz), 28.);
        float top = uCol.y - 2.;
        float a = atan((top - p.y) / r) - atan((0. - p.y) / r);
        vec3 q = vec3(uCol.x, clamp(p.y, 0., top), uCol.z);
        ldir = normalize(q - p);
        return uFlameLightCol * uFlameLight * a / r;
      }

      void main(){
        vec2 ndc = vUv * 2. - 1.;
        float z = texture2D(tDepth, vUv).x;
        vec4 vf = uInvProj * vec4(ndc, 1., 1.); vf /= vf.w;
        vec3 rd = normalize((uCamWorld * vec4(vf.xyz, 0.)).xyz);
        vec3 ro = uCamPos;
        bool sky = z >= .99999;
        float dist = 1e7;
        vec3 col;
        if (sky) col = skyColor(rd);
        else {
          vec4 vp = uInvProj * vec4(ndc, z * 2. - 1., 1.); vp /= vp.w;
          dist = length(vp.xyz);
          col = texture2D(tColor, vUv).rgb;
          float T = exp(-hazeTau(ro, rd, dist));
          col = col * T + hazeColor(rd) * (1. - T);
        }
        // ---------------- cloud + exhaust ----------------
        vec2 bh = boxHit(ro, rd, vec3(-560., -2., -260.), vec3(420., 230., 240.));
        float t0 = max(bh.x, 0.), t1 = min(bh.y, dist);
        // exhaust column closest approach
        vec2 rxz = rd.xz; float rl2 = dot(rxz, rxz);
        vec2 oc = ro.xz - uCol.xz;
        float tc = -dot(oc, rxz) / rl2;
        vec3 pc = ro + rd * tc;
        float rmin = length(pc.xz - uCol.xz);
        float yb = uCol.y;
        float below = min(yb - pc.y, 400.);
        // jet radius: ~booster radius at the nozzle exit plane, slowly spreading
        float wcol = 4.6 + max(below, 0.) * .025;
        float prof = smoothstep(-1.5, 0.5, below) * (0.5 + 0.5 * exp(-max(below, 0.) / 45.)) * smoothstep(-2., 6., pc.y);
        vec3 fcol = mix(uFlameCol, vec3(1., .20, .05), exp(-max(below, 0.) / 22.));
        // chord through a soft-edged luminous cylinder (flat-top radial profile)
        float chord = 2. * sqrt(max(wcol * wcol - rmin * rmin, 0.)) / sqrt(rl2);
        float halo = exp(-rmin * rmin / (wcol * wcol * 2.2)) * wcol * .9;
        vec3 emit = fcol * uFlameI * prof * (chord * .16 + halo * .05);
        bool emitted = tc > dist;   // hidden behind something opaque
        vec3 Lc = vec3(0.); float Tc = 1.;
        if (!emitted && tc < t0) { Lc += emit; emitted = true; }
        if (t1 > t0){
          float t = t0; float Th = exp(-hazeTau(ro, rd, t0));
          for (int i = 0; i < 110; i++){
            if (t > t1 || Tc < .01) break;
            vec3 p = ro + rd * t;
            float d = sdCloud(p, 3) + (vnoise3(p / 11.) - .5) * 6.;
            if (d > 8.) { t += max(d * .8, 3.); continue; }
            float dt = 2.6 + t * 0.0004;
            float rho = dens(d) * (0.8 + 0.4 * vnoise3(p / 7.));
            if (rho > .002){
              float dust = dustAt;
              float sig = uCloudSigma * rho;
              // column light with soft self-shadowing (multiple-scatter approx.)
              vec3 ld; vec3 Ef = colLight(p, ld);
              float tl = dens(sdCloud(p + ld * 7., 2)) * 7. + dens(sdCloud(p + ld * 22., 1)) * 15. + dens(sdCloud(p + ld * 45., 1)) * 23.;
              float tauL = uCloudSigma * tl;
              float trL = max(exp(-tauL), .45 * exp(-tauL * .06));
              // sun
              vec3 sd = uSunDir;
              float ts = dens(sdCloud(p + sd * 9., 2)) * 9. + dens(sdCloud(p + sd * 28., 1)) * 20. + dens(sdCloud(p + sd * 60., 1)) * 32.
                       + dens(sdBase(p + sd * 110.)) * 50. + dens(sdBase(p + sd * 200.)) * 90.;
              float tauS = uCloudSigma * ts;
              float trS = max(exp(-tauS), .25 * exp(-tauS * .15));
              float cth = dot(rd, sd);
              float ph = mix(.8, 2.2, pow(max(cth, 0.), 3.)) ;
              // sky ambient: occluded below / inside
              float ao = clamp((sdCloud(p + vec3(0., 16., 0.), 1) + 6.) / 24., 0., 1.) * .8 + .2;
              vec3 alb = mix(vec3(.97, .93, .88), vec3(.82, .66, .54), dust);
              vec3 S = alb * (Ef * trL + uCloudSun * trS * ph + uSkyIrr / 3.1416 * ao * ao * .22);
              float a = 1. - exp(-sig * dt);
              // cloud behind the column: add column emission when crossing it
              if (!emitted && t + dt > tc) { Lc += Tc * emit; emitted = true; }
              Lc += Tc * a * S;
              Tc *= 1. - a;
            }
            t += dt;
          }
          // haze in front of the cloud
          Lc = Lc * Th;
          col = col * Tc + Lc + hazeColor(rd) * (1. - Th) * (1. - Tc) * 0.;
        }
        if (!emitted) col += emit * Tc;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}
