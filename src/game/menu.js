// Mission-select menu, rendered as DOM over the 'menu' scene's canvas.
// Continue / start a campaign, or play any phase directly.
import * as Campaign from './campaign.js';
import { el, esc } from './ui.js';

export function createMenu({ root, goto, storage }) {
  let c = Campaign.load(storage);
  const wrap = el('div', 'g-menu');
  root.append(wrap);
  let focus = 0;

  function render() {
    const p = Campaign.progress(c);
    const cards = Campaign.PHASES.map((id, i) => {
      const s = c.phases[id], info = Campaign.PHASE_INFO[id];
      const st = s.status === 'complete' ? 'COMPLETE' : id === c.current && !c.complete ? 'NEXT' : s.status === 'locked' ? 'LOCKED IN CAMPAIGN' : 'OPEN';
      return `<li class="g-card" data-i="${i}" data-state="${esc(s.status)}">
        <div class="g-cardnum">${String(i + 1).padStart(2, '0')}</div>
        <div class="g-cardbody"><div class="g-cardtitle">${esc(info.title.toUpperCase())}</div>
          <div class="g-note">${esc(info.blurb)}</div>
          <div class="g-cardmeta"><span data-st="${esc(st)}">${esc(st)}</span>${s.best != null ? `<span>BEST ${s.best}</span>` : ''}${s.attempts ? `<span>${s.attempts} ATTEMPT${s.attempts > 1 ? 'S' : ''}</span>` : ''}</div></div>
        <button class="g-btn" type="button" data-play="${id}">PLAY</button></li>`;
    }).join('');
    wrap.innerHTML = `
      <header class="g-mhead">
        <div class="g-eyebrow">STARSHIP TO MARS</div>
        <h1>MARS EXPLORATIONS</h1>
        <p class="g-note">Six mission phases on published physics: Raptor nozzle theory, Lambert transfers, the Mars atmosphere, Perseverance power. Fly them in order as a campaign, or jump straight into any phase.</p>
      </header>
      <section class="g-camp">
        <div class="g-progress">${Campaign.PHASES.map((id) => `<i data-state="${c.phases[id].status}" title="${esc(Campaign.PHASE_INFO[id].title)}"></i>`).join('')}</div>
        <div class="g-campinfo">${c.complete ? 'CAMPAIGN COMPLETE' : `CAMPAIGN: ${p.done} / ${p.total} PHASES`} &nbsp; SCORE ${p.totalScore}</div>
        <div class="g-dlgbtns">
          <button class="g-btn primary" type="button" data-act="continue">${c.complete ? 'REPLAY CAMPAIGN' : p.done ? `CONTINUE: ${esc(Campaign.PHASE_INFO[c.current].title.toUpperCase())}` : 'START CAMPAIGN'}</button>
          <button class="g-btn" type="button" data-act="reset">NEW CAMPAIGN</button>
        </div>
      </section>
      <ol class="g-cards">${cards}</ol>
      <footer class="g-mfoot g-note">Views: <a href="?scene=orbit">orbit</a> / <a href="?scene=onboard">onboard</a>. Keys in every phase: H shows controls, Esc pauses, comma / period change time warp. Arrow keys + Enter work in this menu.</footer>`;
    wrap.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.play, 'single')));
    wrap.querySelector('[data-act="continue"]').addEventListener('click', cont);
    wrap.querySelector('[data-act="reset"]').addEventListener('click', () => { c = Campaign.reset(storage); render(); });
    highlight();
  }

  function cont() {
    if (c.complete) { c = Campaign.reset(storage); }
    goto(c.current, 'campaign');
  }

  function highlight() {
    wrap.querySelectorAll('.g-card').forEach((n, i) => n.classList.toggle('focus', i === focus));
  }

  const onKey = (e) => {
    if (e.code === 'ArrowDown') { focus = Math.min(Campaign.PHASES.length - 1, focus + 1); highlight(); e.preventDefault(); }
    else if (e.code === 'ArrowUp') { focus = Math.max(0, focus - 1); highlight(); e.preventDefault(); }
    else if (e.code === 'Enter' && document.activeElement?.tagName !== 'BUTTON') goto(Campaign.PHASES[focus], 'single');
    else if (e.code === 'KeyC') cont();
  };
  addEventListener('keydown', onKey);
  render();
  return { update() {}, dispose() { removeEventListener('keydown', onKey); wrap.remove(); } };
}
