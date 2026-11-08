// The server must start (not crash) when DATA_DIR cannot be written, as on a host with no disk mounted.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const port = 3700 + Math.floor(Math.random() * 200);
const child = spawn('node', [path.join(__dirname, 'server.js')], {
  env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: '/dev/null/ryuhai-data', ADMIN_KEY: 'k', ACCOUNTS_FILE: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let err = '', exited = null;
child.stderr.on('data', (d) => { err += d; });
child.on('exit', (c) => { exited = c; });

function get(p) { return new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej)); }

(async () => {
  let ok = null;
  for (let i = 0; i < 40 && ok === null; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (exited !== null) break;
    try { ok = await get('/healthz'); } catch (e) { /* not up yet */ }
  }
  assert.strictEqual(exited, null, 'server crashed on an unwritable DATA_DIR (exit ' + exited + '): ' + err);
  assert.strictEqual(ok && ok.status, 200);
  assert.match(err, /cannot write to DATA_DIR/, 'it tells the owner what is wrong');
  const shop = await get('/shop/catalog.json'); assert.strictEqual(shop.status, 200);
  console.log('ok - server starts and warns when DATA_DIR is not writable');
  child.kill();
  console.log('\nstartup tests passed');
})().catch((e) => { child.kill(); console.error('FAIL', e.message); process.exit(1); });
