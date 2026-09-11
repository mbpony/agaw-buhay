/**
 * Runs every suite:  sim balance  ->  DOM contract  ->  network protocol  ->  headless client.
 *   node test/all.js            (starts its own server if one is not already running)
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3000;
const alive = () => new Promise(res => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1200 }, r => { r.resume(); res(r.statusCode === 200); });
  req.on('error', () => res(false));
  req.on('timeout', () => { req.destroy(); res(false); });
});

function run(label, file, args) {
  console.log('\n\u2550\u2550 ' + label + ' ' + '\u2550'.repeat(Math.max(0, 56 - label.length)));
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...(args || [])], { stdio: 'inherit' });
  return r.status === 0;
}

(async () => {
  const results = [];
  results.push(['sim balance matrix', run('SIM BALANCE', 'balance.js')]);

  let up = await alive(), srv = null;
  if (!up) {
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { stdio: 'ignore', env: Object.assign({}, process.env, { PORT }) });
    for (let i = 0; i < 40 && !(await alive()); i++) await new Promise(r => setTimeout(r, 150));
    up = await alive();
  }
  console.log('\n(server ' + (up ? 'ready' : 'UNREACHABLE') + ' on :' + PORT + (srv ? ' — started by test runner' : ' — already running') + ')');

  results.push(['dom contract', run('DOM CONTRACT', 'domcheck.js')]);
  results.push(['network protocol', run('NETWORK PROTOCOL', 'net.js')]);
  results.push(['headless client (desktop)', run('HEADLESS CLIENT — DESKTOP', 'client.js')]);
  results.push(['mobile landscape + touch', run('MOBILE — LANDSCAPE + TOUCH', 'mobile.js')]);
  results.push(['deploy readiness (render.com)', run('DEPLOY READINESS', 'deploy.js')]);

  if (srv) srv.kill();
  const bad = results.filter(r => !r[1]);
  console.log('\n\u2550\u2550 SUMMARY ' + '\u2550'.repeat(48));
  results.forEach(([n, ok]) => console.log('  ' + (ok ? '\u2713' : '\u2717') + ' ' + n));
  console.log(bad.length ? '\n  ' + bad.length + ' SUITE(S) FAILED\n' : '\n  ALL SUITES PASSED\n');
  process.exit(bad.length ? 1 : 0);
})();
