const assert = require('assert');
const E = require('./engine');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok - ' + name); }

const id = (seat, type, i) => seat + '-' + type + '-' + (i || 0);
const mk = (seat, types) => {
  const seen = {};
  return types.map((type) => {
    seen[type] = (seen[type] || 0);
    const p = { id: id(seat, type, seen[type]), type: type, royal: type === 'monarch' };
    seen[type]++;
    return p;
  });
};
const state = (a, b) => ({ hands: [mk(0, a), mk(1, b)], round: 0, idle: 0, over: false, winner: null, end: null, history: [] });
const has = (s, seat, type) => s.hands[seat].some((p) => p.type === type);
const count = (s, seat, type) => s.hands[seat].filter((p) => p.type === type).length;

t('starting hands have 11 pieces with correct counts', () => {
  const g = E.createGame();
  [0, 1].forEach((seat) => {
    assert.strictEqual(g.hands[seat].length, 11);
    assert.strictEqual(count(g, seat, 'dragon'), 1);
    assert.strictEqual(count(g, seat, 'wizard'), 2);
    assert.strictEqual(count(g, seat, 'knave'), 2);
    assert.strictEqual(count(g, seat, 'fool'), 2);
    assert.strictEqual(count(g, seat, 'joker'), 1);
  });
});

t('beats table matches the spec', () => {
  assert.ok(E.beats('dragon', 'monarch') && E.beats('dragon', 'empress'));
  assert.ok(E.beats('empress', 'monarch') && !E.beats('empress', 'knight'));
  assert.ok(E.beats('monarch', 'fool') && !E.beats('monarch', 'empress'));
  assert.ok(E.beats('knight', 'empress') && !E.beats('knight', 'monarch'));
  assert.ok(E.beats('wizard', 'empress') && !E.beats('wizard', 'knight'));
  assert.ok(E.beats('knave', 'fool') && E.beats('knave', 'empress'));
  assert.ok(E.beats('fool', 'empress') && !E.beats('fool', 'knave'));
});

t('only the Dragon is spent; every other winner returns to hand', () => {
  let s = state(['wizard', 'knight', 'dragon'], ['fool', 'knave', 'wizard', 'monarch']);
  s = E.play(s, id(0, 'wizard'), id(1, 'fool'));
  assert.strictEqual(count(s, 0, 'wizard'), 1, 'wizard stays');
  const d = E.play(state(['dragon', 'fool'], ['knight', 'fool']), id(0, 'dragon'), id(1, 'knight'));
  assert.strictEqual(count(d, 0, 'dragon'), 0, 'dragon spent');
  assert.strictEqual(count(d, 1, 'knight'), 0, 'knight destroyed');
  assert.strictEqual(count(s, 1, 'fool'), 0, 'fool destroyed');
  let r = state(['knight', 'dragon'], ['fool', 'wizard']);
  r = E.play(r, id(0, 'knight'), id(1, 'fool'));
  assert.strictEqual(count(r, 0, 'knight'), 1, 'knight stays');
});

t('same piece destroys both', () => {
  const s = E.play(state(['knight', 'fool', 'dragon'], ['knight', 'wizard', 'dragon']), id(0, 'knight'), id(1, 'knight'));
  assert.strictEqual(count(s, 0, 'knight'), 0);
  assert.strictEqual(count(s, 1, 'knight'), 0);
});

t('joker becomes opponent piece; both return to hand', () => {
  const s = E.play(state(['joker', 'knight'], ['dragon', 'fool']), id(0, 'joker'), id(1, 'dragon'));
  assert.ok(has(s, 0, 'dragon'), 'joker is now a dragon');
  assert.ok(!has(s, 0, 'joker'), 'cannot revert to joker');
  assert.strictEqual(count(s, 1, 'dragon'), 1, 'opponent dragon returned, not spent');
  assert.strictEqual(s.hands[0].length, 2);
  assert.strictEqual(s.hands[1].length, 2);
});

