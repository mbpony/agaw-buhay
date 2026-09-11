/**
 * Deployment-readiness checks for hosting on render.com (or any Node PaaS).
 * Verifies the blueprint, the runtime contract, and that the client can be
 * served from an arbitrary HTTPS origin without hard-coded hosts.
 *   node test/deploy.js
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (port, p) => new Promise(res => {
  const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 2000 }, r => {
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
  });
  req.on('error', () => res(null));
  req.on('timeout', () => { req.destroy(); res(null); });
});

(async () => {
  console.log('\n== Render blueprint ==');
  ok(fs.existsSync(path.join(ROOT, 'render.yaml')), 'render.yaml present');
  const y = fs.existsSync(path.join(ROOT, 'render.yaml')) ? read('render.yaml') : '';
  ok(/type:\s*web/.test(y), 'declares a web service');
  ok(/runtime:\s*node/.test(y), 'node runtime');
  ok(/healthCheckPath:\s*\/health/.test(y), 'health check points at /health');
  ok(/numInstances:\s*1/.test(y), 'pinned to one instance (WebSockets need sticky routing)');
  ok(/buildCommand:.*npm install/.test(y), 'build command installs dependencies');
  ok(/startCommand:\s*npm start/.test(y), 'start command runs npm start');
  ok(/--omit=dev|--production/.test(y), 'dev dependencies excluded from the deployed image');
  ok(fs.existsSync(path.join(ROOT, '.gitignore')) && /node_modules/.test(read('.gitignore')), '.gitignore excludes node_modules');

  console.log('\n== Package contract ==');
  const pkg = JSON.parse(read('package.json'));
  ok(pkg.scripts && pkg.scripts.start === 'node server/index.js', 'npm start launches the server', pkg.scripts && pkg.scripts.start);
  ok(pkg.dependencies && pkg.dependencies.ws, 'ws is a production dependency');
  ok(!pkg.dependencies || !pkg.dependencies.jsdom, 'jsdom stays a dev dependency');
  ok(pkg.engines && pkg.engines.node, 'engines.node declared: ' + (pkg.engines || {}).node);
  ok(pkg.main === 'server/index.js', 'package main points at the server');

  console.log('\n== Server runtime contract ==');
  const srv = read('server/index.js');
  ok(/process\.env\.PORT/.test(srv), 'honours the injected PORT');
  ok(/'0\.0\.0\.0'/.test(srv), 'binds 0.0.0.0 (required behind a PaaS proxy)');
  ok(/SIGTERM/.test(srv), 'handles SIGTERM (Render sends it on every deploy)');
  ok(/uncaughtException/.test(srv), 'survives an uncaught exception in a handler');
  ok(/path:\s*'\/ws'/.test(srv), 'WebSocket upgrade path is /ws');
  ok(/no-cache/.test(srv), 'static assets are not cached (deploys must not serve stale JS)');
  ok(!/require\(['"](?:canvas|phaser|pixi)/.test(srv), 'no native or heavy runtime deps');

  console.log('\n== Client portability ==');
  const main = read('client/main.js');
  ok(!/localhost|127\.0\.0\.1/.test(main), 'no hard-coded host in the client');
  ok(/location\.host/.test(main), 'derives the socket host from the page origin');
  ok(/location\.protocol === 'https:' \? 'wss:'/.test(main), 'upgrades to wss:// on an HTTPS origin (Render gives you one)');
  const html = read('client/index.html');
  ok(/viewport-fit=cover/.test(html), 'viewport covers the notch');
  ok(/user-scalable=no/.test(html) && /maximum-scale=1/.test(html), 'pinch-zoom disabled during play');
  ok(/apple-mobile-web-app-capable/.test(html), 'add-to-home-screen capable (iOS)');
  ok(/mobile-web-app-capable/.test(html), 'add-to-home-screen capable (Android)');
  ok(/theme-color/.test(html), 'theme colour declared');
  ok(/env\(safe-area-inset/.test(html), 'HUD and pads respect safe-area insets');
  ok(!/https?:\/\/(?!127|localhost)[\w.-]+\//.test(html.replace(/www\.w3\.org[^"']*/g, '')), 'index.html loads no third-party origin (works offline)');

  console.log('\n== Boots on an injected port ==');
  const PORT = 3987;
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => out += d);
  let ready = false;
  for (let i = 0; i < 40; i++) { if (await get(PORT, '/health')) { ready = true; break; } await sleep(150); }
  ok(ready, 'server listens on PORT=' + PORT, ready ? '' : out.slice(0, 200));
  if (ready) {
    const h = await get(PORT, '/health');
    ok(h.status === 200 && /"ok":true/.test(h.body), '/health returns 200 + JSON: ' + h.body);
    const idx = await get(PORT, '/');
    ok(idx.status === 200 && /AGAW-BUHAY/i.test(idx.body), 'GET / serves the game');
    ok(/no-cache/.test(JSON.stringify(idx.headers)), 'index.html sent with no-cache');
    const js = await get(PORT, '/client/main.js');
    ok(js.status === 200 && /text\/javascript/.test(js.headers['content-type'] || ''), 'JS served with a valid content-type');
  }
  // graceful shutdown
  child.kill('SIGTERM');
  const exited = await new Promise(res => {
    const t = setTimeout(() => res(false), 5000);
    child.on('exit', code => { clearTimeout(t); res(code === 0); });
  });
  ok(exited, 'exits cleanly (code 0) on SIGTERM');
  ok(/SIGTERM/.test(out), 'logs the shutdown');

  console.log('\n----------------------------------------');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('----------------------------------------\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
