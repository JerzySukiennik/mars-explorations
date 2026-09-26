// Gameplay layer. main.js calls attach() for every scene opened WITHOUT ?shot.
// Scenes stay purely visual; this wraps them with input, HUD, simulation
// stepping, time warp and camera control. It never requires anything from a
// scene: exposed objects/hooks (ctx.stack, ctx.ship, ctx.rover, ctx.heightAt,
// ctx.setFlightState, ...) are used when present, see README "Scene hooks".

import * as Campaign from './campaign.js';
import { SCORERS } from './scoring.js';
import { loadPhysics } from './deps.js';
import { createInput } from './input.js';
import { el, esc, helpBox } from './ui.js';

const PHASE_MODULES = {
  launch: () => import('./phases/launch.js'),
  refill: () => import('./phases/refill.js'),
  transfer: () => import('./phases/transfer.js'),
  entry: () => import('./phases/entry.js'),
  landing: () => import('./phases/landing.js'),
  surface: () => import('./phases/surface.js'),
};

function storage() { try { return window.localStorage; } catch { return null; } }

export function goto(scene, mode) {
  const q = new URLSearchParams();
  q.set('scene', scene);
  if (mode) q.set('mode', mode);
  location.search = q.toString();
}

export async function attach({ ctx, renderer, THREE, sceneId, params }) {
  const root = el('div', 'g-root');
  root.id = 'game';
  document.body.classList.add('play');
  document.body.appendChild(root);

  if (sceneId === 'menu' || !sceneId) {
    const { createMenu } = await import('./menu.js');
    const menu = createMenu({ root, goto, storage: storage(), ctx });
    window.__game = { phase: 'menu', ready: true };
    return {
      update(dt) { ctx.update?.(dt); menu.update?.(dt); },
    };
  }

  const input = createInput(window);
  const deps = await loadPhysics();
  const phaseId = Campaign.isPhase(sceneId) ? sceneId : null;
  const mode = params.get('mode') === 'campaign' ? 'campaign' : 'single';
  const auto = params.get('auto') === '1';
  let campaign = Campaign.load(storage());

  // ---- chrome: top bar, help, overlays
  const top = el('div', 'g-top');
  const title = el('div', 'g-title');
  const status = el('div', 'g-status');
  const warpEl = el('div', 'g-warp');
  const btnMenu = el('button', 'g-btn g-small', 'PAUSE');
  btnMenu.type = 'button';
  const btnHelp = el('button', 'g-btn g-small', 'KEYS');
  btnHelp.type = 'button';
  const warpDown = el('button', 'g-btn g-small', '&lt;&lt;'); warpDown.type = 'button'; warpDown.title = 'Time warp down ( , )';
  const warpUp = el('button', 'g-btn g-small', '&gt;&gt;'); warpUp.type = 'button'; warpUp.title = 'Time warp up ( . )';
  const warpBox = el('div', 'g-warpbox'); warpBox.append(warpDown, warpEl, warpUp);
  top.append(title, status, warpBox, btnHelp, btnMenu);
  root.append(top);
  const layer = el('div', 'g-layer');           // phase HUD goes here
  root.append(layer);
  const overlay = el('div', 'g-overlay hidden');
  root.append(overlay);
  const toast = el('div', 'g-toast');
  root.append(toast);

  let paused = false, ended = false, helpOpen = false;
  let warpIdx = 0, warpLevels = [1];
  let controller = null;

  const showToast = (msg, ms = 2600) => {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(showToast._t); showToast._t = setTimeout(() => toast.classList.remove('show'), ms);
  };

  const info = phaseId ? Campaign.PHASE_INFO[phaseId] : { title: sceneId.toUpperCase() };
  title.innerHTML = `<b>${esc(info.title.toUpperCase())}</b><span>${mode === 'campaign' ? 'CAMPAIGN' : 'SINGLE PHASE'}</span>`;

  const setWarpLevels = (levels, labels) => {
    warpLevels = levels; warpLevels.labels = labels;
    warpIdx = Math.min(warpIdx, levels.length - 1);
    renderWarp();
  };
  const renderWarp = () => {
    const lab = warpLevels.labels?.[warpIdx] ?? `${warpLevels[warpIdx]}x`;
    warpEl.textContent = paused ? 'PAUSED' : `WARP ${lab}`;
    warpEl.classList.toggle('active', warpIdx > 0 || paused);
  };
  const setWarp = (i) => { warpIdx = Math.max(0, Math.min(warpLevels.length - 1, i)); renderWarp(); };
  warpDown.addEventListener('click', () => setWarp(warpIdx - 1));
  warpUp.addEventListener('click', () => setWarp(warpIdx + 1));

  const openOverlay = (html, buttons) => {
    overlay.innerHTML = '';
    const box = el('div', 'g-dialog', html);
    const row = el('div', 'g-dlgbtns');
    buttons.forEach(([label, fn, cls], i) => {
      const b = el('button', `g-btn ${cls || ''}`, esc(label)); b.type = 'button';
      b.addEventListener('click', fn);
      if (i === 0) setTimeout(() => b.focus(), 30);
      row.append(b);
    });
    box.append(row);
    overlay.append(box);
    overlay.classList.remove('hidden');
  };
  const closeOverlay = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };

  const restart = () => location.reload();
  const toMenu = () => goto('menu');

  const pause = (on) => {
    if (ended) return;
    paused = on; renderWarp();
    if (on) openOverlay('<h2>PAUSED</h2><p class="g-note">Simulation halted. The scene keeps rendering.</p>', [
      ['RESUME', () => pause(false), 'primary'], ['RESTART PHASE', restart], ['MISSION MENU', toMenu],
    ]);
    else closeOverlay();
  };
  btnMenu.addEventListener('click', () => pause(!paused));

  let helpEl = null;
  const toggleHelp = () => {
    helpOpen = !helpOpen;
    if (helpEl) helpEl.classList.toggle('hidden', !helpOpen);
  };
  btnHelp.addEventListener('click', toggleHelp);

  // ---- phase completion
  const finish = (result, carryNext, extra = {}) => {
    if (ended) return;
    ended = true;
    const scorer = SCORERS[phaseId];
    const sc = scorer ? scorer(result, extra.scoreArg) : { score: 0, grade: '-', parts: [] };
    campaign = Campaign.completePhase(campaign, phaseId, { score: sc.score, carryNext, summary: extra.summary ?? null }, mode);
    Campaign.save(storage(), campaign);
    const nxt = Campaign.nextPhase(phaseId);
    const rows = sc.parts.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${v}</td></tr>`).join('');
    const html = `<h2>${esc(extra.headline || 'PHASE COMPLETE')}</h2>
      ${extra.summaryHtml ? `<div class="g-summary">${extra.summaryHtml}</div>` : ''}
      <table class="g-score">${rows}<tr class="tot"><td>SCORE</td><td class="num">${sc.score} <span class="grade">${sc.grade}</span></td></tr></table>`;
    const buttons = [];
    if (nxt) buttons.push([mode === 'campaign' ? `CONTINUE: ${Campaign.PHASE_INFO[nxt].title.toUpperCase()}` : `NEXT PHASE: ${Campaign.PHASE_INFO[nxt].title.toUpperCase()}`, () => goto(nxt, mode === 'campaign' ? 'campaign' : 'single'), 'primary']);
    else buttons.push(['MISSION COMPLETE: MENU', toMenu, 'primary']);
    buttons.push(['REPLAY', restart], ['MENU', toMenu]);
    window.__game.result = { ok: true, score: sc.score, result };
    setTimeout(() => openOverlay(html, buttons), extra.delayMs ?? 1200);
  };
  const fail = (reason, result) => {
    if (ended) return;
    ended = true;
    campaign = Campaign.failPhase(campaign, phaseId, reason);
    Campaign.save(storage(), campaign);
    window.__game.result = { ok: false, reason, result };
    setTimeout(() => openOverlay(`<h2 class="bad">MISSION FAILURE</h2><p>${esc(reason)}</p>`, [['RETRY', restart, 'primary'], ['MENU', toMenu]]), 1400);
  };

  // ---- phase controller
  window.__game = { phase: phaseId || sceneId, mode, ready: false, deps: { available: deps.available, missing: deps.missing } };
  if (phaseId) {
    campaign = Campaign.startPhase(campaign, phaseId);
    Campaign.save(storage(), campaign);
    const mod = await PHASE_MODULES[phaseId]();
    controller = await mod.create({
      ctx, THREE, renderer, deps, input, layer, root, mode, auto, params,
      inputs: Campaign.inputsFor(campaign, phaseId, mode),
      setWarpLevels, getWarp: () => warpLevels[warpIdx], setWarp, setStatus: (h) => { if (status._h !== h) { status.innerHTML = h; status._h = h; } },
      toast: showToast, finish, fail, isEnded: () => ended,
    });
  } else {
    // Non-mission scenes (orbit, onboard): passive viewer with the menu bar.
    controller = { help: [['Esc', 'Pause / menu']], update() {} };
    status.innerHTML = '<span class="g-note">Viewer scene: no mission phase attached</span>';
  }
  const helpItems = [...(controller.help || []), [', .', 'Time warp down / up'], ['Esc P', 'Pause'], ['H', 'Show / hide this key list']];
  helpEl = helpBox('CONTROLS', helpItems);
  helpEl.classList.add('hidden');
  root.append(helpEl);
  if (!phaseId) setWarpLevels([1], ['1x']);
  window.__game.ready = true;
  window.__game.state = () => controller.debug?.();

  return {
    update(dt) {
      if (input.wasPressed('Escape', 'KeyP')) { if (!ended) pause(!paused); }
      if (input.wasPressed('KeyH')) toggleHelp();
      if (!paused && !ended) {
        if (input.wasPressed('Period', 'BracketRight')) setWarp(warpIdx + 1);
        if (input.wasPressed('Comma', 'BracketLeft')) setWarp(warpIdx - 1);
      }
      // The scene updates first so gameplay placement (rover, camera, ...) wins.
      // A controller may re-time the scene (sceneDt) to keep its animation in
      // step with the mission clock.
      const w = paused ? 0 : warpLevels[warpIdx] ?? 1;
      const sdt = controller.sceneDt ? controller.sceneDt(dt, w, paused) : dt;
      if (sdt > 0 || !controller.sceneDt) ctx.update?.(sdt);
      if (!paused) {
        try { controller.update(dt, w, { ended }); }
        catch (e) { console.error('[game] phase update failed', e); paused = true; openOverlay(`<h2 class="bad">SIMULATION ERROR</h2><p>${esc(e.message)}</p>`, [['RESTART', restart, 'primary'], ['MENU', toMenu]]); }
      }
      input.endFrame();
    },
  };
}
