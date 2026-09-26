// Mars surface terrain: procedural height field baked into two GPU tiles (a fine
// 5 mm tile around where the camera looks and a coarse tile for the surroundings,
// analytic far field beyond), rendered with a screen-space grid whose vertices are
// ray-marched onto the height field (so triangle density follows the pixel grid at
// every range), and shaded per pixel with sun shadows marched through the height
// field, sky light with height-field occlusion, and sand/rock micro structure.
import { NOISE_GLSL, HEIGHT_GLSL } from './glsl.js';

// Golombek & Rapp (1997) / Golombek et al. (2003) rock model: cumulative fractional
// area covered by rocks of diameter >= D is F(D) = k exp(-q D), q = 1.79 + 0.152/k.
// Number density per m^2 per metre of D: n(D) = -dF/dD / (pi D^2 / 4).
export function golombekLayer(k, cell, dmin, dmax) {
  const q = 1.79 + 0.152 / k;
  const n = (D) => (4 / Math.PI) * k * q * Math.exp(-q * D) / (D * D);
  const N = 2000; let cnt = 0, acc = 0, norm = 0;
  for (let i = 0; i < N; i++) {
    const D = dmin + (dmax - dmin) * (i + 0.5) / N; const dD = (dmax - dmin) / N;
    cnt += n(D) * dD;                          // rocks per m^2 in [dmin,dmax]
    const pdf = 1 / (D * D);                   // sampling pdf in the shader (unnormalised)
    acc += pdf * Math.exp(-q * (D - dmin)) * dD; norm += pdf * dD;
  }
  const expectedAccept = acc / norm;
  const occ = (cnt * cell * cell) / expectedAccept;
  return { q, occ, perM2: cnt };
}

const RENDER_COMMON = /* glsl */`
uniform sampler2D uFine; uniform sampler2D uCoarse;
uniform vec4 uFineRect; uniform vec4 uCoarseRect;
float fineW(vec2 xz, out vec2 uv){ uv = (xz - uFineRect.xy) / uFineRect.z; vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.03, min(e.x, e.y)); }
vec4 dataAt(vec2 xz){
  vec2 uf; float w = fineW(xz, uf);
  if (w >= 1.0) return textureLod(uFine, uf, 0.0);
  vec2 uc = (xz - uCoarseRect.xy) / uCoarseRect.z; vec2 ec = min(uc, 1.0 - uc);
  float wc = smoothstep(0.0, 0.05, min(ec.x, ec.y));
  vec4 c = wc > 0.0 ? textureLod(uCoarse, uc, 0.0) : vec4(0.0);
  if (wc < 1.0) c = mix(vec4(baseH(xz), 0.0, 0.5, 0.0), c, wc);
  if (w <= 0.0) return c;
  return mix(c, textureLod(uFine, uf, 0.0), w);
}
float hAt(vec2 xz){ return dataAt(xz).x; }
`;

const VERT = /* glsl */`
${NOISE_GLSL}
${HEIGHT_GLSL}
${RENDER_COMMON}
uniform mat4 uInvVP; uniform float uMaxT;
varying vec3 vW; varying float vMiss;
void main(){
  vec2 ndc = position.xy;
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0); a.xyz /= a.w;
  vec4 b = uInvVP * vec4(ndc, 1.0, 1.0); b.xyz /= b.w;
  vec3 ro = cameraPosition; vec3 rd = normalize(b.xyz - a.xyz);
  float t = 0.05, tp = t; bool hit = false;
  for (int i = 0; i < 320; i++){
    vec3 q = ro + rd * t; float d = q.y - hAt(q.xz);
    if (d < 0.0){ hit = true; break; }
    tp = t;
    float st = max(0.45 * d, 0.0012 + 0.0015 * t);
    if (t > 20.0) st = max(st, 0.02 * t);
    t += st;
    if (t > uMaxT) break;
  }
  vMiss = 0.0;
  if (hit){
    for (int i = 0; i < 8; i++){ float m = 0.5 * (tp + t); vec3 q = ro + rd * m; if (q.y - hAt(q.xz) < 0.0) t = m; else tp = m; }
    t = 0.5 * (t + tp);
  } else { t = uMaxT; vMiss = 1.0; }
  vW = ro + rd * t;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}
`;

