const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createRemote } = require('./remote');
const { createServer } = require('./server');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// A tiny fake of the parts of the GitHub Contents API we use.
function fakeGitHub(opts) {
  const files = new Map();   // path -> {buf, sha}
  const calls = [];
  let n = 0, fail = null;
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      const u = new URL(req.url, 'http://x');
      const out = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      calls.push(req.method + ' ' + u.pathname + (body && body.content ? ' [upload]' : ''));
      if (req.headers.authorization !== 'Bearer tok') return out(401, { message: 'Bad credentials' });
      if (fail) return out(fail, { message: 'forced' });
      const m = u.pathname.match(/^\/repos\/own\/repo\/(branches|contents)\/(.*)$/);
      if (!m) return out(404, { message: 'Not Found' });
      if (m[1] === 'branches') return out(m[2] === 'main' ? 200 : 404, { message: 'Not Found' });
      const p = decodeURIComponent(m[2]);
      if (req.method === 'GET') {
        if (files.has(p)) { const f = files.get(p); if ((req.headers.accept || '').includes('raw')) { res.writeHead(200); return res.end(f.buf); } return out(200, { type: 'file', sha: f.sha, encoding: 'base64', content: f.buf.toString('base64') }); }
        const kids = [...files.keys()].filter((k) => k.startsWith(p + '/'));
        if (!kids.length) return out(404, { message: 'Not Found' });
        return out(200, kids.map((k) => ({ type: 'file', name: k.slice(p.length + 1), sha: files.get(k).sha })));
      }
      if (req.method === 'PUT') {
        const ex = files.get(p);
        if (ex && body.sha !== ex.sha) return out(409, { message: 'sha mismatch' });
        files.set(p, { buf: Buffer.from(body.content, 'base64'), sha: 's' + (++n) });
        return out(200, { content: {} });
      }
      if (req.method === 'DELETE') { files.delete(p); return out(200, {}); }
      out(405, {});
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, files, calls, port: srv.address().port, fail: (s) => { fail = s; } })));
}

