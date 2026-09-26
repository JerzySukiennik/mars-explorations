// Onboard camera model for the ship's entry cameras (small ruggedised
// wide-angle machine-vision camera, 1080p H.264 downlink over Starlink):
//  - wide-angle lens with barrel distortion (mix of rectilinear and
//    equidistant mapping), principal point at the centre of the 1920x1080
//    raster (the shot shows rows 110..884 of it)
//  - veiling glare / bloom around the saturated plasma (multi-scale blur)
//  - optical MTF + slight lateral chromatic aberration
//  - per-channel highlight clipping with a short shoulder (the plasma core
//    clips R first -> pink, then all channels -> white)
//  - Rec.709-ish OETF, 4:2:0 chroma, 8x8-block quantisation of the flat dark
//    areas (H.264 at low bitrate), sensor read noise
export function makeSensor(THREE, renderer, W, H, L) {
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const sc = new THREE.Scene(); sc.add(quad);
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  // stage 1: undistort -> output raster (HDR)
  const lensRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const lensMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uOut: { value: new THREE.Vector4() }, uSrc: { value: new THREE.Vector4() }, uF: { value: 1 }, uMix: { value: 0 }, uCA: { value: 0 } },
    vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform vec4 uOut; uniform vec4 uSrc; uniform float uF, uMix, uCA; varying vec2 vUv;
      // uOut: (W, H, cx, cy) output raster and principal point (px, y down)
      // uSrc: (x0, x1, y0, y1) extent of the pinhole render in tan-units (y up)
      vec2 toSrc(vec2 px, float k){
        vec2 d = (px - uOut.zw) / uF; d.y = -d.y;
        float rd = length(d) * k;
        // solve rd = (1-m) tan(th) + m th for th (Newton)
        float th = atan(rd);
        for (int i = 0; i < 5; i++){ float f = (1. - uMix) * tan(th) + uMix * th - rd; float fp = (1. - uMix) / (cos(th) * cos(th)) + uMix; th -= f / fp; }
        float ru = tan(th);
        vec2 u = rd > 1e-6 ? d / length(d) * ru : d;
        return vec2((u.x - uSrc.x) / (uSrc.y - uSrc.x), (u.y - uSrc.z) / (uSrc.w - uSrc.z));
      }
      void main(){
        vec2 px = vec2(vUv.x * uOut.x, (1. - vUv.y) * uOut.y);
        float r = texture2D(tSrc, toSrc(px, 1. + uCA)).r;
        float g = texture2D(tSrc, toSrc(px, 1.)).g;
        float b = texture2D(tSrc, toSrc(px, 1. - uCA)).b;
        gl_FragColor = vec4(r, g, b, 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const levels = [];
  let w = W, h = H;
  for (let i = 0; i < 6; i++) {
    w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
    levels.push({ a: new THREE.WebGLRenderTarget(w, h, rtOpts), b: new THREE.WebGLRenderTarget(w, h, rtOpts), w, h });
  }
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: vs,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){ vec3 s = vec3(0.); float wt[5]; wt[0]=.227; wt[1]=.1945; wt[2]=.1216; wt[3]=.054; wt[4]=.0162;
        for (int i=-4;i<=4;i++){ s += texture2D(tSrc, vUv + uDir * float(i)).rgb * wt[i<0?-i:i]; }
        gl_FragColor = vec4(s, 1.); }`,
    depthTest: false, depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tHdr: { value: lensRT.texture }, tB0: { value: levels[0].a.texture }, tB1: { value: levels[1].a.texture }, tB2: { value: levels[2].a.texture },
      tB3: { value: levels[3].a.texture }, tB4: { value: levels[4].a.texture }, tB5: { value: levels[5].a.texture },
      uRes: { value: new THREE.Vector2(W, H) }, uExposure: { value: 1 }, uBloom: { value: .1 }, uNoise: { value: 1.5 },
      uBlack: { value: new THREE.Vector3() }, uGamma: { value: 1 }, uSat: { value: 1 }, uVig: { value: .2 },
    },
    vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tHdr, tB0, tB1, tB2, tB3, tB4, tB5; uniform vec2 uRes; uniform float uExposure, uBloom, uNoise, uGamma, uSat, uVig; uniform vec3 uBlack; varying vec2 vUv;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 tap(vec2 o){ return texture2D(tHdr, vUv + o / uRes).rgb; }
      vec3 tone(vec3 x){ x = max(x, 0.); return min(x, 1.) - .0 + 0. * x; }
      vec3 shoulder(vec3 x){ x = max(x, 0.); vec3 k = x / (1. + .35 * x); return 1. - exp(-1.45 * k * (1. + .3 * k)); }
      vec3 oetf(vec3 c){ return mix(c * 4.5, 1.099 * pow(c, vec3(.45)) - .099, step(.018, c)); }
      vec3 grade(vec3 c){
        c = c * uExposure;
        vec3 t = shoulder(c);
        float Y = dot(t, vec3(.2126, .7152, .0722));
        t = max(Y + (t - Y) * uSat, 0.);
        return t;
      }
      void main(){
        vec3 c = tap(vec2(0)) * .36 + (tap(vec2(1,0)) + tap(vec2(-1,0)) + tap(vec2(0,1)) + tap(vec2(0,-1))) * .12
               + (tap(vec2(1,1)) + tap(vec2(-1,1)) + tap(vec2(1,-1)) + tap(vec2(-1,-1))) * .04;
        vec3 b = texture2D(tB0, vUv).rgb * .12 + texture2D(tB1, vUv).rgb * .16 + texture2D(tB2, vUv).rgb * .2 + texture2D(tB3, vUv).rgb * .2 + texture2D(tB4, vUv).rgb * .17 + texture2D(tB5, vUv).rgb * .15;
        c = c * (1. - uBloom) + b * uBloom;
        vec2 d = vUv - .5; d.x *= uRes.x / uRes.y;
        c *= 1. - uVig * dot(d, d);
        vec3 t = grade(c);
        // 4:2:0-like chroma: pull chroma toward the 2x2 mean
        vec2 base = floor(gl_FragCoord.xy / 2.) * 2. + .5;
        vec2 o = base - gl_FragCoord.xy;
        vec3 cn = (grade(tap(o)) + grade(tap(o + vec2(1., 0.))) + grade(tap(o + vec2(0., 1.))) + grade(tap(o + vec2(1., 1.)))) * .25;
        float Y = dot(t, vec3(.2126, .7152, .0722)), Yn = dot(cn, vec3(.2126, .7152, .0722));
        t = Y + (cn - Yn);
        vec3 oc = oetf(clamp(t, 0., 1.));
        oc = pow(oc, vec3(uGamma));
        // read + shot noise (luma-weighted), deterministic
        float n = (h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy * 1.37 + 17.) - 1.);
        float n2 = (h12(gl_FragCoord.xy + 91.) + h12(gl_FragCoord.xy * .71 + 5.) - 1.);
        oc += (n * uNoise / 255.) * (0.6 + 1.2 * sqrt(Y)) + vec3(0., n2, -n2) * .4 * uNoise / 255.;
        oc = uBlack + oc * (1. - uBlack);
        gl_FragColor = vec4(clamp(oc, 0., 1.), 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(sc, ortho); }
  return {
    lensMat, finalMat,
    run(srcTex) {
      lensMat.uniforms.tSrc.value = srcTex;
      pass(lensMat, lensRT);
      let src = lensRT.texture;
      levels.forEach((Lv) => {
        blurMat.uniforms.tSrc.value = src;
        blurMat.uniforms.uDir.value.set(1 / Lv.w, 0); pass(blurMat, Lv.b);
        blurMat.uniforms.tSrc.value = Lv.b.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / Lv.h); pass(blurMat, Lv.a);
        src = Lv.a.texture;
      });
      pass(finalMat, null);
    },
  };
}
