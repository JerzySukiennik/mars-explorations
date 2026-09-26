// Boca Chica coastline terrain: Gulf of Mexico, beach, dune strip, tidal /
// wind-tidal flats of the Rio Grande delta (South Bay / Laguna Madre), and the
// southern tip of South Padre Island beyond Brazos Santiago Pass.
//
// World frame: origin = orbital launch mount (Pad A), +x east (Gulf side),
// -z north (toward Port Isabel / South Padre Island), +y up, metres.
// The mesh is a polar grid centred under the camera; vertices are dropped by
// d^2/2R so the Earth's curvature gives a real horizon dip.
// Surfaces output scene-linear radiance (lighting done here; haze is applied
// later in the composite pass from the depth buffer).
import { NOISE, SKY } from '../fx/glsl.js';

export const GEO = /* glsl */`
// Gulf shoreline x-position (m) as a function of northing s = -z (m)
float shoreX(float s){
  return 364. + 0.136 * s + 30. * sin(s / 1700. + 0.7) * smoothstep(0., 2500., s);
}
// 0..1: Brazos Santiago Pass (the inlet between Boca Chica and South Padre)
float passMask(float s){ return smoothstep(14200., 14350., s) * (1. - smoothstep(14750., 14900., s)); }
`;

export function makeTerrain(THREE, { camPos, sunDir, sunCol, skyIrr, flamePos, flameCol }) {
  // polar grid in a wedge around the view direction (-z)
  const nr = 220, na = 300, r0 = 30, r1 = 70000, a0 = -0.85, a1 = 0.85;
  const pos = new Float32Array((nr + 1) * (na + 1) * 3);
  let k = 0;
  for (let i = 0; i <= nr; i++) {
    const r = r0 * Math.pow(r1 / r0, i / nr);
    for (let j = 0; j <= na; j++) {
      const a = a0 + (a1 - a0) * j / na;
      pos[k++] = camPos.x + r * Math.sin(a); pos[k++] = 0; pos[k++] = camPos.z - r * Math.cos(a);
    }
  }
  // near-field disc under/behind the camera is not visible at this pitch; fine.
  const idx = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
    const a = i * (na + 1) + j, b = a + 1, c = a + na + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(camPos.x, 0, camPos.z), r1);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: camPos }, uSunDir: { value: sunDir }, uSunCol: { value: sunCol },
      uSkyIrr: { value: skyIrr }, uFlamePos: { value: flamePos }, uFlameCol: { value: flameCol },
    },
    vertexShader: /* glsl */`
      uniform vec3 uCam;
      varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.);
        vW = w.xyz;
        vec2 d = w.xz - uCam.xz;
        w.y -= dot(d, d) / (2. * 6.371e6);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${NOISE}
      ${SKY}
      ${GEO}
      uniform vec3 uCam, uSunCol, uSkyIrr, uFlamePos, uFlameCol;
      varying vec3 vW;
      vec3 shadeGround(vec2 p, vec3 V, float fp, float fpx){
        float s = -p.y;
        float sx = shoreX(s);
        float pass = passMask(s);
        // SPI beyond the pass: barrier island ~900 m wide, Laguna Madre behind
        float spi = step(14800., s);
        float dx = p.x - sx;                       // + into the sea
        float nWarp = fbm2f(p / 900., fp / 900., 4);
        float isSea = step(0., dx + 18. * (nWarp - .5));
        vec3 albedo; float water = 0.;
        vec3 col;
        // ---------------- land classification ----------------
        float beachW = 13. + 5. * vnoise2(vec2(s / 400., 3.));
        float duneW = 260. + 220. * fbm2f(vec2(s / 1300., 7.), fp / 1300., 3);
        float dune = smoothstep(-beachW, -beachW - 10., dx) * (1. - smoothstep(-duneW, -duneW - 60., dx));
        vec2 q = p + 700. * vec2(fbm2f(p / 2600. + 3.1, fp / 2600., 3) - .5, fbm2f(p / 2600. + 9.7, fp / 2600., 3) - .5);
        // flats features are elongated roughly N-S (drainage toward the bay)
        float wf = fbm2f(q * vec2(1. / 900., 1. / 3200.), fp / 900., 6);
        // zones: marsh/scrub (near, west of the site), open bay with vegetated
        // islands and levee lines (far west / north), bare wet sand flats between
        // the site and the dune ridge
        float bay = smoothstep(3500., 4700., s + .15 * max(-p.x, 0.) + 900. * (wf - .5));
        float flats = smoothstep(-300., 50., p.x + 300. * (wf - .5)) * (1. - bay);
        float marshZ = (1. - bay) * (1. - flats);
        // bay: water except islands; flats: water in the lows; marsh: mostly dry
        float wet = wf + bay * .08 + flats * .06 - marshZ * .36;
        water = smoothstep(.555, .575, wet);
        water *= 1. - dune;
        // meandering tidal channels (ridged noise): open water in the marsh...
        float ch = abs(fbm2f(q * vec2(1. / 520., 1. / 1400.) + 11.3, fp / 520., 5) - .5);
        water = max(water, (1. - smoothstep(.002, .005, ch)) * (1. - dune) * marshZ * .25);
        float ch2 = abs(fbm2f(q / 190. + 4.7, fp / 190., 4) - .5);
        water = max(water, (1. - smoothstep(.008, .015, ch2)) * (1. - dune) * (.6 * flats) * smoothstep(.35, .5, wf));
        // ...and dark vegetated levees snaking through the open bay
        float lev = abs(fbm2f(q * vec2(1. / 800., 1. / 3000.) + 2.2, fp / 800., 5) - .5);
        float levee = (1. - smoothstep(.018, .034, lev)) * bay;
        water *= 1. - levee;
        vec3 marsh = mix(vec3(.024, .022, .009), vec3(.040, .035, .014), vnoise2(p / 140.));
        vec3 bare = mix(vec3(.26, .215, .175), vec3(.36, .30, .25), vnoise2(p / 220.));
        vec3 duneC = mix(vec3(.075, .055, .034), vec3(.11, .080, .050), vnoise2(p / 90.));
        vec3 beachC = mix(vec3(.20, .18, .15), vec3(.09, .08, .068), smoothstep(-beachW * .45, -2., dx));
        float bareMix = flats * smoothstep(.36, .46, wet + .08 * vnoise2(p / 300.));
        albedo = mix(marsh, bare, bareMix);
        albedo = mix(albedo, duneC, dune);
        albedo = mix(albedo, beachC, smoothstep(-beachW - 6., -beachW + 4., dx));
        water *= 1. - smoothstep(-beachW - 30., -beachW - 5., dx);
        float padD = length(p);
        albedo = mix(albedo, vec3(.30, .29, .27), 1. - smoothstep(90., 110., padD));
        water *= smoothstep(140., 260., padD);
        float mainland = smoothstep(11000., 14000., s + 2500. * (wf - .5)) * smoothstep(-500., -2500., p.x);
        water *= 1. - mainland;
        albedo = mix(albedo, marsh * 1.3, mainland);
        float lag = spi * smoothstep(-900., -1000., dx);
        water = max(water * (1. - spi), lag);
        isSea = max(isSea, pass);
        // ---------------- lighting ----------------
        float sunH = max(uSunDir.y, 0.);
        // low sun on vegetated / rippled ground: effective incidence much steeper than
        // on a flat plane (canopy, dune faces, ripples facing the sun)
        vec3 E = uSkyIrr + uSunCol * max(sunH, .0) * 3.1416 * 3.2;
        float fd = length(p - uFlamePos.xz);
        E += uFlameCol / (fd * fd + 2.0e4) * 2.;
        col = albedo / 3.1416 * E;
        // water: sky reflection with Fresnel; wind ripple lowers grazing reflectance
        vec3 R = reflect(V, vec3(0., 1., 0.));
        float cosi = max(-V.y, 0.);
        float F = .02 + .98 * pow(1. - cosi, 5.);
        vec3 wcol = skyColor(normalize(R + vec3(0., .034, 0.))) * F + vec3(.020, .019, .015) * (1. - F);
        col = mix(col, wcol, water);
        // ---------------- sea ----------------
        if (isSea > .5) {
          // wind sea: facets tilted ~8 deg on average -> effective incidence well
          // below grazing, reflecting sky from a few degrees up
          // swell crests run parallel to the shore (long in s, short across)
          float sw = vnoise2(vec2(dx / 30., s / 420.)) * .7 + vnoise2(vec2(dx / 11., s / 160.)) * .3;
          float lod = smoothstep(.2, 2.5, fp / 6.);
          float slope = (sw - .5) * .045 * (1. - lod * .5);
          float ci = clamp(cosi + .115 + slope, 0., 1.);
          float Fs = .02 + .98 * pow(1. - ci, 5.);
          vec3 Rs = normalize(vec3(R.x, max(R.y, 0.) + .03 + max(slope, 0.) * .5, R.z));
          vec3 sea = skyColor(Rs) * vec3(1., .97, .92) * Fs * .56 + vec3(.009, .010, .010) * (1. - Fs);
          // surf zone (~150 m): spilling breakers + streaky residual foam
          float surf = 1. - smoothstep(20., 120., dx);
          float br = 0.;
          for (int i = 0; i < 5; i++) {
            float lineD = 10. + float(i) * 30. + 12. * vnoise2(vec2(float(i) * 7., s / 180.));
            float w = 5. + 7. * vnoise2(vec2(s / 60., float(i)));
            br += (1. - smoothstep(0., w, abs(dx - lineD))) * smoothstep(.3, .75, vnoise2(vec2(s / 70. + float(i) * 3.3, 1.7))) * (1. - float(i) * .18) * .75;
          }
          br += surf * .45 * smoothstep(.62, .85, vnoise2(vec2(dx / 6., s / 45.))) + surf * .15 * vnoise2(vec2(dx / 25., s / 200.));
          br += (1. - smoothstep(0., 10., dx)) * .8;   // swash
          br *= 1. - smoothstep(4., 40., fpx) * .85;
          vec3 foamC = vec3(.62, .60, .58) / 3.1416 * E;
          sea = mix(sea, foamC, clamp(br, 0., 1.) * .75);
          col = sea;
        }
        return col;
      }
      void main(){
        // The ground is seen at 1-4 deg grazing: one pixel spans ~1 m across
        // but 20-80 m in depth. Supersample along the screen-y footprint so thin
        // tidal channels survive instead of being filtered away isotropically.
        vec3 V = normalize(vW - uCam);
        vec2 gx = dFdx(vW.xz), gy = dFdy(vW.xz);
        const int NS = 6;
        float fp = max(max(length(gx), length(gy) / float(NS)), .05);
        float fpx = max(abs(gx.x) + abs(gy.x), .05);
        vec3 c = vec3(0.);
        for (int i = 0; i < NS; i++){
          float o = (float(i) + .5) / float(NS) - .5;
          c += shadeGround(vW.xz + gy * o + gx * (fract(float(i) * .618) - .5) * .8, V, fp, fpx);
        }
        gl_FragColor = vec4(c / float(NS), 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// South Padre Island skyline (condos / hotels) seen across the pass, ~22-30 km.
export function makeSPI(THREE, rng, mat, camPos) {
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, .5, 0);
  const n = 46; const im = new THREE.InstancedMesh(g, mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const s = 19000 + rng() * 9000;
    const x = 364 + 0.136 * s - 650 - rng() * 600;
    const tall = rng() < .35;
    const h = tall ? 25 + rng() * 45 : 8 + rng() * 14;
    const w = 25 + rng() * 45, d = 20 + rng() * 40;
    const dd = (x - camPos.x) ** 2 + (-s - camPos.z) ** 2;
    m.compose(new THREE.Vector3(x, -dd / (2 * 6.371e6), -s), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    im.setMatrixAt(i, m);
  }
  return im;
}