t('joker vs joker: both stay', () => {
  const s = E.play(state(['joker', 'fool'], ['joker', 'fool']), id(0, 'joker'), id(1, 'joker'));
  assert.strictEqual(count(s, 0, 'joker'), 1);
  assert.strictEqual(count(s, 1, 'joker'), 1);
  assert.ok(!s.over);
});

t('transformed joker is not a monarch for loss purposes', () => {
  let s = state(['joker', 'knight', 'fool'], ['monarch', 'knight', 'fool']);
  s = E.play(s, id(0, 'joker'), id(1, 'monarch'));
  const j = s.hands[0].find((p) => p.wasJoker);
  assert.strictEqual(j.type, 'monarch');
  assert.ok(!j.royal);
});

t('win by monarch capture', () => {
  const s = E.play(state(['knight', 'fool'], ['monarch', 'wizard', 'fool']), id(0, 'knight'), id(1, 'wizard'));
  assert.ok(!s.over);
  const w = E.play(state(['empress', 'fool'], ['monarch', 'fool']), id(0, 'empress'), id(1, 'monarch'));
  assert.ok(w.over && w.winner === 0 && w.end.code === 'monarch' && w.end.loser === 1);
});

t('win by opponent running out of pieces', () => {
  const s = E.play(state(['knight', 'knight2'].map((x) => x === 'knight2' ? 'dragon' : x), ['fool']), id(0, 'knight'), id(1, 'fool'));
  assert.ok(s.over && s.winner === 0 && s.end.code === 'no_pieces');
});

t('win when opponent has nothing that can beat anything of yours', () => {
  // seat 1 holds only fools; seat 0 holds only knights (and a fool pair removed). Fools can't beat knights.
  const s = E.play(state(['knight', 'knight'.replace('knight', 'monarch')], ['fool', 'fool', 'wizard']), id(0, 'knight'), id(1, 'wizard'));
  // seat1 left: fool, fool. seat0: knight, monarch -> fools beat only empress -> seat1 loses
  assert.ok(s.over && s.winner === 0 && s.end.code === 'no_power' && s.end.loser === 1);
});

t('joker holder is never stuck on no_power', () => {
  const s = state(['joker'], ['knight']);
  assert.ok(E.canWinAny(s.hands[0], s.hands[1]));
});

t('mutual loss is a draw', () => {
  const s = E.play(state(['monarch'], ['monarch']), id(0, 'monarch'), id(1, 'monarch'));
  assert.ok(s.over && s.winner === 'draw');
});

t('no round limit: Joker vs Joker never ends the game by itself', () => {
  let s = state(['joker', 'knight'], ['joker', 'knight']);
  for (let i = 0; i < 100; i++) s = E.play(s, id(0, 'joker'), id(1, 'joker'));
  assert.ok(!s.over && s.round === 100);
});

t('play does not mutate input and rejects bad ids', () => {
  const s = state(['knight', 'fool'], ['fool', 'wizard']);
  const before = JSON.stringify(s);
  E.play(s, id(0, 'knight'), id(1, 'fool'));
  assert.strictEqual(JSON.stringify(s), before);
  assert.throws(() => E.play(s, 'nope', id(1, 'fool')));
});

t('viewFor hides nothing but the pick', () => {
  const g = E.createGame();
  const v = E.viewFor(g, 0, [true, false]);
  assert.strictEqual(v.you.length, 11);
  assert.strictEqual(v.oppCount, 11);
  assert.ok(!('opp' in v), 'opponent hand is not sent');
  assert.deepStrictEqual(v.locked, { you: true, opp: false });
});

t('bot returns a legal id and plays a full game without throwing', () => {
  let finished = 0;
  for (let n = 0; n < 200; n++) {
    let s = E.createGame();
    let guard = 0;
    while (!s.over && guard++ < 2000) {
      s = E.play(s, E.botPick(s, 0), E.botPick(s, 1));
    }
    if (s.over) finished++;
  }
  assert.ok(finished >= 190, 'bot games almost always finish, finished=' + finished);
});

console.log('\n' + passed + ' tests passed');
