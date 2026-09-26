// Webcast-style telemetry strip, laid out like the SpaceX Starship flight-test
// overlay: left block Super Heavy (33-engine ring diagram, SPEED km/h,
// ALTITUDE km, LOX / CH4 bars, attitude icon), centre mission clock, right
// block Starship (3 sea-level + 3 RVac engine diagram). A block dims when its
// vehicle is inactive, as on the broadcast.

import { el, esc } from './ui.js';

// Engine positions in unit-circle coordinates.
function boosterLayout() {
  const pts = [];
  for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 3; pts.push([0.15 * Math.cos(a), 0.15 * Math.sin(a), 0.085]); }
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 10; pts.push([0.44 * Math.cos(a), 0.44 * Math.sin(a), 0.085]); }
  for (let i = 0; i < 20; i++) { const a = -Math.PI / 2 + (i + 0.5) * 2 * Math.PI / 20; pts.push([0.83 * Math.cos(a), 0.83 * Math.sin(a), 0.085]); }
  return pts;
}
function shipLayout() {
  const pts = [];
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2 * Math.PI / 3; pts.push([0.2 * Math.cos(a), 0.2 * Math.sin(a), 0.14]); }        // sea level (centre)
  for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 3; pts.push([0.64 * Math.cos(a), 0.64 * Math.sin(a), 0.3]); }     // RVac (outer, larger bells)
  return pts;
}
export const LAYOUTS = { booster: boosterLayout(), ship: shipLayout() };

/** Draw an engine diagram: lit engines solid white, unlit as grey outlines. */
export function drawEngines(cv, layout, lit) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = cv.clientWidth || 96;
  if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const R = size / 2 - 1;
  layout.forEach(([x, y, r], i) => {
    const on = !!lit[i];
    g.beginPath();
    g.arc(size / 2 + x * R, size / 2 + y * R, r * R, 0, Math.PI * 2);
    if (on) { g.fillStyle = '#ffffff'; g.fill(); }
    else { g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke(); }
  });
}

function vehicleIcon(kind) {
  // Simple outline of the vehicle, rotated by pitch on update.
  const svg = kind === 'booster'
    ? `<svg viewBox="-20 -60 40 120" class="g-wc-icon"><line x1="-60" y1="0" x2="60" y2="0" class="hz"/><g class="veh"><path d="M-4 -52 L0 -58 L4 -52 L4 -20 L-4 -20 Z M-4 -20 L4 -20 L4 52 L-4 52 Z M-6 52 L6 52 L5 56 L-5 56 Z"/></g></svg>`
    : `<svg viewBox="-20 -60 40 120" class="g-wc-icon"><line x1="-60" y1="0" x2="60" y2="0" class="hz"/><g class="veh"><path d="M-5 -40 Q0 -58 5 -40 L5 30 L10 40 L-10 40 L-5 30 Z"/></g></svg>`;
  return svg;
}

export function createWebcast(root, { title = 'STARSHIP FLIGHT TEST', boosterLabel = 'SUPER HEAVY', shipLabel = 'STARSHIP', booster = true } = {}) {
  const strip = el('div', 'g-webcast');
  const block = (kind, label) => {
    const b = el('div', `g-wc-block g-wc-${kind}`);
    const cv = el('canvas', 'g-wc-engines');
    const tele = el('div', 'g-wc-tele');
    tele.innerHTML = `
      <div class="g-wc-name">${esc(label)}</div>
      <div class="g-wc-line"><span class="k">SPEED</span><span class="v" data-k="spd">0</span><span class="u">KM/H</span></div>
      <div class="g-wc-line"><span class="k">ALTITUDE</span><span class="v" data-k="alt">0</span><span class="u">KM</span></div>
      <div class="g-wc-tank"><span class="k">LOX</span><span class="g-wc-tbar"><i data-k="lox"></i></span></div>
      <div class="g-wc-tank"><span class="k">CH4</span><span class="g-wc-tbar"><i data-k="ch4"></i></span></div>`;
    const icon = el('div', 'g-wc-att', vehicleIcon(kind));
    if (kind === 'booster') b.append(cv, tele, icon); else b.append(icon, tele, cv);
    const q = (k) => tele.querySelector(`[data-k="${k}"]`);
    return { b, cv, spd: q('spd'), alt: q('alt'), lox: q('lox'), ch4: q('ch4'), veh: icon.querySelector('.veh'), last: {} };
  };
  const B = booster ? block('booster', boosterLabel) : null;
  const centre = el('div', 'g-wc-centre');
  const clockEl = el('div', 'g-wc-clock', 'T-00:00:10');
  const titleEl = el('div', 'g-wc-title', esc(title));
  const timeline = el('div', 'g-wc-events');
  centre.append(clockEl, titleEl, timeline);
  const S = block('ship', shipLabel);
  if (B) strip.append(B.b);
  else strip.append(el('div', 'g-wc-block g-wc-spacer'));
  strip.append(centre, S.b);
  root.append(strip);

  const setBlock = (X, d, layout) => {
    if (!X || !d) return;
    const spd = Math.round(d.speedKmh).toLocaleString('en-US').replace(/,/g, ' ');
    const alt = d.altKm < 10 ? d.altKm.toFixed(1) : Math.round(d.altKm).toString();
    if (X.last.spd !== spd) { X.spd.textContent = spd; X.last.spd = spd; }
    if (X.last.alt !== alt) { X.alt.textContent = alt; X.last.alt = alt; }
    X.lox.style.width = `${Math.max(0, Math.min(1, d.lox)) * 100}%`;
    X.ch4.style.width = `${Math.max(0, Math.min(1, d.ch4)) * 100}%`;
    X.b.classList.toggle('dim', !d.active);
    X.veh.setAttribute('transform', `rotate(${(d.pitchDeg || 0).toFixed(1)})`);
    const key = d.lit.map((x) => (x ? 1 : 0)).join('');
    if (X.last.lit !== key || X.last.w !== X.cv.clientWidth) { drawEngines(X.cv, layout, d.lit); X.last.lit = key; X.last.w = X.cv.clientWidth; }
  };

  return {
    root: strip,
    /** data: { t, booster:{...}, ship:{...}, events:[names] } */
    update(data) {
      const c = data.clock ?? '';
      if (clockEl.textContent !== c) clockEl.textContent = c;
      if (data.title && titleEl.textContent !== data.title) titleEl.textContent = data.title;
      setBlock(B, data.booster, LAYOUTS.booster);
      setBlock(S, data.ship, LAYOUTS.ship);
      if (data.events) {
        const html = data.events.slice(-3).map((e) => `<span>${esc(e)}</span>`).join('');
        if (timeline._h !== html) { timeline.innerHTML = html; timeline._h = html; }
      }
    },
  };
}
