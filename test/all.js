/**
 * Runs every suite:  sim balance  ->  DOM contract  ->  network protocol  ->  headless client.
 *   node test/all.js            (always starts its OWN server on a dedicated port)
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const alive = port => new Promise(res => {
  const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1200 }, r => { r.resume(); res(r.statusCode === 200); });
  req.on('error', () => res(false));
  req.on('timeout', () => { req.destroy(); res(false); });
});

/* This runner used to probe :3000 and REUSE whatever answered. That silently
   tested a stale server left over from an earlier session instead of the working
   tree -- it masked an outdated assertion in net.js for weeks. Always spawn our
   own server, on a port nothing else is using, and hand that port to the child
   suites so they can only ever talk to the code we just checked out. */
const BASE_PORT = parseInt(process.env.TEST_PORT || '31777', 10);

function run(label, file, args, port) {
  console.log('\n\u2550\u2550 ' + label + ' ' + '\u2550'.repeat(Math.max(0, 56 - label.length)));
  const env = Object.assign({}, process.env);
  if (port) env.PORT = String(port);
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...(args || [])], { stdio: 'inherit', env });
  return r.status === 0;
}

(async () => {
  const results = [];
  results.push(['sim balance matrix', run('SIM BALANCE', 'balance.js')]);

  // find a free port so a leftover dev server can never be mistaken for ours
  let PORT = BASE_PORT;
  for (let i = 0; i < 40 && (await alive(PORT)); i++) PORT++;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')],
    { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) });
  let up = false;
  for (let i = 0; i < 60 && !(up = await alive(PORT)); i++) await new Promise(r => setTimeout(r, 150));
  console.log('\n(server ' + (up ? 'ready' : 'UNREACHABLE') + ' on :' + PORT + ' — spawned fresh from this working tree)');

  results.push(['dom contract', run('DOM CONTRACT', 'domcheck.js')]);
  results.push(['network protocol', run('NETWORK PROTOCOL', 'net.js', null, PORT)]);
  results.push(['headless client (desktop)', run('HEADLESS CLIENT — DESKTOP', 'client.js', null, PORT)]);
  results.push(['mobile landscape + touch', run('MOBILE — LANDSCAPE + TOUCH', 'mobile.js', null, PORT)]);
  results.push(['loot + breakables + inventory', run('LOOT / BREAKABLES / INVENTORY', 'loot.js')]);
  results.push(['deploy readiness (render.com)', run('DEPLOY READINESS', 'deploy.js')]);

  if (srv) srv.kill();
  const bad = results.filter(r => !r[1]);
  console.log('\n\u2550\u2550 SUMMARY ' + '\u2550'.repeat(48));
  results.forEach(([n, ok]) => console.log('  ' + (ok ? '\u2713' : '\u2717') + ' ' + n));
  console.log(bad.length ? '\n  ' + bad.length + ' SUITE(S) FAILED\n' : '\n  ALL SUITES PASSED\n');
  process.exit(bad.length ? 1 : 0);
})();
