// Render a deterministic shot of our game to PNG with headless Chromium.
// usage: node tools/shoot.mjs <scene> <shot> <out.png> [width height]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [scene, shot, out, w = '1280', h = '960'] = process.argv.slice(2);
if (!scene || !shot || !out) { console.error('usage: shoot.mjs <scene> <shot> <out.png> [w h]'); process.exit(2); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?scene=${scene}&shot=${shot}`);
try {
  await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 240000 });
} catch (e) { console.error('shot never became ready\n' + logs.join('\n')); await browser.close(); server.close(); process.exit(1); }
const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
if (logs.length) console.log(logs.join('\n'));
console.log('wrote', out);
await browser.close(); server.close();
