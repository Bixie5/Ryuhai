const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('./server');

function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], wait: null, last: null };
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'mstate') c.last = m; c.msgs.push(m); if (c.wait && c.wait.f(m)) { const w = c.wait; c.wait = null; w.r(m); } });
    c.send = (m) => ws.send(JSON.stringify(m));
    // Resolves with the next message matching f (already received or still to come).
    c.next = (f) => new Promise((r) => { const hit = c.msgs.find(f); if (hit) { c.msgs.splice(c.msgs.indexOf(hit), 1); return r(hit); } c.wait = { f, r: (m) => { c.msgs.splice(c.msgs.indexOf(m), 1); r(m); } }; });
    c.state = (f) => c.next((m) => m.type === 'mstate' && (!f || f(m)));
    ws.on('open', () => resolve(c));
  });
}
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timed out: ' + what)), ms))]);

(async () => {
  const tmpShop = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'hc-shop-'));
  const srv = createServer({ shopDir: tmpShop, multiAutoMs: 10 });
  const { server, multi } = srv;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const a = await client(port), b = await client(port), c = await client(port);

  a.send({ type: 'mcreate', name: 'Ann' });
  const ja = await a.next((m) => m.type === 'mjoined');
  assert.strictEqual(ja.seat, 0); assert.strictEqual(ja.code.length, 4);
  console.log('ok - create a multiplayer room');

  a.send({ type: 'mstart' });
  assert.ok((await a.next((m) => m.type === 'error')).message.match(/at least 2/));
  console.log('ok - cannot start alone');

  const lst = await client(port); lst.send({ type: 'mlist' });
  assert.ok((await lst.next((m) => m.type === 'mrooms')).rooms.some((r) => r.code === ja.code && r.count === 1)); lst.ws.close();
  console.log('ok - lobbies are listed');

  b.send({ type: 'mjoin', code: ja.code.toLowerCase(), name: 'Ann' });
  const jb = await b.next((m) => m.type === 'mjoined'); assert.strictEqual(jb.seat, 1);
  c.send({ type: 'mjoin', code: ja.code, name: 'Cy' });
  const jc = await c.next((m) => m.type === 'mjoined'); assert.strictEqual(jc.seat, 2);
  const lobby = await a.state((m) => m.names.length === 3);
  assert.deepStrictEqual(lobby.names, ['Ann', 'Ann 2', 'Cy']);
  assert.strictEqual(lobby.phase, 'lobby'); assert.strictEqual(lobby.host, 0);
  console.log('ok - players join, duplicate names are told apart');

  b.send({ type: 'maddbot', level: 'smart' });   // not the host: ignored
  a.send({ type: 'maddbot', level: 'random' });
  const withBot = await a.state((m) => m.names.length === 4);
  assert.deepStrictEqual(withBot.kinds, ['human', 'human', 'human', 'bot']);
  b.send({ type: 'mstart' });                    // not the host: ignored
  console.log('ok - only the host adds bots and starts');

  a.send({ type: 'mstart' });
  const sa = await a.state((m) => m.phase === 'pick'), sb = await b.state((m) => m.phase === 'pick'), sc = await c.state((m) => m.phase === 'pick');
  assert.strictEqual(sa.rated, false, 'a room with a bot is not rated');
  assert.strictEqual(sb.view.you.length, 11);
  assert.ok(!JSON.stringify(sb).includes('"0-'), 'seat 0 piece ids never sent to seat 1');
  assert.ok(!JSON.stringify(sb).includes('"2-'), 'seat 2 piece ids never sent to seat 1');
  assert.strictEqual(sb.view.locked[3], true, 'the bot has already locked in');
  console.log('ok - game starts, other hands hidden');

  // Locking in: others see only "locked". A Joker needs a target.
  const joker = sb.view.you.find((p) => p.type === 'joker').id;
  b.send({ type: 'mpick', id: joker });
  assert.ok((await b.next((m) => m.type === 'error')).message.match(/Joker/));
  b.send({ type: 'mpick', id: joker, copy: 1 });
  assert.ok((await b.next((m) => m.type === 'error')).message.match(/Joker/), 'cannot copy yourself');
  b.send({ type: 'mpick', id: joker, copy: 0 });
  const seen = await a.state((m) => m.view && m.view.locked[1]);
  assert.ok(!/"copy"/.test(JSON.stringify(seen)), 'the Joker target is not revealed before the round');
  assert.strictEqual(seen.view.last, null);
  a.send({ type: 'mpick', id: sa.view.you.find((p) => p.type === 'dragon').id });
  c.send({ type: 'mpick', id: sc.view.you.find((p) => p.type === 'fool').id });
  const r1 = await a.state((m) => m.phase === 'result');
  const log = r1.view.last;
  assert.strictEqual(log.picks.length, 4);
  assert.deepStrictEqual(log.picks.find((p) => p.seat === 1), { seat: 1, type: 'joker', as: log.picks.find((p) => p.seat === 1).as, copy: 0 });
  assert.strictEqual(log.became.find((x) => x.seat === 1).type, 'dragon', 'the Joker copied Ann\'s Dragon');
  console.log('ok - hidden picks, Joker copy target, simultaneous reveal');

  // Everyone must press Next turn.
  a.send({ type: 'mnext' }); b.send({ type: 'mnext' });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(a.last.phase, 'result', 'waits for every living player');
  c.send({ type: 'mnext' });
  await a.state((m) => m.phase === 'pick' && m.view && m.view.round === 1);
  console.log('ok - next round waits for all living humans');

  // Reconnect with the token.
  b.ws.close(); await new Promise((r) => setTimeout(r, 60));
  const b2 = await client(port);
  b2.send({ type: 'mresume', code: ja.code, token: jb.token });
  assert.strictEqual((await b2.next((m) => m.type === 'mjoined')).seat, 1);
  assert.ok((await b2.state()).view.you.length > 0, 'gets its own hand back');
  const bad = await client(port); bad.send({ type: 'mresume', code: ja.code, token: 'nope' });
  assert.ok((await bad.next((m) => m.type === 'error')).fatal); bad.ws.close();
  console.log('ok - reconnect with token');

  // Someone who stays away is replaced by a bot so the game never stalls.
  c.ws.close(); await new Promise((r) => setTimeout(r, 60));
  multi.sweep(Date.now() + 5000, 1e12);                 // marks the offline time
  multi.sweep(Date.now() + 60 * 1000, 1e12);            // past the limit
  const afterAfk = await a.state((m) => m.kinds[2] === 'bot');
  assert.strictEqual(afterAfk.rated, false);
  console.log('ok - an absent player is replaced by a bot');

  // Leaving hands the seat to a bot; the host moves on.
  a.send({ type: 'mleave' });
  await a.next((m) => m.type === 'mleft');
  const afterLeave = await b2.state((m) => m.kinds[0] === 'bot');
  assert.strictEqual(afterLeave.host, 1);
  console.log('ok - leaving gives the seat to a bot, host moves');

  // Play on to the end with whatever b2 has: always pick a piece that is not the Joker.
  let guard = 0, over = null;
  while (!over && guard++ < 400) {
    const m = await timeout(b2.state(), 4000, 'next state');
    if (m.phase === 'over') over = m;
    else if (m.phase === 'pick' && m.view && m.view.alive[1] && !m.view.locked[1]) {
      const p = m.view.you.filter((x) => x.type !== 'joker')[0] || m.view.you[0];
      b2.send(p.type === 'joker' ? { type: 'mpick', id: p.id, copy: m.view.alive.findIndex((v, i) => v && i !== 1) } : { type: 'mpick', id: p.id });
    } else if (m.phase === 'result' && m.view && m.view.alive[1] && !m.next[1]) b2.send({ type: 'mnext' });
  }
  assert.ok(over, 'game reaches an end');
  assert.ok(over.view.winners.length >= 1);
  console.log('ok - a game plays through to the end (' + over.view.round + ' rounds, winners ' + over.view.winners.join(',') + ')');

  b2.send({ type: 'magain' });
  const again = await b2.state((m) => m.phase === 'lobby');
  assert.deepStrictEqual(again.kinds.filter((k) => k === 'human').length, 1);
  assert.ok(again.names.length >= 1);
  console.log('ok - play again returns to the lobby');

  // A human-only room is rated.
  const x = await client(port), y = await client(port);
  x.send({ type: 'mcreate', name: 'X', isPublic: false }); const jx = await x.next((m) => m.type === 'mjoined');
  y.send({ type: 'mjoin', code: jx.code, name: 'Y' }); await y.next((m) => m.type === 'mjoined');
  x.send({ type: 'mstart' });
  assert.strictEqual((await x.state((m) => m.phase === 'pick')).rated, true);
  const ox = await client(port); ox.send({ type: 'mlist' });
  assert.ok(!(await ox.next((m) => m.type === 'mrooms')).rooms.some((r) => r.code === jx.code)); ox.ws.close();
  console.log('ok - human-only room is rated; private rooms are not listed');

  // Seven people cannot sit in a six-seat room.
  const hosts = await client(port); hosts.send({ type: 'mcreate', name: 'H' }); const jh = await hosts.next((m) => m.type === 'mjoined');
  const extras = [];
  for (let i = 0; i < 5; i++) { const e = await client(port); e.send({ type: 'mjoin', code: jh.code, name: 'P' + i }); await e.next((m) => m.type === 'mjoined'); extras.push(e); }
  const seventh = await client(port); seventh.send({ type: 'mjoin', code: jh.code, name: 'Late' });
  assert.ok((await seventh.next((m) => m.type === 'error')).message.match(/full/));
  hosts.send({ type: 'mstart' });
  const six = await hosts.state((m) => m.phase === 'pick'); assert.strictEqual(six.names.length, 6);
  const lateJoin = await client(port); lateJoin.send({ type: 'mjoin', code: jh.code, name: 'L2' });
  assert.ok((await lateJoin.next((m) => m.type === 'error')).message.match(/full|started/));
  console.log('ok - six seats at most; no joining after the start');

  [a, b2, c, x, y, hosts, seventh, lateJoin].concat(extras).forEach((q) => q.ws.close());
  server.close();
  console.log('multiplayer server tests passed');
  setTimeout(() => process.exit(0), 50);
})().catch((e) => { console.error(e); process.exit(1); });
