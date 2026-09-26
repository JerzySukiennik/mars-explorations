// DOM helpers for the mission-instrument HUD. All styles live in index.html
// (classes prefixed g-). Nothing here touches three.js.

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmt(x, d = 0) {
  if (!Number.isFinite(x)) return '--';
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Mission clock: T-00:00:10 / T+00:02:31. */
export function clock(t) {
  const sign = t < 0 ? '-' : '+';
  const a = Math.floor(Math.abs(t) + (t < 0 ? 0.999 : 0));
  const h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, s = a % 60;
  return `T${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Instrument panel with titled rows. Returns {root, set(id, html), row(...)}. */
export function panel(title, cls = '') {
  const root = el('section', `g-panel ${cls}`);
  if (title) root.appendChild(el('h3', 'g-ptitle', esc(title)));
  const cells = {};
  const api = {
    root,
    row(id, label, unit = '') {
      const r = el('div', 'g-row');
      r.append(el('span', 'g-lab', esc(label)));
      const v = el('span', 'g-val', '--'); r.append(v);
      if (unit) r.append(el('span', 'g-unit', esc(unit)));
      root.append(r); cells[id] = v; return api;
    },
    bar(id, label) {
      const r = el('div', 'g-row g-barrow');
      r.append(el('span', 'g-lab', esc(label)));
      const b = el('span', 'g-bar'); const f = el('i'); b.append(f); r.append(b);
      const v = el('span', 'g-val g-small', ''); r.append(v);
      root.append(r); cells[id] = { bar: f, val: v, row: r }; return api;
    },
    text(id, cls = 'g-note') { const t = el('div', cls, ''); root.append(t); cells[id] = t; return api; },
    set(id, html) { const c = cells[id]; if (c && !c.bar && c._h !== html) { c.innerHTML = html; c._h = html; } return api; },
    setBar(id, frac, label = '', state = '') {
      const c = cells[id]; if (!c) return api;
      const w = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      if (c.bar.style.width !== w) c.bar.style.width = w;
      if (c.val._h !== label) { c.val.textContent = label; c.val._h = label; }
      if (c.row._s !== state) { c.row.dataset.state = state; c.row._s = state; }
      return api;
    },
    flag(id, state) { const c = cells[id]; if (c) { const n = c.bar ? c.row : c; if (n.dataset.state !== state) n.dataset.state = state; } return api; },
    cell: (id) => cells[id],
  };
  return api;
}

/**
 * On-screen control pad. buttons: [{label, code, hold, cls, title}] grouped as
 * rows (arrays). Returns the root element.
 */
export function controlPad(input, rows, cls = '') {
  const root = el('div', `g-pad ${cls}`);
  for (const row of rows) {
    const r = el('div', 'g-padrow');
    for (const b of row) {
      if (!b) { r.append(el('span', 'g-gap')); continue; }
      const btn = el('button', `g-btn ${b.cls || ''}`, esc(b.label));
      btn.type = 'button';
      if (b.title) btn.title = b.title;
      input.bind(btn, b.code, { hold: b.hold !== false });
      r.append(btn);
    }
    root.append(r);
  }
  return root;
}

/** Help overlay listing keys: [[keys, action]]. */
export function helpBox(title, items) {
  const root = el('div', 'g-help');
  root.append(el('h3', 'g-ptitle', esc(title)));
  const t = el('table');
  for (const [k, a] of items) {
    const tr = el('tr');
    tr.append(el('td', 'g-keys', k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')));
    tr.append(el('td', '', esc(a)));
    t.append(tr);
  }
  root.append(t);
  return root;
}

/** Size a canvas to its CSS box at devicePixelRatio (<=2). Returns 2d context. */
export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

/** Throttle a callback to hz (for DOM/canvas HUD refresh). */
export function every(hz) {
  let acc = 1e9;
  return (dt) => { acc += dt; if (acc >= 1 / hz) { acc = 0; return true; } return false; };
}
