// Shock-layer emission colour for the onboard entry camera.
//
// The visible radiance of the entry shock layer is molecular/atomic band
// emission, not a blackbody. For air at 6-8 km/s the dominant visible/NIR
// systems are (e.g. Park 1990 "Nonequilibrium Hypersonic Aerothermodynamics";
// Laux, NASA EAST shock-tube spectra; Stardust/Hayabusa entry spectroscopy):
//   N2+ First Negative  B-X  391.4, 427.8, 470.9 nm      (violet/blue)
//   N2  First Positive  B-A  ~570-750 nm band sequence   (red)
//   N2  Second Positive C-B  337, 357, 380 nm           (near-UV / violet edge)
//   O I 777.4 nm, N I 742-746 / 821-868 nm              (NIR, mostly cut by the IR filter)
//   O I 615.8 nm, N I 648-649 nm (weaker red lines)
// For Mars CO2 the visible spectrum is instead CO 4th positive / CO Angstrom
// (451, 483, 520, 561 nm) and CN violet (388 nm) + C2 Swan (516 nm) -> the
// light is bluish-white to lilac, not pink.
//
// Two regions are modelled:
//   'front' - the thin nonequilibrium zone just behind the shock (and the far,
//             diffuse, recombining wake): electron-impact excitation makes
//             N2+ 1N strong relative to the red systems -> violet/lilac.
//   'core'  - the hot equilibrium layer hugging the hull: N2 1P + atomic lines
//             dominate the visible red; plus a weak continuum -> pink-red that
//             saturates to white in the camera.
// The band weights scale with shock temperature through Boltzmann factors of
// the upper-state energies (relative), so a slower / lower-energy entry shifts
// red and a faster one shifts to violet.
//
// The camera sees this through a CMOS Bayer CFA with a soft IR-cut filter.
// Typical CFA dyes: the red dye transmits a secondary violet lobe below
// ~420 nm, which is why N2+ 391 nm reads magenta rather than blue on video.

const G = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);

// Generic consumer/industrial CMOS (Sony IMX-class) CFA + IR-cut, rough Gaussian fits.
function cfa(l) {
  const ir = 1 / (1 + Math.exp((l - 668) / 11));       // IR-cut, 50% at ~668 nm
  const uv = 1 / (1 + Math.exp((385 - l) / 6));        // UV/glass cut
  const r = (0.95 * G(l, 605, 34) + 0.16 * G(l, 405, 16) + 0.55 * G(l, 700, 40)) * ir * uv;
  const g = (0.92 * G(l, 535, 40) + 0.07 * G(l, 420, 30)) * ir * uv;
  const b = (0.95 * G(l, 458, 30) + 0.05 * G(l, 560, 40)) * ir * uv;
  return [r, g, b];
}

// band list: [centre nm, sigma nm, relative strength, upper-state energy eV (relative)]
const AIR_BANDS = {
  n2p1n: [[391.4, 2.5, 1.0, 0], [427.8, 2.5, 0.45, 0], [470.9, 3, 0.10, 0]],
  n22p: [[380.5, 2, 0.35, 0], [357.7, 2, 0.5, 0]],
  n21p: [[580, 8, 0.10, 0], [595, 8, 0.18, 0], [625, 9, 0.40, 0], [654, 9, 0.55, 0], [670, 9, 0.60, 0], [705, 10, 0.55, 0], [750, 10, 0.60, 0]],
  atoms: [[615.8, 1, 0.12, 0], [648.5, 1, 0.15, 0], [656.3, 1, 0.08, 0], [746, 1, 0.8, 0], [777.4, 1, 1.6, 0], [822, 1, 0.9, 0]],
};
const CO2_BANDS = {
  co4p: [[451, 5, 0.6, 0], [483, 5, 0.9, 0], [520, 5, 0.7, 0], [561, 5, 0.45, 0]],
  cn: [[388.3, 2, 1.0, 0], [421.6, 2, 0.35, 0]],
  swan: [[516.5, 3, 0.5, 0], [473.7, 3, 0.25, 0], [563.5, 3, 0.2, 0]],
  atoms: [[777.4, 1, 0.7, 0], [656.3, 1, 0.1, 0]],
};

/** Post-shock temperature estimate (K) for air / CO2, equilibrium-ish fit to normal-shock tables. */
export function shockTemperature(v, gas = 'air') {
  const k = v / 1000;
  // air: 6 km/s -> ~6500 K, 7.4 -> ~7600 K, 11 -> ~11000 K (Anderson, fig. 14.x); CO2 a bit lower
  return gas === 'co2' ? 1500 + 720 * k : 1800 + 790 * k;
}

function integrate(bands, weights, cont) {
  const out = [0, 0, 0];
  for (let l = 340; l <= 860; l += 1) {
    let s = 0.01 * cont * (l / 600) ** -1; // weak recombination/bremsstrahlung-ish continuum
    for (const k in bands) for (const [c, w, a] of bands[k]) s += (weights[k] ?? 1) * a * G(l, c, w) / w;
    const [r, g, b] = cfa(l);
    out[0] += s * r; out[1] += s * g; out[2] += s * b;
  }
  return out;
}

/**
 * Camera-RGB (linear, white-balanced for daylight) of the shock-layer emission.
 * region: 'core' | 'front'. Returns normalised [r,g,b] (max component = 1) and
 * a relative radiance scale (arbitrary units, 1 at IFT-5 T+48:21 conditions).
 */
export function plasmaColor({ v = 7403, rho = 2.16e-5, gas = 'air', region = 'core' } = {}) {
  const T = shockTemperature(v, gas);
  const T0 = shockTemperature(7403, gas);
  // ionic (N2+) and red-system weights with Boltzmann-like temperature scaling
  const ion = Math.exp(-2.2 * (T0 / T - 1)) ;   // effective ~ (E/kT) sensitivity around T0
  let rgb;
  if (gas === 'co2') {
    rgb = integrate(CO2_BANDS, region === 'core' ? { co4p: 1, cn: 1.2, swan: 0.8, atoms: 1 } : { co4p: 1.3, cn: 0.8, swan: 0.3, atoms: 0.3 }, region === 'core' ? 0.25 : 0.05);
  } else if (region === 'core') {
    rgb = integrate(AIR_BANDS, { n2p1n: 0.8 * ion, n22p: 0.4 * ion, n21p: 1.0, atoms: 0.9 }, 0.12);
  } else {
    rgb = integrate(AIR_BANDS, { n2p1n: 2.8 * ion, n22p: 1.4 * ion, n21p: 0.45, atoms: 0.25 }, 0.02);
  }
  // camera white balance (daylight 5500 K) gains, computed from the same CFA model
  const wb = whiteBalance();
  rgb = rgb.map((c, i) => c * wb[i]);
  const m = Math.max(...rgb);
  // Radiance scaling: shock-layer radiance grows ~ rho^1 (binary-collision
  // excitation, optically thin) and very steeply with velocity (~V^8 in the
  // Tauber-Sutton fits for air around 7-9 km/s).
  const scale = (rho / 2.16e-5) * Math.pow(v / 7403, 8);
  return { rgb: rgb.map(c => c / m), scale, T };
}

let _wb = null;
function whiteBalance() {
  if (_wb) return _wb;
  const w = [0, 0, 0];
  for (let l = 380; l <= 780; l++) {
    // blackbody 5500 K
    const x = l * 1e-9, B = 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * 5500)) - 1));
    const c = cfa(l); w[0] += B * c[0]; w[1] += B * c[1]; w[2] += B * c[2];
  }
  return (_wb = [w[1] / w[0], 1, w[1] / w[2]]);
}
