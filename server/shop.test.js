const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createServer } = require('./server');

// 1x1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function api(port, method, url, body, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { 'x-admin-key': key } : {}) }, (res) => {
      let buf = ''; res.on('data', (d) => buf += d); res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-shop-'));
  const { server } = createServer({ shopDir: dir, adminKey: 'secret-key' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, K = 'secret-key';

  assert.ok(fs.existsSync(path.join(dir, 'catalog.json')) && fs.existsSync(path.join(dir, 'catalog.js')), 'empty catalog files created');
  console.log('ok - empty catalog created on first run');

  assert.strictEqual((await api(port, 'GET', '/api/admin/items')).status, 401);
  assert.strictEqual((await api(port, 'GET', '/api/admin/items', null, 'wrong')).status, 401);
  assert.strictEqual((await api(port, 'GET', '/api/admin/items', null, K)).status, 200);
  console.log('ok - admin API needs the key');

  const good = { name: 'Frost Dragon', piece: 'dragon', price: 500, description: 'Ice and fury', image: PNG };
  for (const [bad, why] of [[{ ...good, piece: 'banana' }, 'bad piece'], [{ ...good, price: -5 }, 'negative price'], [{ ...good, price: 1.5 }, 'fractional price'],
    [{ ...good, name: '  ' }, 'empty name'], [{ ...good, image: Buffer.from('not an image at all').toString('base64') }, 'not an image'], [{ ...good, image: '' }, 'no image']]) {
    const r = await api(port, 'POST', '/api/admin/items', bad, K);
    assert.strictEqual(r.status, 400, why + ' rejected');
  }
  assert.strictEqual((await api(port, 'GET', '/api/admin/items', null, K)).body.items.length, 0);
  console.log('ok - invalid skins rejected, nothing saved');

  const add = await api(port, 'POST', '/api/admin/items', good, K);
  assert.strictEqual(add.status, 200);
  const it = add.body.item;
  assert.strictEqual(it.id, 'frost-dragon'); assert.strictEqual(it.price, 500); assert.strictEqual(it.piece, 'dragon');
  assert.ok(/^art\/frost-dragon-[0-9a-f]{6}\.png$/.test(it.image), it.image);
  assert.ok(fs.existsSync(path.join(dir, it.image)), 'image file written');
  const cj = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
  assert.strictEqual(cj.items[0].id, 'frost-dragon');
  const cjs = fs.readFileSync(path.join(dir, 'catalog.js'), 'utf8');
  assert.ok(cjs.includes('window.HC_CATALOG') && cjs.includes('frost-dragon'));
  console.log('ok - skin added: json, js and image file written');

  const dup = await api(port, 'POST', '/api/admin/items', good, K);
  assert.strictEqual(dup.body.item.id, 'frost-dragon-2', 'duplicate names get distinct ids');
  console.log('ok - duplicate names get unique ids');

  const upd = await api(port, 'PUT', '/api/admin/items/frost-dragon', { price: 750, name: 'Frost Dragon II' }, K);
  assert.strictEqual(upd.body.item.price, 750); assert.strictEqual(upd.body.item.name, 'Frost Dragon II');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')).items[0].price, 750);
  assert.strictEqual((await api(port, 'PUT', '/api/admin/items/frost-dragon', { price: 'free' }, K)).status, 400);
  console.log('ok - price and name can be changed');

  const del = await api(port, 'DELETE', '/api/admin/items/frost-dragon', null, K);
  assert.strictEqual(del.status, 200); assert.ok(!fs.existsSync(path.join(dir, it.image)), 'image removed');
  assert.strictEqual((await api(port, 'DELETE', '/api/admin/items/frost-dragon', null, K)).status, 404);
  console.log('ok - skin deleted with its image');

  // skins are relayed to the opponent, sanitised
  const open = (n) => new Promise((res) => { const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws'); const c = { ws, msgs: [] }; ws.on('message', (d) => c.msgs.push(JSON.parse(d))); ws.on('open', () => res(c)); });
  const A = await open(), B = await open();
  A.ws.send(JSON.stringify({ type: 'create', name: 'A', skins: { dragon: 'frost-dragon-2', joker: '../../etc/passwd', evil: 'x', knight: 5 } }));
  await new Promise((r) => setTimeout(r, 150));
  const code = A.msgs.find((m) => m.type === 'joined').code;
  B.ws.send(JSON.stringify({ type: 'join', code, name: 'B', skins: { wizard: 'ink-wizard' } }));
  await new Promise((r) => setTimeout(r, 200));
  const sb = B.msgs.filter((m) => m.type === 'state' && m.started).pop(), sa = A.msgs.filter((m) => m.type === 'state' && m.started).pop();
  assert.deepStrictEqual(sb.oppSkins, { dragon: 'frost-dragon-2' }, 'B sees A skins, junk dropped');
  assert.deepStrictEqual(sa.oppSkins, { wizard: 'ink-wizard' });
  console.log('ok - equipped skins are relayed to the opponent (sanitised)');

  A.ws.close(); B.ws.close(); server.close();
  console.log('\nshop tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