const FRAG = /* glsl */`
${NOISE_GLSL}
${HEIGHT_GLSL}
${RENDER_COMMON}
uniform vec3 uSunDir; uniform vec3 uSunI; uniform vec3 uSkyI; uniform vec3 uHaze; uniform float uHazeL;
uniform mat4 uBoxInv[16]; uniform int uBoxN;
uniform vec3 uSand; uniform vec3 uRockDust; uniform vec3 uRockClean; uniform vec3 uPebble;
varying vec3 vW; varying float vMiss;

float boxHit(mat4 inv, vec3 ro, vec3 rd){
  vec3 o = (inv * vec4(ro, 1.0)).xyz; vec3 d = (inv * vec4(rd, 0.0)).xyz;
  vec3 id = 1.0 / d; vec3 t0 = (-0.5 - o) * id, t1 = (0.5 - o) * id;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
  return (b > max(a, 0.0)) ? 1.0 : 0.0;
}
float roverShadow(vec3 p){
  if (uBoxN == 0) return 1.0;
  vec3 up = abs(uSunDir.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 t1 = normalize(cross(uSunDir, up)), t2 = cross(uSunDir, t1);
  float lit = 0.0;
  for (int s = 0; s < 5; s++){
    vec2 o = s == 0 ? vec2(0.0) : vec2(cos(float(s) * 1.5708 + 0.4), sin(float(s) * 1.5708 + 0.4)) * 0.0025;
    vec3 rd = normalize(uSunDir + t1 * o.x + t2 * o.y);
    float occ = 0.0;
    for (int i = 0; i < 16; i++){ if (i >= uBoxN) break; occ = max(occ, boxHit(uBoxInv[i], p, rd)); }
    lit += 1.0 - occ;
  }
  return lit / 5.0;
}
float sunShadow(vec3 p, vec3 n){
  vec3 o = p + n * 0.0015 + uSunDir * 0.001;
  float res = 1.0; float t = 0.003;
  for (int i = 0; i < 40; i++){
    vec3 q = o + uSunDir * t; float d = q.y - hAt(q.xz);
    res = min(res, 0.5 + 0.5 * d / (t * 0.0031 + 0.0006));
    if (res <= 0.0) break;
    t += max(0.003, t * 0.15);
    if (t > 5.0) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

void main(){
  if (vMiss > 0.5) discard;
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - ro); float t = length(vW - ro);
  vec3 p = vW;
  float d0 = p.y - hAt(p.xz);
  if (abs(d0) > 0.0015 + 0.0008 * t){
    // silhouette sliver: re-march this pixel's own ray
    float tt = t * 0.6, tp = tt; bool hit = false;
    for (int i = 0; i < 48; i++){ vec3 q = ro + rd * tt; float dd = q.y - hAt(q.xz); if (dd < 0.0){ hit = true; break; } tp = tt; tt += max(0.45 * dd, 0.0008 + 0.0008 * tt); }
    if (!hit) discard;
    for (int i = 0; i < 7; i++){ float m = 0.5 * (tp + tt); vec3 q = ro + rd * m; if (q.y - hAt(q.xz) < 0.0) tt = m; else tp = m; }
    t = 0.5 * (tp + tt); p = ro + rd * t;
  }
  vec2 uvf; float wf = fineW(p.xz, uvf);
  vec4 D = dataAt(p.xz);
  float e = wf > 0.5 ? uFineRect.w : uCoarseRect.w;
  float hx = hAt(p.xz + vec2(e, 0.0)) - hAt(p.xz - vec2(e, 0.0));
  float hz = hAt(p.xz + vec2(0.0, e)) - hAt(p.xz - vec2(0.0, e));
  vec2 g = vec2(hx, hz) / (2.0 * e);
  float mask = D.y;
  // pixel footprint on the ground (m) for detail filtering
  float fw = max(t * 0.00030, 1e-5) / max(abs(rd.y) * 0.8 + 0.2, 0.25);

  // ---------- micro structure ----------
  vec2 xz = p.xz;
  float ao = 1.0;
  if (wf > 0.0){
    float h0 = D.x;
    float h3 = textureLod(uFine, uvf, 3.0).x, h5 = textureLod(uFine, uvf, 5.0).x, h7 = textureLod(uFine, uvf, 7.0).x;
    float occl = 7.0 * max(h3 - h0, 0.0) + 2.6 * max(h5 - h0, 0.0) + 0.9 * max(h7 - h0, 0.0);
    ao = mix(1.0, 1.0 / (1.0 + occl * 8.0), wf);
  }
  float gl0 = length(g);
  vec2 gSand = vec2(0.0), gRock = vec2(0.0);
  vec3 sand = uSand, rockA = uRockDust;
  float pebMask = 0.0; vec3 pebN = vec3(0, 1, 0); float pebShade = 1.0; float pebTint = 0.5;
  if (mask < 0.999){
    // sand: grain-scale roughness + albedo speckle (individual ~0.7 mm grains)
    vec3 sd = fbmd(xz * 260.0, 2, 61u, 0.5);
    float fs = clamp(1.0 - fw * 260.0 * 0.6, 0.0, 1.0);
    gSand = sd.yz * 0.00035 * 260.0 * fs;
    ivec2 gc = ivec2(floor(xz * 1500.0));
    float grainAmp = clamp(0.0012 / fw, 0.5, 1.0);
    sand = uSand * (1.0 + 0.16 * fbm(xz * 1.2, 3, 92u) + 0.07 * fbm(xz * 12.0, 2, 93u));
    sand *= 1.0 + 0.9 * (rnd(gc, 91u) - 0.5) * grainAmp;
    sand *= vec3(1.0 + 0.10 * grainAmp * (rnd(gc, 94u) - 0.5), 1.0, 1.0 + 0.12 * grainAmp * (rnd(gc, 95u) - 0.5));
    // pebbles (gravel lag on the sand), analytic
    const float PC = 0.022;
    float dens = 0.02 + 0.40 * smoothstep(0.1, 0.7, fbm(xz * 0.7, 2, 71u) + 0.35 * gnoise(xz * 4.0, 75u));
    ivec2 c0 = ivec2(floor(xz / PC));
    vec2 sxz = normalize(uSunDir.xz + 1e-5); float cotE = sqrt(max(1.0 - uSunDir.y * uSunDir.y, 0.0)) / max(uSunDir.y, 0.05);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      ivec2 c = c0 + ivec2(i, j);
      if (rnd(c, 72u) > dens) continue;
      vec2 ctr = (vec2(c) + 0.5 + 0.8 * (rnd2(c, 73u) - 0.5)) * PC;
      float r = 0.003 + 0.011 * pow(rnd(c, 74u), 2.0);
      vec2 q = xz - ctr;
      if (dot(q, q) > 9.0 * r * r) continue;
      float hgt = r * (0.45 + 0.45 * rnd(c, 77u));
      float an = rnd(c, 76u) * 6.283; mat2 Rm = mat2(cos(an), sin(an), -sin(an), cos(an));
      vec2 ql = Rm * q; ql.y *= 1.0 + 0.7 * rnd(c, 78u);
      float wob = 1.0 + 0.22 * gnoise(ql / r * 0.9 + vec2(float(c.x & 255), float(c.y & 255)), 79u);
      float d2 = dot(ql, ql) / (r * r) * wob;
      vec2 qs = Rm * (q + sxz * hgt * cotE); qs.y *= 1.0 + 0.7 * rnd(c, 78u);
      float ds = dot(qs, qs) / (r * r) * wob;
      if (d2 < 1.0){
        vec2 qn = q / r;
        pebN = normalize(vec3(qn.x * 0.7 + 0.3 * wob - 0.3, sqrt(max(1.0 - d2, 0.0)) * (hgt / r) * 1.2 + 0.35, qn.y * 0.7));
        pebMask = smoothstep(1.0, 0.85, d2); pebTint = rnd(c, 81u);
      } else if (ds < 1.0) {
        pebShade = min(pebShade, mix(0.3, 1.0, smoothstep(0.7, 1.0, ds)));
      }
    }
    pebMask *= (1.0 - mask);
    pebShade = mix(1.0, pebShade, 1.0 - mask);
  }
  vec3 rdn = vec3(0.0);
  float crack = 0.0;
  if (mask > 0.001){
    // rock: crumbly weathered surface; steep faces use a vertical projection
    float steep = smoothstep(0.8, 2.0, gl0);
    vec2 hn = g / max(gl0, 1e-6);
    vec2 rc = mix(xz, vec2(dot(xz, vec2(-hn.y, hn.x)), p.y + 0.3 * dot(xz, hn)), steep);
    rdn = fbmd(rc * 38.0, 4, 83u, 0.6);
    vec3 rdn2 = fbmd(rc * 170.0, 2, 84u, 0.5);
    float fr = clamp(1.0 - fw * 170.0 * 0.5, 0.0, 1.0);
    gRock = rdn.yz * 0.0032 * 38.0 + rdn2.yz * 0.00025 * 170.0 * fr;
    // fine fractures: zero-crossings of a warped noise, sparse
    vec3 cn = gnoised(rc * 16.0 + 0.3 * rdn.yz, 85u);
    crack = (1.0 - smoothstep(0.0, 0.05 + fw * 25.0, abs(cn.x))) * smoothstep(0.1, 0.5, gnoise(rc * 3.0, 86u));
    gRock += crack * sign(cn.x) * normalize(cn.yz + 1e-5) * 0.5;
    float dn = fbm(rc * 42.0, 3, 81u) + 0.45 * fbm(rc * 7.0, 2, 82u) + 0.25 * (1.0 - steep) + 0.35 * (D.z - 0.5) - 0.28 + 0.18 * rdn.x;
    float dust = smoothstep(-0.04, 0.06 + fw * 30.0, dn);
    rockA = mix(uRockClean, uRockDust, dust) * (0.92 + 0.16 * D.z) * (1.0 + 0.10 * rdn.x + 0.03 * rdn2.x) * (1.0 - 0.45 * crack);
  }

  // normal
  vec2 gt = g + mix(gSand, gRock, mask);
  vec3 n = normalize(vec3(-gt.x, 1.0, -gt.y));
  n = normalize(mix(n, pebN, pebMask));

  // albedo
  vec3 peb = mix(uRockDust * 0.85, uRockClean, 0.6 * pebTint) * (0.6 + 0.5 * pebTint);
  vec3 alb = mix(sand, rockA, mask);
  alb = mix(alb, peb, pebMask);

  // lighting
  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = sunShadow(p, n) * roverShadow(p) * pebShade;
  float skyV = (0.62 + 0.38 * n.y) * ao;
  vec3 E = uSunI * ndl * sh + uSkyI * skyV + uSunI * 0.06 * (1.0 - n.y) * ao; // + ground bounce
  // mild opposition surge for the particulate sand (Hapke-style backscatter)
  float cg = dot(-rd, uSunDir);
  float opp = 1.0 + 0.12 * (1.0 - mask) * smoothstep(0.6, 1.0, cg);
  vec3 L = alb / PI * E * opp;
  float fog = 1.0 - exp(-t / uHazeL);
  L = mix(L, uHaze, fog);
  gl_FragColor = vec4(L, 1.0);
}
`;

