const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('./server');

function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], wait: null };
    ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (c.wait && c.wait.f(m)) { const w = c.wait; c.wait = null; w.r(m); } });
    c.send = (m) => ws.send(JSON.stringify(m));
    c.next = (f) => new Promise((r) => { const hit = c.msgs.find(f); if (hit) { c.msgs.splice(c.msgs.indexOf(hit), 1); return r(hit); } c.wait = { f, r: (m) => { c.msgs.splice(c.msgs.indexOf(m), 1); r(m); } }; });
    ws.on('open', () => resolve(c));
  });
}

(async () => {
  const tmpShop = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'hc-shop-'));
  const { server } = createServer({ shopDir: tmpShop });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const a = await client(port), b = await client(port);

  a.send({ type: 'create', name: 'Ann' });
  const ja = await a.next((m) => m.type === 'joined');
  assert.strictEqual(ja.seat, 0); assert.strictEqual(ja.code.length, 4);
  console.log('ok - create room');

  const c0 = await client(port); c0.send({ type: 'list' });
  assert.ok((await c0.next((m) => m.type === 'rooms')).rooms.some((r) => r.code === ja.code)); c0.ws.close();
  console.log('ok - open rooms are listed');

  b.send({ type: 'join', code: ja.code.toLowerCase(), name: 'Bob' });
  const jb = await b.next((m) => m.type === 'joined'); assert.strictEqual(jb.seat, 1);
  const sa = await a.next((m) => m.type === 'state' && m.started);
  const sb = await b.next((m) => m.type === 'state' && m.started);
  assert.deepStrictEqual(sa.names, ['Ann', 'Bob']);
  assert.ok(!('opp' in sb.view) && !('oppCount' in sb.view), 'opp hand not sent'); assert.ok(!JSON.stringify(sb).includes(sa.view.you[0].id), 'opponent piece ids never sent');
  assert.strictEqual(sa.gid, 1); assert.strictEqual(sb.gid, 1);
  console.log('ok - join starts game, opponent hand hidden');

  const full = await client(port); full.send({ type: 'join', code: ja.code, name: 'X' });
  assert.ok((await full.next((m) => m.type === 'error')).message.match(/full/)); full.ws.close();
  console.log('ok - third player rejected');

  // Hidden pick: Ann locks in; Bob must see only "locked", never the piece.
  const annDragon = sa.view.you.find((p) => p.type === 'dragon').id;
  const bobFool = sb.view.you.find((p) => p.type === 'fool').id;
  a.send({ type: 'pick', id: annDragon });
  const sb2 = await b.next((m) => m.type === 'state' && m.view && m.view.locked.opp);
  assert.ok(!/"picks?":/.test(JSON.stringify(sb2)), 'no pick field sent'); assert.strictEqual(sb2.view.last, null, 'nothing revealed yet');
  assert.strictEqual(sb2.view.round, 0);
  console.log('ok - pick stays hidden');

  b.send({ type: 'pick', id: bobFool });
  const r = await a.next((m) => m.type === 'state' && m.view && m.view.round === 1);
  assert.deepStrictEqual(r.view.last.types, ['dragon', 'fool']);
  assert.strictEqual(r.view.last.outcome, 'win0');
  console.log('ok - round resolves and reveals');

  // After a round both players must press Next turn before anyone can pick again.
  assert.strictEqual(r.phase, 'result');
  const bobWizard = (await b.next((m) => m.type === 'state' && m.view && m.view.round === 1)).view.you.find((p) => p.type === 'wizard').id;
  b.send({ type: 'pick', id: bobWizard });
  b.send({ type: 'next' });
  const afterBobNext = await a.next((m) => m.type === 'state' && m.next && m.next.opp);
  assert.strictEqual(afterBobNext.phase, 'result', 'still result until both are ready');
  assert.strictEqual(afterBobNext.view.locked.opp, false, 'pick during result phase was ignored');
  a.send({ type: 'next' });
  const go = await a.next((m) => m.type === 'state' && m.phase === 'pick' && m.view && m.view.round === 1);
  assert.ok(!go.next.you && !go.next.opp);
  console.log('ok - next turn needs both players');

  // cannot play a piece you do not hold (spent dragon)
  a.send({ type: 'pick', id: annDragon });
  assert.ok((await a.next((m) => m.type === 'error')).message);
  console.log('ok - spent piece rejected');

  // reconnect
  b.ws.close();
  const b2 = await client(port); b2.send({ type: 'resume', code: ja.code, token: jb.token });
  const rj = await b2.next((m) => m.type === 'joined'); assert.strictEqual(rj.seat, 1);
  const rs = await b2.next((m) => m.type === 'state' && m.view); assert.strictEqual(rs.view.round, 1);
  console.log('ok - reconnect resumes seat');

  a.ws.close(); b2.ws.close(); server.close();
  console.log('\nserver tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
