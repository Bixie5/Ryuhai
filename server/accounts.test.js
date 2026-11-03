const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('./server');

function api(port, method, url, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: h }, (res) => {
      let buf = ''; res.on('data', (d) => buf += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-acc-'));
  const file = path.join(dir, 'accounts.json');
  const { server } = createServer({ shopDir: path.join(dir, 'shop'), accountsFile: file, adminKey: 'k' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, A = '/api/account/';

  let r = await api(port, 'POST', A + 'register', { username: 'ab', password: 'secret1' });
  assert.strictEqual(r.status, 400); assert.match(r.body.error, /Username/);
  r = await api(port, 'POST', A + 'register', { username: 'Ann_1', password: '123' });
  assert.strictEqual(r.status, 400); assert.match(r.body.error, /Password/);
  console.log('ok - username and password rules');

  r = await api(port, 'POST', A + 'register', { username: 'Ann_1', password: 'secret1', data: { bananas: 250, points: 30, record: { w: 3, l: 1, d: 0 }, owned: ['frost-dragon', '../evil'], equipped: { dragon: 'frost-dragon', bogus: 'x' } } });
  assert.strictEqual(r.status, 200); assert.ok(r.body.token && r.body.token.length >= 40);
  assert.strictEqual(r.body.data.bananas, 250); assert.deepStrictEqual(r.body.data.owned, ['frost-dragon']);
  assert.deepStrictEqual(r.body.data.equipped, { dragon: 'frost-dragon' });
  assert.ok(r.headers['access-control-allow-origin'] === '*', 'CORS for the file:// app');
  const t1 = r.body.token;
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('secret1') && !raw.includes(t1), 'no password or token in the file');
  console.log('ok - register saves sanitised data; nothing secret stored in clear');

  r = await api(port, 'POST', A + 'register', { username: 'ann_1', password: 'other-pass' });
  assert.strictEqual(r.status, 409);
  console.log('ok - usernames are unique, case-insensitive');

  r = await api(port, 'POST', A + 'login', { username: 'ANN_1', password: 'nope' });
  assert.strictEqual(r.status, 401);
  r = await api(port, 'POST', A + 'login', { username: 'ghost', password: 'secret1' });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.error, 'Wrong username or password.');
  r = await api(port, 'POST', A + 'login', { username: 'ANN_1', password: 'secret1' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.points, 30);
  const t2 = r.body.token; assert.notStrictEqual(t1, t2);
  console.log('ok - login works on a second device');

  r = await api(port, 'GET', A + 'data', null, 'garbage'); assert.strictEqual(r.status, 401);
  r = await api(port, 'GET', A + 'data'); assert.strictEqual(r.status, 401);
  r = await api(port, 'GET', A + 'data', null, t2); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.rev, 1);
  console.log('ok - data needs a valid token');

  r = await api(port, 'PUT', A + 'data', { rev: 1, data: { bananas: 400, points: 40, record: { w: 4, l: 1, d: 0 }, owned: ['frost-dragon'], equipped: {} } }, t1);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.rev, 2);
  r = await api(port, 'PUT', A + 'data', { rev: 1, data: { bananas: 999 } }, t2);
  assert.strictEqual(r.status, 409); assert.strictEqual(r.body.rev, 2); assert.strictEqual(r.body.data.bananas, 400);
  console.log('ok - stale save is rejected with the newer cloud data (409)');

  r = await api(port, 'PUT', A + 'data', { rev: 2, data: { bananas: 1e15, points: 'x', record: null, owned: 'no' } }, t2);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.data.bananas, 1e9); assert.strictEqual(r.body.data.points, 0);
  console.log('ok - junk values are clamped');

  r = await api(port, 'POST', A + 'logout', {}, t2); assert.strictEqual(r.status, 200);
  r = await api(port, 'GET', A + 'data', null, t2); assert.strictEqual(r.status, 401);
  r = await api(port, 'GET', A + 'data', null, t1); assert.strictEqual(r.status, 200);
  console.log('ok - logout ends only that device');

  const s2 = require('./accounts').createAccounts(file);
  assert.strictEqual(s2.count(), 1);
  r = await api(port, 'GET', A + 'data', null, t1); assert.strictEqual(r.body.username, 'Ann_1');
  console.log('ok - data survives a restart (file)');

  for (let i = 0; i < 5; i++) await api(port, 'POST', A + 'login', { username: 'Ann_1', password: 'bad' + i });
  r = await api(port, 'POST', A + 'login', { username: 'Ann_1', password: 'secret1' });
  assert.strictEqual(r.status, 429);
  console.log('ok - repeated wrong passwords are locked out for a minute');

  r = await api(port, 'POST', A + 'delete', { password: 'wrong' }, t1); assert.strictEqual(r.status, 401);
  r = await api(port, 'POST', A + 'delete', { password: 'secret1' }, t1); assert.strictEqual(r.status, 200);
  r = await api(port, 'GET', A + 'data', null, t1); assert.strictEqual(r.status, 401);
  console.log('ok - account can be deleted with the password');

  server.close();
  console.log('\naccount tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