const BAKE_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BAKE_FRAG = /* glsl */`
${NOISE_GLSL}
${HEIGHT_GLSL}
uniform vec4 uRect;
varying vec2 vUv;
void main(){ vec2 xz = uRect.xy + vUv * uRect.z; gl_FragColor = terrainH(xz); }
`;

export class Terrain {
  constructor(THREE, renderer, opts = {}) {
    this.THREE = THREE; this.renderer = renderer;
    const gl = renderer.getContext();
    const floatLinear = renderer.extensions.has('OES_texture_float_linear') && renderer.extensions.has('EXT_color_buffer_float');
    this.texType = floatLinear ? THREE.FloatType : THREE.HalfFloatType;
    this.fineN = opts.fineN || 1536; this.fineTexel = opts.fineTexel || 0.005;
    this.coarseN = opts.coarseN || 512; this.coarseTexel = opts.coarseTexel || 0.24;
    const k = opts.rockK ?? 0.10;
    const A = golombekLayer(k, 0.07, 0.012, 0.05), B = golombekLayer(k, 0.30, 0.05, 0.6);
    this.rockStats = { k, q: A.q, smallPerM2: A.perM2, largePerM2: B.perM2 };
    const mkRT = (N, mips) => new THREE.WebGLRenderTarget(N, N, {
      type: this.texType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: mips, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.fineRT = mkRT(this.fineN, true);
    this.coarseRT = mkRT(this.coarseN, false);
    const heightUniforms = () => ({
      uRockA: { value: new THREE.Vector4(0.07, 0.012, 0.05, A.occ) },
      uRockB: { value: new THREE.Vector4(0.30, 0.05, 0.6, B.occ) },
      uRockQ: { value: A.q },
      uOutcrop: { value: opts.outcrop ?? 0.0 },
    });
    this.bakeMat = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, uniforms: { ...heightUniforms(), uRect: { value: new THREE.Vector4() } }, depthTest: false, depthWrite: false });
    this.bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMat); this.bakeQuad.frustumCulled = false;
    this.bakeScene = new THREE.Scene(); this.bakeScene.add(this.bakeQuad);
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const boxInv = []; for (let i = 0; i < 16; i++) boxInv.push(new THREE.Matrix4());
    this.uniforms = {
      ...heightUniforms(),
      uFine: { value: this.fineRT.texture }, uCoarse: { value: this.coarseRT.texture },
      uFineRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uCoarseRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uInvVP: { value: new THREE.Matrix4() }, uMaxT: { value: 6000 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: new THREE.Vector3(1, 1, 1) }, uSkyI: { value: new THREE.Vector3(0.18, 0.16, 0.134) },
      uHaze: { value: new THREE.Vector3(0.05, 0.035, 0.022) }, uHazeL: { value: 2500 },
      uBoxInv: { value: boxInv }, uBoxN: { value: 0 },
      uSand: { value: new THREE.Vector3(0.24, 0.180, 0.104) },
      uRockDust: { value: new THREE.Vector3(0.45, 0.29, 0.138) },
      uRockClean: { value: new THREE.Vector3(0.30, 0.262, 0.205) },
      uPebble: { value: new THREE.Vector3(0.44, 0.30, 0.16) },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, extensions: {} });
    this.gridStep = opts.gridStep || 2;
    this.mesh = null;
    this._heightCache = null;
  }

  buildGrid(w, h) {
    const THREE = this.THREE;
    const nx = Math.ceil(w / this.gridStep) + 1, ny = Math.ceil(h / this.gridStep) + 1;
    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3; pos[o] = -1.01 + 2.02 * i / (nx - 1); pos[o + 1] = -1.01 + 2.02 * j / (ny - 1); pos[o + 2] = 0;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let k = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = geo; }
    else {
      this.mesh = new THREE.Mesh(geo, this.material); this.mesh.frustumCulled = false;
      this.mesh.onBeforeRender = (r, s, cam) => {
        this.uniforms.uInvVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      };
    }
    this.gridSize = [w, h];
    return this.mesh;
  }

  bake(rt, N, texel, cx, cz) {
    const size = N * texel; const x0 = cx - size / 2, z0 = cz - size / 2;
    this.bakeMat.uniforms.uRect.value.set(x0, z0, size, texel);
    const r = this.renderer; const prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.render(this.bakeScene, this.bakeCam); r.setRenderTarget(prev);
    return new this.THREE.Vector4(x0, z0, size, texel);
  }
  bakeFine(cx, cz) { this.uniforms.uFineRect.value.copy(this.bake(this.fineRT, this.fineN, this.fineTexel, cx, cz)); this.fineCenter = [cx, cz]; }
  bakeCoarse(cx, cz) { this.uniforms.uCoarseRect.value.copy(this.bake(this.coarseRT, this.coarseN, this.coarseTexel, cx, cz)); this.coarseCenter = [cx, cz]; this._heightCache = null; }

  // keep the tiles centred on what the camera looks at (call per frame in game)
  follow(camera, force = false) {
    const THREE = this.THREE; const f = new THREE.Vector3(); camera.getWorldDirection(f);
    const p = camera.position;
    const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    const ahead = pitch < -0.05 ? Math.min(p.y / Math.tan(-pitch), this.fineN * this.fineTexel * 0.3) : this.fineN * this.fineTexel * 0.3;
    const fl = Math.hypot(f.x, f.z) || 1;
    const cx = p.x + f.x / fl * ahead, cz = p.z + f.z / fl * ahead;
    const fs = this.fineN * this.fineTexel, cs = this.coarseN * this.coarseTexel;
    if (force || !this.fineCenter || Math.hypot(cx - this.fineCenter[0], cz - this.fineCenter[1]) > fs * 0.2) this.bakeFine(cx, cz);
    if (force || !this.coarseCenter || Math.hypot(p.x - this.coarseCenter[0], p.z - this.coarseCenter[1]) > cs * 0.2) this.bakeCoarse(p.x, p.z);
  }

  setSun(dir, sunI, skyI) { this.uniforms.uSunDir.value.copy(dir).normalize(); if (sunI) this.uniforms.uSunI.value.copy(sunI); if (skyI) this.uniforms.uSkyI.value.copy(skyI); }
  setShadowBoxes(mats) { const n = Math.min(16, mats.length); for (let i = 0; i < n; i++) this.uniforms.uBoxInv.value[i].copy(mats[i]).invert(); this.uniforms.uBoxN.value = n; }

  // CPU height query for vehicle physics (reads back the coarse tile once per bake)
  heightAt(x, z) {
    if (!this._heightCache) {
      const N = this.coarseN; const buf = this.texType === this.THREE.FloatType ? new Float32Array(N * N * 4) : new Uint16Array(N * N * 4);
      this.renderer.readRenderTargetPixels(this.coarseRT, 0, 0, N, N, buf);
      const h = new Float32Array(N * N);
      const half = this.THREE.DataUtils.fromHalfFloat;
      for (let i = 0; i < N * N; i++) h[i] = buf instanceof Float32Array ? buf[i * 4] : half(buf[i * 4]);
      this._heightCache = h;
    }
    const r = this.uniforms.uCoarseRect.value; const N = this.coarseN;
    const u = (x - r.x) / r.w - 0.5, v = (z - r.y) / r.w - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(u))), j = Math.max(0, Math.min(N - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i)), fv = Math.max(0, Math.min(1, v - j));
    const H = this._heightCache;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
}