function adminApi(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { 'Content-Type': 'application/json', 'x-admin-key': 'k' } }, (res) => {
      let buf = ''; res.on('data', (d) => buf += d); res.on('end', () => resolve({ status: res.statusCode, text: buf, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out'); };

(async () => {
  const gh = await fakeGitHub();
  const mkRemote = (extra) => createRemote(Object.assign({ repo: 'own/repo', token: 'tok', dir: 'skins', api: 'http://127.0.0.1:' + gh.port }, extra));

  assert.ok(!createRemote({}).enabled, 'off without settings');
  assert.ok(!createRemote({ repo: 'own/repo' }).enabled, 'off without token');
  assert.strictEqual(mkRemote().rawBase, 'https://raw.githubusercontent.com/own/repo/main/skins/');
  console.log('ok - stays off until repo and token are set; raw URL is right');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-rem-'));
  const remote = mkRemote();
  const { server } = createServer({ shopDir: dir, accountsFile: path.join(dir, 'a.json'), adminKey: 'k', remote });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const synced = () => remote.status().state === 'ok' || remote.status().state === 'error';

  let r = await adminApi(port, 'POST', '/api/admin/items', { piece: 'knight', name: 'Frost Knight', price: 300, image: PNG.toString('base64') });
  assert.strictEqual(r.status, 200);
  const img = r.body.item.image;
  await until(async () => remote.status().state === 'ok' && gh.files.has('skins/catalog.json'));
  assert.ok(gh.files.has('skins/' + img), 'image uploaded');
  assert.deepStrictEqual(gh.files.get('skins/' + img).buf, PNG, 'image bytes identical');
  const cat = JSON.parse(gh.files.get('skins/catalog.json').buf.toString());
  assert.strictEqual(cat.items.length, 1); assert.strictEqual(cat.items[0].name, 'Frost Knight'); assert.strictEqual(cat.items[0].price, 300);
  console.log('ok - adding a skin uploads the image and the catalog to the remote');

  assert.ok(!r.text.includes('tok'), 'token never in responses');
  const st = await adminApi(port, 'GET', '/api/admin/remote');
  assert.ok(st.body.remote.enabled && st.body.remote.state === 'ok' && !st.text.includes('"tok"'));
  console.log('ok - status endpoint works and hides the token');

  gh.calls.length = 0;
  await adminApi(port, 'POST', '/api/admin/remote/sync');
  await until(async () => remote.status().state === 'ok' && gh.calls.length >= 2);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!gh.calls.some((c) => c.includes('[upload]')), 'nothing re-uploaded when already in sync: ' + gh.calls.join(' | '));
  console.log('ok - syncing again changes nothing');

  await adminApi(port, 'PUT', '/api/admin/items/frost-knight', { price: 450 });
  await until(async () => JSON.parse(gh.files.get('skins/catalog.json').buf.toString()).items[0].price === 450);
  console.log('ok - price change reaches the remote');

  await adminApi(port, 'DELETE', '/api/admin/items/frost-knight');
  await until(async () => !gh.files.has('skins/' + img));
  assert.strictEqual(JSON.parse(gh.files.get('skins/catalog.json').buf.toString()).items.length, 0);
  console.log('ok - deleting a skin removes its image and catalog entry remotely');

  // remote down: local save still works and the error is reported plainly
  gh.fail(500);
  r = await adminApi(port, 'POST', '/api/admin/items', { piece: 'wizard', name: 'Sage', price: 10, image: PNG.toString('base64') });
  assert.strictEqual(r.status, 200, 'local save still works when the remote fails');
  await until(async () => remote.status().state === 'error');
  assert.match(remote.status().error, /GitHub error 500/);
  assert.strictEqual((await adminApi(port, 'GET', '/api/admin/items')).body.items.length, 1);
  gh.fail(null);
  await adminApi(port, 'POST', '/api/admin/remote/sync');
  await until(async () => remote.status().state === 'ok');
  assert.strictEqual(JSON.parse(gh.files.get('skins/catalog.json').buf.toString()).items.length, 1);
  console.log('ok - remote failure never loses the local save; Sync now recovers');

  // wrong token message
  const bad = createRemote({ repo: 'own/repo', token: 'nope', api: 'http://127.0.0.1:' + gh.port });
  bad.attach(() => [], () => null); await bad.request();
  assert.match(bad.status().error, /rejected the token/);
  console.log('ok - bad token gives a clear message');
  server.close();

  // restore: a brand-new computer with an empty shop pulls the remote copy
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-rem2-'));
  const remote2 = mkRemote();
  const s2 = createServer({ shopDir: dir2, accountsFile: path.join(dir2, 'a.json'), adminKey: 'k', remote: remote2 });
  await new Promise((r) => s2.server.listen(0, '127.0.0.1', r));
  const p2 = s2.server.address().port;
  await until(async () => (await adminApi(p2, 'GET', '/api/admin/items')).body.items.length === 1);
  const it = (await adminApi(p2, 'GET', '/api/admin/items')).body.items[0];
  assert.strictEqual(it.name, 'Sage'); assert.deepStrictEqual(fs.readFileSync(path.join(dir2, it.image)), PNG);
  console.log('ok - an empty shop is restored from the remote copy');
  s2.server.close();

  // safety: partial restore must not wipe the remote
  gh.files.set('skins/art/ghost.png', { buf: PNG, sha: 'g1' });
  const cat2 = JSON.parse(gh.files.get('skins/catalog.json').buf.toString());
  cat2.items.push({ id: 'ghost', name: 'Ghost', piece: 'fool', price: 1, image: 'art/missing.png', faceCenter: [50, 22] });
  gh.files.set('skins/catalog.json', { buf: Buffer.from(JSON.stringify(cat2)), sha: 'c9' });
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-rem3-'));
  const s3 = createServer({ shopDir: dir3, accountsFile: path.join(dir3, 'a.json'), adminKey: 'k', remote: mkRemote() });
  await new Promise((r) => s3.server.listen(0, '127.0.0.1', r));
  await new Promise((r) => setTimeout(r, 600));
  assert.strictEqual(JSON.parse(gh.files.get('skins/catalog.json').buf.toString()).items.length, 2, 'remote catalog untouched after partial restore');
  console.log('ok - a partial restore never overwrites the remote copy');
  s3.server.close();

  gh.srv.close();
  console.log('\nremote tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
