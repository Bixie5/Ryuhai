const assert = require('assert');
const E = require('./engine');
const M = require('./multi');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok - ' + name); }

// Build a game where each seat holds exactly the listed piece types.
function game(hands) {
  const g = M.createGame(hands.length);
  hands.forEach((types, seat) => {
    const seen = {};
    g.players[seat].hand = types.map((type) => { seen[type] = seen[type] || 0; return { id: seat + '-' + type + '-' + (seen[type]++), type: type, royal: type === 'monarch' }; });
  });
  return g;
}
const pk = (g, seat, type, copy) => { const p = g.players[seat].hand.find((x) => x.type === type); return copy == null ? { id: p.id } : { id: p.id, copy: copy }; };
const has = (g, seat, type) => g.players[seat].hand.some((p) => p.type === type);
const count = (g, seat, type) => g.players[seat].hand.filter((p) => p.type === type).length;

t('starting hands: 2 to 6 players, 11 pieces each', () => {
  [2, 3, 6].forEach((n) => { const g = M.createGame(n); assert.strictEqual(g.players.length, n); g.players.forEach((p) => assert.strictEqual(p.hand.length, 11)); });
  assert.strictEqual(M.createGame(9).n, 6);
  assert.strictEqual(M.createGame(1).n, 2);
});

t('cycle A Empress, B Monarch, C Knight: simultaneous, all three pieces destroyed', () => {
  const g = game([['empress', 'fool', 'monarch'], ['monarch', 'fool', 'wizard'], ['knight', 'fool', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'empress'), pk(g, 1, 'monarch'), pk(g, 2, 'knight')]);
  assert.ok(!has(s, 0, 'empress') && !has(s, 1, 'monarch') && !has(s, 2, 'knight'));
  assert.strictEqual(s.players[0].hand.length, 2);
  assert.strictEqual(s.history[0].destroyed.length, 3);
  // B lost its only Monarch -> out; A and C still hold one each... C kept its second Monarch, A also
  assert.strictEqual(s.players[1].alive, false);
  assert.strictEqual(s.players[0].alive, true);
});

t('a piece that wins one clash but loses another is destroyed', () => {
  const g = game([['wizard', 'monarch'], ['fool', 'monarch'], ['knight', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'wizard'), pk(g, 1, 'fool'), pk(g, 2, 'knight')]);
  assert.ok(!has(s, 0, 'wizard'), 'wizard beat the fool but lost to the knight');
  assert.ok(!has(s, 1, 'fool'));
  assert.ok(has(s, 2, 'knight'), 'knight beat both and returns');
});

t('winning every clash returns the piece; same pieces destroy each other', () => {
  const g = game([['knight', 'monarch'], ['wizard', 'monarch'], ['wizard', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'knight'), pk(g, 1, 'wizard'), pk(g, 2, 'wizard')]);
  assert.ok(has(s, 0, 'knight'));
  assert.strictEqual(count(s, 1, 'wizard') + count(s, 2, 'wizard'), 0);
});

t('Dragon is spent after winning, but not when it only draws', () => {
  const g = game([['dragon', 'monarch'], ['fool', 'monarch'], ['knave', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'dragon'), pk(g, 1, 'fool'), pk(g, 2, 'knave')]);
  assert.ok(!has(s, 0, 'dragon'));
  assert.strictEqual(s.history[0].spent.length, 1);
});

t('Joker copies the chosen player: draws with them, fights others as that piece', () => {
  const g = game([['joker', 'monarch'], ['knight', 'monarch'], ['fool', 'monarch']]);
  // Joker copies the Knight (seat 1): it becomes a Knight, draws with seat 1, beats the Fool.
  const s = M.play(g, [pk(g, 0, 'joker', 1), pk(g, 1, 'knight'), pk(g, 2, 'fool')]);
  assert.ok(has(s, 0, 'knight') && !has(s, 0, 'joker'), 'now a Knight for good');
  assert.ok(has(s, 1, 'knight'), 'the copied Knight returns');
  assert.ok(!has(s, 2, 'fool'), 'the Fool lost to the copied Knight');
  assert.deepStrictEqual(s.history[0].became, [{ seat: 0, type: 'knight', from: 1 }]);
});

