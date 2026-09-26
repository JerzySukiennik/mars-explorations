// Mastcam-Z camera + onboard image chain model (Perseverance, Bell et al. 2021).
//
// Optics:  34 mm focal length (zoom range 26-110 mm), f/8-ish, 7.4 um pixels,
//          1648 x 1200 photoactive pixels (Kodak/ON Semi KAI-2020 interline CCD with
//          RGGB Bayer CFA) -> 25.6 x 19.2 deg FOV at 34 mm.
// Chain:   scene radiance -> lens MTF (diffraction + defocus, ~Gaussian) -> vignetting ->
//          CFA sampling -> photo-electrons (shot noise) + read noise -> 12-bit ADC ->
//          12->8 bit square-root companding LUT -> Malvar-He-Cutler demosaic (as used
//          onboard MSL Mastcam / Mastcam-Z) -> JPEG (YCbCr 8x8 DCT, quality ~90).
//          No white balance / colour correction: this is the look of the raw "LMJ"
//          colour products posted to the raw-image site.

export const MASTCAMZ = {
  sensorPx: [1648, 1200], pixelPitch_um: 7.4,
  focal_mm: { 26: 26, 34: 34, 48: 48, 63: 63, 79: 79, 100: 100, 110: 110 },
  fovDeg(focal_mm, px = 1648) { return 2 * Math.atan((px * 7.4e-3 / 2) / focal_mm) * 180 / Math.PI; },
  stereoBaseline_m: 0.2412,
  fullWell_e: 20000, readNoise_e: 16, gain_ePerDN: 20000 / 4095,
};

const VQUAD = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SENSOR_FRAG = /* glsl */`
uniform sampler2D tHDR; uniform vec2 uRes; uniform float uExpo; uniform float uSeed;
uniform float uGainE; uniform float uReadE; uniform float uVig; uniform vec3 uChanGain; uniform float uSigma;
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float h01(ivec2 p, uint s){ return (float(pcg(uint(p.x) + pcg(uint(p.y) + pcg(s))) >> 8u) + 0.5) * (1.0 / 16777216.0); }
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  int yt = int(uRes.y) - 1 - px.y;
  int ch = ((yt & 1) == 0) ? (((px.x & 1) == 0) ? 0 : 1) : (((px.x & 1) == 0) ? 1 : 2);
  ivec2 mx = ivec2(uRes) - 1;
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    float w = exp(-float(i*i + j*j) / (2.0 * uSigma * uSigma));
    acc += w * texelFetch(tHDR, clamp(px + ivec2(i, j), ivec2(0), mx), 0).rgb; ws += w;
  }
  acc /= ws;
  float v = ch == 0 ? acc.r : (ch == 1 ? acc.g : acc.b);
  vec2 q = (vec2(px) + 0.5 - 0.5 * uRes) / (0.5 * uRes.x);
  float vig = 1.0 - uVig * dot(q, q);
  float e = max(v * uExpo * vig * uChanGain[ch], 0.0) * 4095.0 * uGainE;
  float u1 = h01(px, uint(uSeed)), u2 = h01(px, uint(uSeed) + 7u), u3 = h01(px, uint(uSeed) + 13u), u4 = h01(px, uint(uSeed) + 19u);
  float g1 = sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2), g2 = sqrt(-2.0 * log(u3)) * cos(6.2831853 * u4);
  e += sqrt(e) * g1 + uReadE * g2;
  float dn = clamp(floor(e / uGainE + 0.5), 0.0, 4095.0);
  float c8 = floor(255.0 * sqrt(dn / 4095.0) + 0.5);
  gl_FragColor = vec4(c8, 0.0, 0.0, 1.0);
}
`;

