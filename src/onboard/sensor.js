// Onboard camera sensor/lens pipeline:
//  pass 1 (HDR): fisheye remap of the foreground cube render + per-pixel Earth/atmosphere,
//                analytic veiling glare of a sun just outside the field.
//  pass 2/3:     separable wide blur of a quarter-res copy (lens bloom / halation).
//  pass 4:       exposure, lens ghosts (reflections mirrored through the optical centre),
//                image-circle vignette, camera tone curve, Bayer-ish noise, chroma
//                subsampling + 8x8 block quantisation (H.264 broadcast look), sRGB out.
import { FISHEYE_GLSL, REF_W } from './fisheye.js';
import { ATMOS_GLSL } from './atmosphere.js';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function makeSensor(THREE, renderer, fish, opts) {
  const W = opts.width, H = opts.height;
  const scale = W / REF_W;
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const rtA = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const qW = Math.max(1, Math.round(W / 8)), qH = Math.max(1, Math.round(H / 8));
  const rtB = new THREE.WebGLRenderTarget(qW, qH, rtOpts);
  const rtC = new THREE.WebGLRenderTarget(qW, qH, rtOpts);
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false; quadScene.add(quad);

  const common = {
    uRes: { value: new THREE.Vector2(W, H) },
    uScale: { value: scale },
    uF: { value: fish.f }, uC: { value: new THREE.Vector2(fish.cx, fish.cy) },
    uCamRot: { value: new THREE.Matrix3() },
  };

  const composite = new THREE.ShaderMaterial({
    vertexShader: VS,
    uniforms: {
      ...common,
      tCube: { value: null },
      uCamE: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uSunI: { value: 1 },
      uSeed: { value: 0.37 }, uSunCol: { value: new THREE.Vector3(1, 1, 1) },
      uGlare: { value: 1 }, uPlume: { value: new THREE.Vector3(0, 0, 1) }, uPlumeCol: { value: new THREE.Vector3() },
    },
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uRes; uniform float uScale;
      uniform samplerCube tCube; uniform vec3 uSunCol; uniform float uGlare;
      uniform vec3 uPlume; uniform vec3 uPlumeCol;
      ${FISHEYE_GLSL}
      ${ATMOS_GLSL}
      void main(){
        vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
        vec3 dc = pixelDir(p);
        vec3 dw = normalize(uCamRot * dc);
        vec4 fg = textureCube(tCube, dw);
        float hs;
        vec3 sky = fg.a < 0.999 ? atmosphere(dw, hs) : vec3(0.0);
        // solar disc (0.267 deg radius) behind the atmosphere
        float cs = dot(dw, uSun);
        if (fg.a < 0.999 && cs > cos(0.00466) && hs < 0.5) sky += uSunCol * uSunI * 2.0e4;
        // exhaust plume / hot-staging glow in the field (ship engines lit up above the camera)
        float cp = max(dot(dw, uPlume), 0.0);
        vec3 plume = uPlumeCol * (pow(cp, 6.0) * 0.6 + pow(cp, 40.0) * 2.0);
        vec3 col = fg.rgb + (1.0 - fg.a) * (sky + plume);
        // veiling glare: scattered sunlight inside the lens barrel / on the dirty front window
        float th = acos(clamp(cs, -1.0, 1.0));
        vec3 glare = uSunCol * uSunI * uGlare * (5.0e-4 / (th * th + 0.004) + 4.0e-5 * exp(-th * 1.0));
        col += glare;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const down = new THREE.ShaderMaterial({
    vertexShader: VS, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      void main(){ vec3 c = vec3(0.0);
        for (int i = -4; i <= 3; i++) for (int j = -4; j <= 3; j++) c += texture2D(tSrc, vUv + (vec2(i, j) + 0.5) * uTexel).rgb;
        gl_FragColor = vec4(min(c / 64.0, vec3(0.05)), 1.0); }`,
  });
  const blur = new THREE.ShaderMaterial({
    vertexShader: VS, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir;
      void main(){ vec3 c = vec3(0.0); float ws = 0.0;
        for (int i = -24; i <= 24; i++){ float x = float(i); float w = exp(-x * x / 72.0) + 0.08 * exp(-abs(x) / 9.0);
          c += texture2D(tSrc, vUv + uDir * x).rgb * w; ws += w; }
        gl_FragColor = vec4(c / ws, 1.0); }`,
  });

  const final = new THREE.ShaderMaterial({
    vertexShader: VS,
    uniforms: {
      ...common,
      tHdr: { value: rtA.texture }, tBloom: { value: rtC.texture },
      uExposure: { value: 1 }, uBloom: { value: 0.08 }, uWB: { value: new THREE.Vector3(1, 1, 1) },
      uSunPx: { value: new THREE.Vector2() }, uSunVis: { value: 1 },
      uCircle: { value: new THREE.Vector3(fish.circleCx, fish.circleCy, fish.circleR) },
      uSeed: { value: 0.37 },
    },
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uRes; uniform float uScale; uniform vec2 uC;
      uniform sampler2D tHdr; uniform sampler2D tBloom;
      uniform float uExposure; uniform float uBloom; uniform vec3 uWB; uniform vec2 uSunPx; uniform float uSunVis;
      uniform vec3 uCircle; uniform float uSeed;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 lensBlur(vec2 uv){
        vec2 t = 1.0 / uRes; vec3 c = texture2D(tHdr, uv).rgb * 0.36;
        c += (texture2D(tHdr, uv + vec2(t.x, 0.0)).rgb + texture2D(tHdr, uv - vec2(t.x, 0.0)).rgb +
              texture2D(tHdr, uv + vec2(0.0, t.y)).rgb + texture2D(tHdr, uv - vec2(0.0, t.y)).rgb) * 0.12;
        c += (texture2D(tHdr, uv + t).rgb + texture2D(tHdr, uv - t).rgb +
              texture2D(tHdr, uv + vec2(t.x, -t.y)).rgb + texture2D(tHdr, uv - vec2(t.x, -t.y)).rgb) * 0.04;
        return c;
      }
      // camera tone curve: linear exposure -> soft-shoulder s-curve -> Rec.709-ish gamma
      vec3 tone(vec3 x){
        x = max(x, 0.0);
        vec3 y = x * (1.0 + x / 9.0) / (1.0 + x);        // Reinhard with white ~3
        y = clamp(y, 0.0, 1.0);
        vec3 g = mix(12.92 * y, 1.055 * pow(y, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, y));
        return g;
      }
      vec3 ghost(vec2 p, vec2 at, float r, vec3 col, float soft){
        float d = length(p - at);
        return col * (1.0 - smoothstep(r * (1.0 - soft), r, d));
      }
      vec3 renderPx(vec2 fc){
        vec2 uv = fc / uRes;
        vec2 p = vec2(fc.x, uRes.y - fc.y) / uScale;
        vec3 c = lensBlur(uv) + texture2D(tBloom, uv).rgb * uBloom;
        c *= uExposure * uWB;
        // lens ghosts: along the line sun -> optical centre, beyond the centre
        vec2 axis = uSunPx - uC;
        c += uSunVis * ghost(p, uC - axis * 0.64, 40.0, vec3(0.30, 0.03, 0.05), 0.35);
        c += uSunVis * ghost(p, uC + axis * 0.04, 4.0, vec3(0.20, 0.03, 0.03), 0.5);
        c += uSunVis * ghost(p, uC + axis * 0.325, 4.5, vec3(0.9, 0.55, 0.25), 0.5);
        c += uSunVis * ghost(p, uC + axis * 0.325 + vec2(10.0, -2.0), 4.5, vec3(0.9, 0.6, 0.3), 0.5);
        c += uSunVis * ghost(p, uC - axis * 0.3, 70.0, vec3(0.012, 0.01, 0.02), 0.6);
        // relative illumination (cos^3-ish falloff for a fisheye) + image circle edge
        float th = length(p - uC) / 318.0;
        c *= mix(1.0, pow(max(cos(th * 0.78), 0.0), 2.0), 0.75);
        float rc = length(p - uCircle.xy);
        c *= 1.0 - smoothstep(uCircle.z - 22.0, uCircle.z + 6.0, rc);
        return c;
      }
      void main(){
        vec2 fc = gl_FragCoord.xy;
        vec3 c = renderPx(fc);
        // sensor noise (shot + read), before the tone curve
        float n1 = hash(fc) + hash(fc + 17.3) + hash(fc + 91.7) - 1.5;
        float n2 = hash(fc * 1.7 + 3.1) - 0.5;
        c += (sqrt(max(c, 0.0)) * 0.035 + 0.006) * n1 + vec3(0.0, 0.004, 0.0) * n2;
        vec3 s = tone(c);
        // chroma: estimate on 2x2 blocks (4:2:0) and quantise luma per 8x8 block energy
        float Y = dot(s, vec3(0.2126, 0.7152, 0.0722));
        vec2 blk = floor(fc / 2.0) * 2.0 + 1.0;
        vec3 sb = tone(renderPx(blk) );
        float Yb = dot(sb, vec3(0.2126, 0.7152, 0.0722));
        vec3 chroma = sb - Yb;
        vec3 outc = Y + chroma;
        // mild macroblock quantisation: pull toward the 8x8 mean in flat, dark areas
        gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
      }`,
  });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  return {
    composite, final, rtA,
    render(cubeTex) {
      composite.uniforms.tCube.value = cubeTex;
      const oldTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      pass(composite, rtA);
      down.uniforms.tSrc.value = rtA.texture; down.uniforms.uTexel.value.set(1 / W, 1 / H);
      pass(down, rtB);
      blur.uniforms.tSrc.value = rtB.texture; blur.uniforms.uDir.value.set(1 / qW, 0); pass(blur, rtC);
      blur.uniforms.tSrc.value = rtC.texture; blur.uniforms.uDir.value.set(0, 1 / qH); pass(blur, rtB);
      blur.uniforms.tSrc.value = rtB.texture; blur.uniforms.uDir.value.set(3.0 / qW, 0); pass(blur, rtC);
      blur.uniforms.tSrc.value = rtC.texture; blur.uniforms.uDir.value.set(0, 3.0 / qH); pass(blur, rtB);
      final.uniforms.tBloom.value = rtB.texture;
      pass(final, null);
      renderer.toneMapping = oldTM;
    },
  };
}