t('Joker copying a piece that loses to another player is destroyed', () => {
  const g = game([['joker', 'monarch'], ['fool', 'monarch'], ['knave', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'joker', 1), pk(g, 1, 'fool'), pk(g, 2, 'knave')]);
  assert.ok(!has(s, 0, 'fool') && !has(s, 0, 'joker'), 'the Joker became a Fool and the Knave destroyed it');
  assert.ok(!has(s, 1, 'fool'), 'the copied Fool drew with the Joker but the Knave destroyed it');
  assert.ok(has(s, 2, 'knave'), 'the Knave beat both Fools and returns');
});

t('Joker copying a Joker stays a Joker and cannot be destroyed', () => {
  const g = game([['joker', 'monarch'], ['joker', 'monarch'], ['dragon', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'joker', 1), pk(g, 1, 'joker', 0), pk(g, 2, 'dragon')]);
  assert.ok(has(s, 0, 'joker') && has(s, 1, 'joker'));
  assert.ok(has(s, 2, 'dragon'), 'the Dragon beat nobody (both Jokers draw) so it is not spent');
});

t('Joker must name another living player', () => {
  const g = game([['joker', 'monarch'], ['fool', 'monarch'], ['fool', 'monarch']]);
  assert.throws(() => M.play(g, [{ id: '0-joker-0' }, pk(g, 1, 'fool'), pk(g, 2, 'fool')]));
  assert.throws(() => M.play(g, [{ id: '0-joker-0', copy: 0 }, pk(g, 1, 'fool'), pk(g, 2, 'fool')]));
  assert.ok(M.checkPick(g, 0, { id: '0-joker-0', copy: 2 }) === '');
});

t('losing the last Monarch eliminates, ranks are shared when several fall together', () => {
  const g = game([['dragon', 'monarch'], ['knight', 'monarch'], ['wizard', 'monarch'], ['monarch', 'fool']]);
  // Dragon beats everything. Knight+Wizard Monarchs? They play the Monarch pieces to lose them.
  const s = M.play(g, [pk(g, 0, 'dragon'), pk(g, 1, 'monarch'), pk(g, 2, 'monarch'), pk(g, 3, 'monarch')]);
  assert.strictEqual(s.over, true);
  assert.deepStrictEqual(s.winners, [0]);
  assert.deepStrictEqual(M.placings(s), [1, 2, 2, 2]);
});

t('a second Monarch keeps a player alive', () => {
  const g = game([['dragon', 'monarch'], ['monarch', 'monarch', 'fool'], ['wizard', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'dragon'), pk(g, 1, 'monarch'), pk(g, 2, 'wizard')]);
  assert.strictEqual(s.players[1].alive, true);
  assert.strictEqual(count(s, 1, 'monarch'), 1);
});

t('the last players falling together share first place (a draw)', () => {
  const g = game([['monarch', 'fool'], ['monarch', 'fool']]);
  const s = M.play(g, [pk(g, 0, 'monarch'), pk(g, 1, 'monarch')]);
  assert.strictEqual(s.over, true);
  assert.deepStrictEqual(s.winners.sort(), [0, 1]);
  assert.deepStrictEqual(M.placings(s), [1, 1]);
  assert.ok(/draw/.test(M.endText(s, ['A', 'B'])));
});

t('eliminated players stop playing; pick from a dead seat is rejected', () => {
  const g = game([['dragon', 'monarch'], ['fool', 'monarch'], ['monarch', 'fool'], ['wizard', 'monarch']]);
  const s = M.play(g, [pk(g, 0, 'dragon'), pk(g, 1, 'fool'), pk(g, 2, 'monarch'), pk(g, 3, 'wizard')]);
  assert.strictEqual(s.players[2].alive, false);
  assert.strictEqual(s.over, false);
  assert.ok(M.checkPick(s, 2, { id: '2-fool-0' }) !== '');
  assert.deepStrictEqual(M.aliveSeats(s), [0, 1, 3]);
});