const DEMOSAIC_FRAG = /* glsl */`
uniform sampler2D tMos; uniform vec2 uRes;
ivec2 MX;
float f(ivec2 p, int dx, int dy){ return texelFetch(tMos, clamp(p + ivec2(dx, dy), ivec2(0), MX), 0).r; }
void main(){
  MX = ivec2(uRes) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  int yt = int(uRes.y) - 1 - p.y;
  bool evenRow = (yt & 1) == 0, evenCol = (p.x & 1) == 0;
  float c = f(p,0,0);
  float N = f(p,0,1), S = f(p,0,-1), E = f(p,1,0), W = f(p,-1,0);
  float N2 = f(p,0,2), S2 = f(p,0,-2), E2 = f(p,2,0), W2 = f(p,-2,0);
  float NE = f(p,1,1), NW = f(p,-1,1), SE = f(p,1,-1), SW = f(p,-1,-1);
  float Gk = (4.0*c + 2.0*(N+S+E+W) - (N2+S2+E2+W2)) / 8.0;
  float Hk = (5.0*c + 4.0*(E+W) - (E2+W2) - (NE+NW+SE+SW) + 0.5*(N2+S2)) / 8.0;
  float Vk = (5.0*c + 4.0*(N+S) - (N2+S2) - (NE+NW+SE+SW) + 0.5*(E2+W2)) / 8.0;
  float Dk = (6.0*c + 2.0*(NE+NW+SE+SW) - 1.5*(N2+S2+E2+W2)) / 8.0;
  vec3 rgb;
  if (evenRow && evenCol) rgb = vec3(c, Gk, Dk);          // R site
  else if (!evenRow && !evenCol) rgb = vec3(Dk, Gk, c);   // B site
  else if (evenRow) rgb = vec3(Hk, c, Vk);                // G in R row (R left/right)
  else rgb = vec3(Vk, c, Hk);                             // G in B row
  rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);
  float Y = 0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b;
  float Cb = -0.168736*rgb.r - 0.331264*rgb.g + 0.5*rgb.b;
  float Cr = 0.5*rgb.r - 0.418688*rgb.g - 0.081312*rgb.b;
  gl_FragColor = vec4(Y - 128.0, Cb, Cr, 1.0);
}
`;

const FDCT_FRAG = /* glsl */`
uniform sampler2D tYCC; uniform float uCos[64]; uniform float uQY[64]; uniform float uQC[64];
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); ivec2 b = (p / 8) * 8; int u = p.x - b.x, v = p.y - b.y;
  vec3 s = vec3(0.0);
  for (int y = 0; y < 8; y++){ float cy = uCos[v*8 + y]; for (int x = 0; x < 8; x++) s += texelFetch(tYCC, b + ivec2(x, y), 0).rgb * (uCos[u*8 + x] * cy); }
  float cu = u == 0 ? 0.70710678 : 1.0, cv = v == 0 ? 0.70710678 : 1.0;
  s *= 0.25 * cu * cv;
  float qy = uQY[v*8 + u], qc = uQC[v*8 + u];
  s = vec3(floor(s.x / qy + 0.5) * qy, floor(s.y / qc + 0.5) * qc, floor(s.z / qc + 0.5) * qc);
  gl_FragColor = vec4(s, 1.0);
}
`;

const IDCT_FRAG = /* glsl */`
uniform sampler2D tDCT; uniform float uCos[64]; uniform float uDirect;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); ivec2 b = (p / 8) * 8; int x = p.x - b.x, y = p.y - b.y;
  vec3 s = vec3(0.0);
  for (int v = 0; v < 8; v++){ float cv = (v == 0 ? 0.70710678 : 1.0) * uCos[v*8 + y];
    for (int u = 0; u < 8; u++){ float cu = (u == 0 ? 0.70710678 : 1.0) * uCos[u*8 + x]; s += texelFetch(tDCT, b + ivec2(u, v), 0).rgb * (cu * cv); } }
  s *= 0.25;
  float Y = s.x + 128.0, Cb = s.y, Cr = s.z;
  vec3 rgb = vec3(Y + 1.402*Cr, Y - 0.344136*Cb - 0.714136*Cr, Y + 1.772*Cb);
  rgb = clamp(floor(rgb + 0.5), 0.0, 255.0);
  gl_FragColor = vec4(rgb / 255.0, 1.0);
}
`;

