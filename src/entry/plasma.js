// Composite pass for the onboard entry camera:
//  - background: the cloud deck ~79 km below (spherical Earth, cloud-top shell
//    at ~6 km), lit by a low twilight sun; cumulus field from fbm heights,
//    shaded by its own slope, darkened in the gaps (ocean)
//  - shock-layer plasma: ray-marched, optically thin emission in the ship frame
//      (1) attached sheath on the windward half (thin, hot, 'core' spectrum),
//          seen edge-on just past the windward limb -> saturates to white
//      (2) the separated shear layer that leaves the side edge and streams
//          lee-/aft-ward ('curtain'), cooling and spreading downstream,
//      (3) a diffuse, recombining outer glow ('front' spectrum, violet).
//    Emission colours come from spectrum.js (band systems x CFA), the overall
//    brightness scales with rho and V from the entry sim.
import { NOISE } from './glsl.js';
import { R_SHIP } from './hull.js';

export function makeComposite(THREE, U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      uniform sampler2D tColor, tDepth;
      uniform mat4 uInvProj, uCamWorld;
      uniform vec3 uCamPos, uNadir, uSunDir, uSunCol, uSkyAmb, uCoreCol, uFrontCol, uCurtCol2;
      uniform float uNear, uFar, uAlt, uCloudTop;
      uniform float uSheathI, uSheathD, uEdgePhi, uAftZ, uCurtI, uCurtW0, uCurtW1, uCurtL, uBeta, uCurtCurv, uCurtZ0, uHazeI, uHazeL, uCloudScale, uCloudGain;
      varying vec2 vUv;
      const float RE = 6.371e6;
      const float R = ${R_SHIP.toFixed(2)};

      float cloudH(vec2 p){
        // p in km. large-scale organisation (clusters / lanes) x cumulus heaps
        float big = fbm2(p / 60. + 3., 4);
        float cov = smoothstep(.36, .62, big);
        float heaps = fbm2(p / 5.5, 6);
        float cells = fbm2(p / 1.6 + 11., 4);
        return cov * (.55 + .45 * heaps) * (.75 + .25 * cells) - (1. - cov) * .15;
      }
      vec3 background(vec3 d){
        vec3 C = -uNadir * (RE + uAlt);
        vec3 oc = -C; float Rc = RE + uCloudTop;
        float b = dot(oc, d), c = dot(oc, oc) - Rc * Rc, disc = b * b - c;
        if (disc < 0. || -b - sqrt(disc) < 0.) {
          // space above the limb: black with a faint airglow/twilight band
          float el = dot(d, -uNadir);
          return vec3(.002, .002, .004);
        }
        float t = -b - sqrt(disc);
        vec3 P = t * d;
        vec3 up = normalize(P - C);
        vec3 e1 = normalize(cross(uNadir, vec3(0.31, 0.77, 0.56))), e2 = cross(uNadir, e1);
        vec2 q = vec2(dot(P, e1), dot(P, e2)) / 1000. * uCloudScale;
        float fp = t / 1000. * .0022;     // pixel footprint in km (approx)
        float h = cloudH(q);
        float eps = max(.15, fp);
        float hx = cloudH(q + vec2(eps, 0.)) - h, hy = cloudH(q + vec2(0., eps)) - h;
        vec3 n = normalize(up * eps * .9 - (e1 * hx + e2 * hy) * 3.2);
        float lit = max(dot(n, uSunDir), 0.);
        // soft self-shadow of low heaps by taller ones toward the sun
        vec2 sd = vec2(dot(uSunDir, e1), dot(uSunDir, e2));
        float occ = 0.;
        for (int i = 1; i <= 3; i++) occ = max(occ, cloudH(q + sd * float(i) * .8) - h - float(i) * .05);
        lit *= 1. - smoothstep(0., .12, occ) * .8;
        float cld = smoothstep(-.05, .2, h);
        vec3 alb = mix(vec3(.02, .025, .03), vec3(.85, .82, .8), cld);
        vec3 col = alb * (uSunCol * lit + uSkyAmb * (.5 + .5 * n.z));
        // thin haze over the long slant path
        float mu = max(dot(-d, up), .05);
        col = mix(col, uSkyAmb * .6, 1. - exp(-.08 / mu));
        return col * uCloudGain;
      }

      vec3 emission(vec3 p){
        float r = length(p.xy), phi = atan(p.y, p.x), h = r - R;
        float zw = smoothstep(-30., -18., p.z) * smoothstep(uAftZ + 1.5, uAftZ - .5, p.z);
        // (1) attached windward sheath (phi below the side edge), hot core near the wall
        float wind = smoothstep(uEdgePhi + .06, uEdgePhi - .02, phi) * smoothstep(-3.0, -2.6, phi);
        float s1 = uSheathI * exp(-max(h, 0.) / uSheathD) * step(0., h) * wind * zw;
        // (2) separated shear layer from the side edge, drifting lee-/out-ward
        vec2 e0 = vec2(R * cos(uEdgePhi), R * sin(uEdgePhi));
        vec2 rel = p.xy - e0;
        // the layer turns lee-ward as it goes aft (flow direction (0, sin a, cos a))
        float zz = max(p.z - uCurtZ0, 0.);
        float beta = uBeta - uCurtCurv * zz;
        vec2 dir = vec2(sin(beta), cos(beta));
        float t = dot(rel, dir), w = dot(rel, vec2(dir.y, -dir.x));
        float sig = uCurtW0 + uCurtW1 * max(t, 0.) + .02 * zz;
        float s2 = 0.;
        if (t > -.3) {
          float wall = smoothstep(-.3, .3, t);
          s2 = uCurtI * exp(-w * w / (sig * sig)) * exp(-max(t, 0.) / uCurtL) * wall / (sig * 4.)
             * smoothstep(-25., -8., p.z) * smoothstep(uAftZ + 60., uAftZ, p.z);
        }
        // (3) diffuse outer glow around the windward side / wake
        vec2 cH = e0 + vec2(1.2, -1.);
        float s3 = uHazeI * exp(-length(p - vec3(cH, clamp(p.z, -10., uAftZ + 25.))) / uHazeL) * step(-.01, p.x - e0.x + 2.);
        float coreMix = exp(-max(t, 0.) / 3.);
        return uCoreCol * s1 + mix(uCurtCol2, uCoreCol, coreMix) * s2 + uFrontCol * s3;
      }

      void main(){
        vec4 ndc = vec4(vUv * 2. - 1., 1., 1.);
        vec4 vv = uInvProj * ndc; vec3 dv = normalize(vv.xyz / vv.w);
        vec3 d = normalize(mat3(uCamWorld) * dv);
        float z = texture2D(tDepth, vUv).x;
        vec3 col;
        float tMax;
        if (z >= .99999) { col = background(d); tMax = 140.; }
        else {
          col = texture2D(tColor, vUv).rgb;
          float zn = z * 2. - 1.;
          float vz = 2. * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
          tMax = min(vz / max(-dv.z, 1e-3), 140.);
        }
        // ray-march the emission (optically thin), quadratic step spacing
        const int NS = 110;
        float j = hash12(gl_FragCoord.xy);
        vec3 acc = vec3(0.);
        float tPrev = 0.;
        for (int i = 1; i <= NS; i++){
          float u = (float(i) - j) / float(NS);
          float t = tMax * u * u;
          float dt = t - tPrev; tPrev = t;
          acc += emission(uCamPos + d * t) * dt;
        }
        gl_FragColor = vec4(col + acc, 1.);
      }`,
  });
}
