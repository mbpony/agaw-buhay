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

  // Fullscreen on a phone: iPhone Safari has no fullscreen API, so the real
  // chrome-free path is an installed PWA / home-screen launch. Verify the whole
  // plumbing for that exists and is wired up.
  ok(/rel="manifest"/.test(html), 'declares a web app manifest');
  ok(/rel="apple-touch-icon"/.test(html), 'declares an iOS home-screen icon');
  ok(/100dvh/.test(html), 'uses the dynamic viewport height so collapsing iOS bars never crop the game');
  ok(/#ioshint/.test(html), 'ships styles for the iPhone Add-to-Home-Screen hint');
  ok(/isStandalone\(\)/.test(main) && /canFullscreen\(\)/.test(main), 'client detects standalone mode and a missing fullscreen API');
  const mani = JSON.parse(read('client/manifest.webmanifest'));
  ok(mani.display === 'fullscreen', 'manifest asks for fullscreen display', mani.display);
  ok(mani.orientation === 'landscape', 'manifest locks landscape', mani.orientation);
  ok((mani.icons || []).length >= 2, 'manifest ships icons (' + (mani.icons || []).length + ')');
  for (const ic of mani.icons || []) ok(fs.existsSync(path.join(ROOT, 'client', ic.src)), 'icon file exists: ' + ic.src);
  ok(fs.existsSync(path.join(ROOT, 'client', 'apple-touch-icon.png')), 'apple-touch-icon file exists');

  const PORT = 3987;
  const child0 = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child0.stdout.on('data', d => bootLog += d);
  child0.stderr.on('data', d => bootLog += d);
  for (let i = 0; i < 40; i++) { if (await get(PORT, '/health')) break; await sleep(150); }

  console.log('\n== Subresources resolve like a browser ==');
  // Regression test for the bug that shipped the game unplayable: index.html was
  // served at "/" while its script tags are relative ("audio.js"), so the browser
  // requested "/audio.js" -> 404 -> main.js never ran -> stuck on the title screen.
  // jsdom injects modules by hand, so ONLY this check catches that class of bug.
  const raw = await new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 3000 }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
    });
    req.on('error', () => res(null)); req.on('timeout', () => { req.destroy(); res(null); });
  });
  ok(!!raw, 'GET / answered');
  if (raw) {
    const redirected = raw.status === 302 || raw.status === 301;
    const finalPath = redirected ? (raw.headers.location || '/client/index.html') : '/';
    ok(redirected, 'GET / redirects into /client/ so relative paths resolve', 'status=' + raw.status + ' loc=' + raw.headers.location);
    const page = redirected ? await get(PORT, finalPath) : raw;
    ok(page && page.status === 200 && /AGAW-BUHAY/i.test(page.body), 'final document serves the game HTML');
    const srcs = [...(page ? page.body : '').matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
    ok(srcs.length >= 6, 'found the 6 game modules in the document: ' + srcs.join(', '));
    for (const src of srcs) {
      // resolve exactly like a browser would, against the FINAL document URL
      const resolved = new URL(src, 'http://127.0.0.1:' + PORT + finalPath).pathname;
      const r = await get(PORT, resolved);
      ok(r && r.status === 200 && r.body.length > 500, src + ' -> ' + resolved + ' = 200',
        r ? 'http ' + r.status + ', ' + r.body.length + 'b' : 'no response');
    }
    const mj = await get(PORT, new URL('main.js', 'http://x' + finalPath).pathname);
    ok(mj && /ABAW_DEBUG/.test(mj.body), 'main.js really is the game shell (contains ABAW_DEBUG)');
    ok(/booterr/.test(page ? page.body : ''), 'boot-failure overlay is present so a 404 is never silent again');
  }

  console.log('\n== Boots on an injected port ==');
  const child = child0;
  const out = () => bootLog;
  const ready = !!(await get(PORT, '/health'));
  ok(ready, 'server listens on PORT=' + PORT, ready ? '' : out().slice(0, 200));
  if (ready) {
    const h = await get(PORT, '/health');
    ok(h.status === 200 && /"ok":true/.test(h.body), '/health returns 200 + JSON: ' + h.body);
    const red = await get(PORT, '/');
    ok(red.status === 302 && red.headers.location === '/client/index.html', 'GET / redirects to /client/index.html', red.status + ' -> ' + red.headers.location);
    const idx = await get(PORT, '/client/index.html');
    ok(idx.status === 200 && /AGAW-BUHAY/i.test(idx.body), 'the document it redirects to serves the game');
    ok(/no-cache/.test(JSON.stringify(idx.headers)), 'index.html sent with no-cache');
    const js = await get(PORT, '/client/main.js');
    ok(js.status === 200 && /text\/javascript/.test(js.headers['content-type'] || ''), 'JS served with a valid content-type');
    const sim = await get(PORT, '/core/sim.js');
    ok(sim.status === 200 && sim.body.length > 1000, 'core/sim.js served too (index.html loads ../core/*.js)');

    // ROOT is the repo top level, so a naive static handler here serves the whole
    // project. These files all really exist -- if any comes back 200 the
    // whitelist has regressed.
    console.log('\n== Repo internals are not public ==');
    for (const p of ['/package.json', '/package-lock.json', '/render.yaml', '/README.md',
                     '/server/index.js', '/test/loot.js', '/.git/config', '/.gitignore', '/.env']) {
      const r = await get(PORT, p);
      ok(r.status === 404 || r.status === 403, p + ' is not served', r.status);
    }
    for (const p of ['/client/../package.json', '/core/../server/index.js', '/client/.hidden.js']) {
      const r = await get(PORT, p);
      ok(r.status === 404 || r.status === 403, p + ' is refused', r.status);
    }
    const up = await get(PORT, '/uploads/AGAW_BUHAY_SURVIVAL_DOCUMENTATION.pdf');
    ok(up.status === 404 || up.status === 403, 'the design doc is not downloadable from the game server', up.status);

    console.log('\n== PWA assets are served ==');
    const mf = await get(PORT, '/client/manifest.webmanifest');
    ok(mf.status === 200 && /manifest\+json/.test((mf.headers || {})['content-type'] || ''), 'manifest served as application/manifest+json', mf.status + ' ' + ((mf.headers || {})['content-type'] || ''));
    const ic1 = await get(PORT, '/client/icon-192.png');
    ok(ic1.status === 200 && /image\/png/.test((ic1.headers || {})['content-type'] || ''), 'icon-192 served as image/png', ic1.status + ' ' + ((ic1.headers || {})['content-type'] || ''));
    const ic2 = await get(PORT, '/client/apple-touch-icon.png');
    ok(ic2.status === 200 && ic2.body.length > 200, 'apple-touch-icon served', ic2.status);
  }
  // graceful shutdown
  child.kill('SIGTERM');
  const exited = await new Promise(res => {
    const t = setTimeout(() => res(false), 5000);
    child.on('exit', code => { clearTimeout(t); res(code === 0); });
  });
  ok(exited, 'exits cleanly (code 0) on SIGTERM');
  ok(/SIGTERM/.test(out()), 'logs the shutdown');

  console.log('\n----------------------------------------');
  console.log('  PASS ' + pass + '   FAIL ' + fail);
  console.log('----------------------------------------\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