const QY = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const QC = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
function scaleQ(tab, q) { const s = q < 50 ? 5000 / q : 200 - 2 * q; return tab.map((v) => Math.max(1, Math.floor((v * s + 50) / 100))); }

export class MastcamZChain {
  constructor(THREE, renderer, opts = {}) {
    this.THREE = THREE; this.renderer = renderer;
    this.opts = { expo: 8.0, vignette: 0.10, sigma: 0.75, chanGain: [1, 1, 1], jpegQuality: 90, seed: 211, ...opts };
    this.quadScene = new THREE.Scene(); this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.quadScene.add(this.quad);
    const cos = []; for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) cos.push(Math.cos((2 * x + 1) * u * Math.PI / 16));
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VQUAD, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.sensorMat = mk(SENSOR_FRAG, { tHDR: { value: null }, uRes: { value: new THREE.Vector2() }, uExpo: { value: 1 }, uSeed: { value: 1 }, uGainE: { value: MASTCAMZ.gain_ePerDN }, uReadE: { value: MASTCAMZ.readNoise_e }, uVig: { value: 0.1 }, uChanGain: { value: new THREE.Vector3(1, 1, 1) }, uSigma: { value: 0.75 } });
    this.demMat = mk(DEMOSAIC_FRAG, { tMos: { value: null }, uRes: { value: new THREE.Vector2() } });
    this.fdctMat = mk(FDCT_FRAG, { tYCC: { value: null }, uCos: { value: cos }, uQY: { value: scaleQ(QY, this.opts.jpegQuality) }, uQC: { value: scaleQ(QC, this.opts.jpegQuality) } });
    this.idctMat = mk(IDCT_FRAG, { tDCT: { value: null }, uCos: { value: cos }, uDirect: { value: 0 } });
    this.size = [0, 0];
  }
  setSize(w, h) {
    const THREE = this.THREE;
    if (this.size[0] === w && this.size[1] === h) return;
    this.size = [w, h];
    for (const k of ['hdrRT', 'mosRT', 'yccRT', 'dctRT']) this[k]?.dispose();
    const flt = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    this.hdrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: 0, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.mosRT = new THREE.WebGLRenderTarget(w, h, flt);
    this.yccRT = new THREE.WebGLRenderTarget(w, h, flt);
    this.dctRT = new THREE.WebGLRenderTarget(w, h, flt);
  }
  pass(mat, target) { this.quad.material = mat; const r = this.renderer; r.setRenderTarget(target); r.render(this.quadScene, this.quadCam); }
  render(scene, camera, T = () => {}) {
    const r = this.renderer; const THREE = this.THREE;
    const w = r.domElement.width, h = r.domElement.height; this.setSize(w, h);
    const o = this.opts;
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.hdrRT); r.setClearColor(0x000000, 1); r.clear(); let t0 = performance.now(); r.render(scene, camera); T('scene', t0); t0 = performance.now();
    const su = this.sensorMat.uniforms; su.tHDR.value = this.hdrRT.texture; su.uRes.value.set(w, h); su.uExpo.value = o.expo; su.uSeed.value = o.seed; su.uVig.value = o.vignette; su.uChanGain.value.fromArray(o.chanGain); su.uSigma.value = o.sigma;
    this.pass(this.sensorMat, this.mosRT);
    this.demMat.uniforms.tMos.value = this.mosRT.texture; this.demMat.uniforms.uRes.value.set(w, h);
    this.pass(this.demMat, this.yccRT);
    this.fdctMat.uniforms.tYCC.value = this.yccRT.texture; this.pass(this.fdctMat, this.dctRT);
    this.idctMat.uniforms.tDCT.value = this.dctRT.texture; this.pass(this.idctMat, null);
    T('sensor chain', t0); r.toneMapping = tm;
  }
}
