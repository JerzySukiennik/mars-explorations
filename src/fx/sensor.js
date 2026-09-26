// Broadcast camera model for the webcast long-lens tracking shot:
//  - lens veiling glare / bloom (multi-scale Gaussian of the HDR image)
//  - optical MTF (small Gaussian blur) + slight chromatic softness
//  - per-channel filmic highlight roll-off 1-exp(-x) (hue shifts toward
//    yellow/white as red then green clip, like the real video)
//  - Rec.709 OETF-ish (sRGB), 4:2:0 chroma resolution loss, vignetting,
//    low-level sensor noise (deterministic hash).
export function makeSensor(THREE, renderer, W, H) {
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const sc = new THREE.Scene(); sc.add(quad);
  const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const levels = [];
  let w = W, h = H;
  for (let i = 0; i < 5; i++) {
    w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
    levels.push({ a: new THREE.WebGLRenderTarget(w, h, rtOpts), b: new THREE.WebGLRenderTarget(w, h, rtOpts), w, h });
  }
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uThresh: { value: 0 } },
    vertexShader: vs,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; uniform float uThresh; varying vec2 vUv;
      void main(){ vec3 s = vec3(0.); float wt[5]; wt[0]=.227; wt[1]=.1945; wt[2]=.1216; wt[3]=.054; wt[4]=.0162;
        for (int i=-4;i<=4;i++){ vec3 c = texture2D(tSrc, vUv + uDir * float(i)).rgb; s += max(c - uThresh, 0.) * wt[i<0?-i:i]; }
        gl_FragColor = vec4(s, 1.); }`,
    depthTest: false, depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tHdr: { value: null }, tB0: { value: levels[0].a.texture }, tB1: { value: levels[1].a.texture }, tB2: { value: levels[2].a.texture },
      tB3: { value: levels[3].a.texture }, tB4: { value: levels[4].a.texture },
      uRes: { value: new THREE.Vector2(W, H) }, uExposure: { value: 1 }, uBloom: { value: .10 }, uSeed: { value: 1 },
    },
    vertexShader: vs,
    fragmentShader: /* glsl */`
      uniform sampler2D tHdr, tB0, tB1, tB2, tB3, tB4; uniform vec2 uRes; uniform float uExposure, uBloom, uSeed; varying vec2 vUv;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 tap(vec2 o){ return texture2D(tHdr, vUv + o / uRes).rgb; }
      vec3 tone(vec3 x){ return 1. - exp(-max(x, 0.)); }
      vec3 oetf(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
      void main(){
        // optical MTF: 3x3 Gaussian (sigma ~0.85 px)
        vec3 c = tap(vec2(0)) * .25 + (tap(vec2(1,0)) + tap(vec2(-1,0)) + tap(vec2(0,1)) + tap(vec2(0,-1))) * .125
               + (tap(vec2(1,1)) + tap(vec2(-1,1)) + tap(vec2(1,-1)) + tap(vec2(-1,-1))) * .0625;
        vec3 b = texture2D(tB0, vUv).rgb * .20 + texture2D(tB1, vUv).rgb * .18 + texture2D(tB2, vUv).rgb * .2 + texture2D(tB3, vUv).rgb * .22 + texture2D(tB4, vUv).rgb * .20;
        c += b * uBloom;
        c *= uExposure;
        vec2 d = vUv - .5; d.x *= uRes.x / uRes.y;
        c *= 1. - .05 * dot(d, d);
        vec3 t = tone(c);
        // 4:2:0-like chroma softening: pull chroma toward the local (2x2) mean
        vec3 cn = (tone(tap(vec2(1.,0.)) * uExposure) + tone(tap(vec2(0.,1.)) * uExposure) + tone(tap(vec2(1.,1.)) * uExposure) + t) * .25;
        float Y = dot(t, vec3(.2126, .7152, .0722)), Yn = dot(cn, vec3(.2126, .7152, .0722));
        t = Y + (cn - Yn) * .6 + (t - Y) * .4;
        vec3 o = oetf(clamp(t, 0., 1.));
        float n = (h12(gl_FragCoord.xy + uSeed) + h12(gl_FragCoord.xy * 1.37 + 17.) - 1.) * (1.6 / 255.);
        o += n;
        gl_FragColor = vec4(clamp(o, 0., 1.), 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(sc, ortho); }
  return {
    finalMat,
    run(hdrTex) {
      let src = hdrTex;
      levels.forEach((L, i) => {
        blurMat.uniforms.tSrc.value = src; blurMat.uniforms.uThresh.value = i === 0 ? 2.0 : 0;
        blurMat.uniforms.uDir.value.set(1 / L.w, 0); pass(blurMat, L.b);
        blurMat.uniforms.tSrc.value = L.b.texture; blurMat.uniforms.uThresh.value = 0;
        blurMat.uniforms.uDir.value.set(0, 1 / L.h); pass(blurMat, L.a);
        src = L.a.texture;
      });
      finalMat.uniforms.tHdr.value = hdrTex;
      pass(finalMat, null);
    },
  };
}