t('view never shows other hands or current picks', () => {
  const g = M.createGame(4);
  const v = M.viewFor(g, 2, [false, true, false, false]);
  assert.strictEqual(v.you.length, 11);
  assert.strictEqual(JSON.stringify(v).indexOf('"hand"'), -1);
  assert.strictEqual(v.locked[1], true);
  assert.ok(!('players' in v));
});

t('bots: legal picks, fair play, Joker always names a living opponent', () => {
  let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  ['random', 'smart'].forEach((level) => {
    for (let g = 0; g < 60; g++) {
      let s = M.createGame(2 + (g % 5)), n = 0;
      while (!s.over && n++ < 120) {
        const picks = []; M.aliveSeats(s).forEach((i) => { picks[i] = M.botPick(s, i, rng, level); assert.strictEqual(M.checkPick(s, i, picks[i]), '', level + ' made an illegal pick'); });
        s = M.play(s, picks);
      }
    }
  });
  const g = M.createGame(3), real = M.botPick(g, 1, (() => { let a = 1; return () => (a = (a * 16807) % 2147483647) / 2147483647; })(), 'smart');
  const t2 = JSON.parse(JSON.stringify(g)); t2.players[0].hand = t2.players[0].hand.slice(0, 2);
  const again = M.botPick(t2, 1, (() => { let a = 1; return () => (a = (a * 16807) % 2147483647) / 2147483647; })(), 'smart');
  assert.deepStrictEqual(again, real, 'bot ignores the real opponent hands');
});

t('random bot never plays a piece an opponent is certain to destroy', () => {
  const g = game([['fool', 'monarch'], ['knight', 'monarch'], ['wizard', 'monarch']]);
  // Record every piece of seat 1 except one Knight as destroyed, so everybody can tell it holds only a Knight.
  const all = ['dragon', 'monarch', 'wizard', 'wizard', 'knave', 'knave', 'fool', 'fool', 'empress', 'joker'];   // only a Knight is left
  g.history = [{ round: 1, picks: [], clashes: [], destroyed: all.map((type) => ({ seat: 1, type: type, royal: false })), spent: [], became: [], eliminated: [] }];
  for (let i = 0; i < 200; i++) {
    const p = M.botPick(g, 0, Math.random, 'random');
    assert.strictEqual(g.players[0].hand.find((x) => x.id === p.id).type, 'monarch', 'a lone Knight destroys the Fool, but the Monarch beats it');
  }
});

t('smart bots beat random bots over many six-player games', () => {
  let seed = 99; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let smartWins = 0, randWins = 0;
  for (let g = 0; g < 150; g++) {
    let s = M.createGame(4), n = 0;
    const lv = ['smart', 'random', 'random', 'random'];
    while (!s.over && n++ < 200) { const picks = []; M.aliveSeats(s).forEach((i) => { picks[i] = M.botPick(s, i, rng, lv[i]); }); s = M.play(s, picks); }
    if (s.over && s.winners.length === 1) { if (s.winners[0] === 0) smartWins++; else randWins++; }
  }
  assert.ok(smartWins > randWins / 3 * 1.2, 'smart ' + smartWins + ' vs each random ' + (randWins / 3).toFixed(1));
});

t('smart bots keep the Dragon back in a crowded game', () => {
  let seed = 5; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let opens = 0, dragons = 0;
  for (let g = 0; g < 80; g++) {
    const s = M.createGame(6);
    for (let i = 0; i < 6; i++) { const p = M.botPick(s, i, rng, 'smart'); opens++; if (s.players[i].hand.find((x) => x.id === p.id).type === 'dragon') dragons++; }
  }
  assert.ok(dragons / opens < 0.1, 'opened with the Dragon ' + (100 * dragons / opens).toFixed(0) + '% of the time');
});

console.log('\n' + passed + ' multiplayer tests passed');
