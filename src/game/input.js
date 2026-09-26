// Keyboard + on-screen control input. Keys are KeyboardEvent.code values.
// On-screen buttons drive "virtual" keys so every control works by touch/mouse.

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Dispatch a key press to the page (for scenes with their own key listeners) without the game seeing it. */
export function synthKey(code) {
  for (const type of ['keydown', 'keyup']) {
    const ev = new KeyboardEvent(type, { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true });
    ev.__gameSynthetic = true;
    window.dispatchEvent(ev);
  }
}

export function createInput(target = window) {
  const down = new Set();
  const virt = new Map();          // code -> count of held virtual buttons
  let pressed = new Set();          // edge-triggered this frame
  const onDown = (e) => {
    if (e.__gameSynthetic) return;           // events we dispatch to steer a scene's own listeners
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (BLOCK.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
  };
  const onUp = (e) => { if (!e.__gameSynthetic) down.delete(e.code); };
  const onBlur = () => { down.clear(); virt.clear(); };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  const api = {
    isDown: (...codes) => codes.some((c) => down.has(c) || (virt.get(c) || 0) > 0),
    wasPressed: (...codes) => codes.some((c) => pressed.has(c)),
    /** -1..1 from two key groups. */
    axis(neg, pos) { return (api.isDown(...pos) ? 1 : 0) - (api.isDown(...neg) ? 1 : 0); },
    press(code) { pressed.add(code); },
    endFrame() { pressed = new Set(); },
    /** Make a DOM element act as a key. hold=true: held while pressed. */
    bind(el, code, { hold = true } = {}) {
      let active = false;
      const start = (e) => {
        e.preventDefault();
        if (active) return;
        active = true; el.classList.add('on');
        pressed.add(code);
        if (hold) virt.set(code, (virt.get(code) || 0) + 1);
        try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      };
      const end = () => {
        if (!active) return;
        active = false; el.classList.remove('on');
        if (hold) virt.set(code, Math.max(0, (virt.get(code) || 1) - 1));
      };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      return el;
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
  return api;
}
