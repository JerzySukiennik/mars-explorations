// Play-mode smoke test: opens every scene WITHOUT ?shot (gameplay layer
// attached), simulates a few seconds of keyboard input, screenshots the page
// (canvas + DOM HUD) to work/smoke/<scene>.png and fails on page errors or
// console errors.
//
// usage: node tools/smoke.mjs [scene ...] [--auto] [--seconds N]
//   --size WxH viewport (default 960x600); --frames N frames to run after the input (12)
//   --auto     also run each mission phase with ?auto=1 (autopilots on) and
//              report how far it got (work/smoke/<scene>-auto.png); --auto-seconds N (12)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ALL = ['menu', 'launch', 'refill', 'transfer', 'entry', 'landing', 'surface', 'orbit', 'onboard'];
const PHASES = ['launch', 'refill', 'transfer', 'entry', 'landing', 'surface'];
const VALUE_OPTS = ['--seconds', '--size', '--frames', '--auto-seconds'];
const scenes = argv.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(argv[i - 1]));
const list = scenes.length ? scenes : ALL;
const seconds = Number(opt('--seconds', 4));
const [W, H] = opt('--size', '960x600').split('x').map(Number);
const MIN_FRAMES = Number(opt('--frames', 12));   // heavy scenes under SwiftShader: wait for real frames, not wall time

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'work', 'smoke');
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// Optional physics modules the game probes for; their 404s are expected until
// the physics builders add them.
const OPTIONAL = /\/src\/physics\/(refill|entry|ascent)\.js/;

// Key scripts per scene: [atSeconds, action, key, holdMs]
const SCRIPTS = {
  menu: [[0.5, 'press', 'ArrowDown'], [1, 'press', 'ArrowDown']],
  launch: [[0.3, 'press', 'Enter'], [1, 'hold', 'KeyW', 400], [1.6, 'hold', 'KeyD', 300], [2.2, 'press', 'Period'], [2.6, 'press', 'KeyH']],
  refill: [[0.3, 'press', 'KeyN'], [0.8, 'hold', 'KeyW', 800], [1.8, 'hold', 'KeyA', 300], [2.4, 'press', 'KeyU']],
  transfer: [[0.3, 'hold', 'KeyD', 500], [1.0, 'hold', 'KeyW', 400], [1.8, 'press', 'Enter'], [2.4, 'hold', 'KeyS', 300]],
  entry: [[0.3, 'hold', 'KeyS', 400], [1.0, 'press', 'Enter'], [1.6, 'hold', 'KeyD', 500], [2.4, 'press', 'Period']],
  landing: [[0.3, 'hold', 'KeyA', 300], [1.0, 'press', 'KeyF'], [1.6, 'hold', 'KeyW', 400], [2.2, 'press', 'Digit2']],
  surface: [[0.3, 'hold', 'KeyW', 700], [1.2, 'hold', 'KeyA', 400], [1.8, 'press', 'KeyC'], [2.3, 'press', 'KeyB'], [2.8, 'press', 'Digit2'], [3.2, 'press', 'KeyC']],
  orbit: [[0.5, 'press', 'KeyH']],
  onboard: [[0.5, 'press', 'KeyH']],
};

async function run(scene, { auto = false, secs = seconds } = {}) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.addInitScript(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const errors = [], notes = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && OPTIONAL.test(loc)) { notes.push(`optional module absent: ${loc.replace(/^.*\/src/, 'src')}`); return; }
    errors.push(`[console.error] ${m.text()} ${loc}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => { if (!OPTIONAL.test(r.url())) errors.push(`[requestfailed] ${r.url()}`); });
  const url = `http://127.0.0.1:${port}/index.html?scene=${scene}${auto ? '&auto=1' : ''}`;
  const t0 = Date.now();
  await page.goto(url);
  try { await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 250 }); }
  catch { errors.push('[timeout] gameplay layer never became ready'); }
  const loadMs = Date.now() - t0;
  if (!auto) {
    const script = SCRIPTS[scene] || [];
    const start = Date.now();
    for (const [at, action, key, hold] of script) {
      const wait = at * 1000 - (Date.now() - start);
      if (wait > 0) await page.waitForTimeout(wait);
      if (action === 'press') await page.keyboard.press(key);
      else { await page.keyboard.down(key); await page.waitForTimeout(hold); await page.keyboard.up(key); }
    }
    const rest = secs * 1000 - (Date.now() - start);
    if (rest > 0) await page.waitForTimeout(rest);
  } else {
    await page.waitForTimeout(secs * 1000);
  }
  // make sure the game loop actually ran a number of frames after the input
  const f0 = await page.evaluate(() => window.__frames);
  try { await page.waitForFunction((n) => window.__frames >= n, f0 + MIN_FRAMES, { timeout: 180000, polling: 500 }); }
  catch { notes.push(`only ${(await page.evaluate(() => window.__frames)) - f0} frames in 180 s`); }
  const state = await page.evaluate(() => { try { return { phase: window.__game?.phase, state: window.__game?.state?.(), result: window.__game?.result, deps: window.__game?.deps } ; } catch (e) { return { err: e.message }; } });
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  const file = path.join(outDir, `${scene}${auto ? '-auto' : ''}.png`);
  try { await page.screenshot({ path: file, timeout: 240000, animations: 'disabled', caret: 'hide' }); } catch (e) { errors.push(`[screenshot] ${e.message.split('\n')[0]}`); }
  await page.close();
  return { scene, auto, errors, notes: [...new Set(notes)], state, file: path.relative(root, file), loadMs, fps };
}

let failed = 0;
const report = [];
for (const scene of list) {
  const r = await run(scene);
  report.push(r);
  if (flag('--auto') && PHASES.includes(scene)) report.push(await run(scene, { auto: true, secs: Number(opt('--auto-seconds', 12)) }));
}
for (const r of report) {
  const ok = r.errors.length === 0;
  if (!ok) failed++;
  const st = r.state?.state ? JSON.stringify(r.state.state).slice(0, 220) : '';
  const res = r.state?.result ? ` result=${JSON.stringify({ ok: r.state.result.ok, score: r.state.result.score, reason: r.state.result.reason })}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.scene}${r.auto ? ' (auto)' : ''}  load ${r.loadMs} ms  ~${r.fps} fps (swiftshader)  -> ${r.file}`);
  if (st) console.log(`      state ${st}${res}`);
  for (const n of r.notes) console.log(`      note: ${n}`);
  for (const e of r.errors) console.log(`      ${e}`);
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} run(s) failed` : '\nall runs passed');
process.exit(failed ? 1 : 0);
