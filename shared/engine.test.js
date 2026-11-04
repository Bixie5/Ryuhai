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

t('losing one of two Monarchs does not end the game; losing the last one does', () => {
  let s = E.play(
    state(['empress', 'fool'], ['monarch', 'monarch', 'wizard']),
    id(0, 'empress'), id(1, 'monarch', 0)
  );
  assert.ok(!s.over, 'one Monarch remains, so the game continues');
  assert.strictEqual(count(s, 1, 'monarch'), 1);

  s = E.play(s, id(0, 'empress'), id(1, 'monarch', 1));
  assert.ok(s.over && s.winner === 0 && s.end.code === 'monarch');
});

t('simultaneously losing one of two Monarchs each is not a Monarch draw', () => {
  const s = E.play(
    state(['monarch', 'monarch', 'fool'], ['monarch', 'monarch', 'wizard']),
    id(0, 'monarch', 0), id(1, 'monarch', 0)
  );
  assert.ok(!s.over, 'both players still have one Monarch');
  assert.strictEqual(count(s, 0, 'monarch'), 1);
  assert.strictEqual(count(s, 1, 'monarch'), 1);
});

t('win by opponent running out of pieces', () => {
  const s = E.play(state(['knight', 'knight2'].map((x) => x === 'knight2' ? 'dragon' : x), ['fool']), id(0, 'knight'), id(1, 'fool'));
  assert.ok(s.over && s.winner === 0 && s.end.code === 'no_pieces');
});

t('no piece able to beat the other is NOT a loss; play continues', () => {
  // seat 1 holds only fools, seat 0 holds only knights + monarch: fools cannot win, but the game goes on
  const s = E.play(state(['knight', 'monarch'], ['fool', 'fool', 'wizard']), id(0, 'knight'), id(1, 'wizard'));
  assert.ok(!s.over, 'game continues until a Monarch falls');
});

t('Empress and Knave sitting only against Fools: still no end without a Monarch capture', () => {
  const s = E.play(state(['fool', 'fool'], ['fool', 'fool']), id(0, 'fool'), id(1, 'fool'));
  assert.ok(!s.over || s.end.code === 'no_pieces');
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
  assert.ok(!('oppCount' in v), 'no information about the opponent hand');
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

// ---------- bot ----------
function seeded(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }

t('every bot level returns a legal piece and finishes games', () => {
  ['easy', 'normal', 'hard'].forEach((lv) => {
    const rng = seeded(11);
    let finished = 0;
    for (let n = 0; n < 60; n++) {
      let s = E.createGame(), guard = 0;
      while (!s.over && guard++ < 1000) {
        const a = E.botPick(s, 0, rng, lv), b = E.botPick(s, 1, rng, lv);
        assert.ok(s.hands[0].some((p) => p.id === a) && s.hands[1].some((p) => p.id === b), 'legal pick');
        s = E.play(s, a, b);
      }
      if (s.over) finished++;
    }
    assert.ok(finished >= 55, lv + ' finished=' + finished);
  });
});

t('the bot never looks at the opponent hand or pick (fair play)', () => {
  let s = E.createGame();
  s = E.play(s, id(0, 'wizard', 0), id(1, 'fool', 0));
  ['easy', 'normal', 'hard'].forEach((lv) => {
    const real = E.botPick(s, 1, seeded(5), lv);
    const tampered = JSON.parse(JSON.stringify(s));
    tampered.hands[0] = [{ id: '0-joker-0', type: 'joker', royal: false }];   // pretend the opponent holds something else
    assert.strictEqual(E.botPick(tampered, 1, seeded(5), lv), real, lv + ' ignores the opponent hand in the state');
  });
});

t('hand tracking follows public history, including a Joker that transformed', () => {
  let s = E.createGame();
  s = E.play(s, id(0, 'joker', 0), id(1, 'knight', 0));          // seat 0 Joker becomes a Knight
  let h = E.trackHand(s.history, 0);
  assert.strictEqual(h.counts.joker, 0); assert.strictEqual(h.counts.knight, 2); assert.strictEqual(h.royal, 1);
  s = E.play(s, id(0, 'monarch', 0), id(1, 'empress', 0));       // seat 0 Monarch is captured
  h = E.trackHand(s.history, 0);
  assert.strictEqual(h.royal, 0); assert.strictEqual(h.counts.monarch, 0);
  s = E.play(E.createGame(), id(0, 'dragon', 0), id(1, 'fool', 0));   // Dragon wins and is spent
  assert.strictEqual(E.trackHand(s.history, 0).counts.dragon, 0);
  assert.strictEqual(E.trackHand(s.history, 1).counts.fool, 1);
});

t('hand tracking never disagrees with the real hand', () => {
  const rng = seeded(3);
  for (let n = 0; n < 40; n++) {
    let s = E.createGame(), guard = 0;
    while (!s.over && guard++ < 300) {
      s = E.play(s, E.botPick(s, 0, rng, 'normal'), E.botPick(s, 1, rng, 'easy'));
      [0, 1].forEach((seat) => {
        const h = E.trackHand(s.history, seat);
        E.ORDER.forEach((ty) => assert.strictEqual(h.counts[ty], count(s, seat, ty), 'seat ' + seat + ' ' + ty));
      });
    }
  }
});

t('habits are learned: a player who keeps repeating a winning piece becomes predictable', () => {
  // seat 0 wins with the Monarch three times running (against weak pieces), so the model should expect it again
  let s = E.createGame();
  s = E.play(s, id(0, 'monarch', 0), id(1, 'fool', 0));
  s = E.play(s, id(0, 'monarch', 0), id(1, 'fool', 1));
  s = E.play(s, id(0, 'monarch', 0), id(1, 'knave', 0));
  const est = E.trackHand(s.history, 0).counts;
  const hard = E.predictOpponent(s.history, 0, est, 'hard');
  const easy = E.predictOpponent(s.history, 0, est, 'easy');
  const fresh = E.predictOpponent([], 0, E.trackHand([], 0).counts, 'hard');
  assert.ok(hard.monarch > easy.monarch + 0.15, 'hard reads the repeat: ' + hard.monarch + ' vs ' + easy.monarch);
  assert.ok(hard.monarch > fresh.monarch + 0.15);
  assert.ok(Math.abs(Object.keys(hard).reduce((a, k) => a + hard[k], 0) - 1) < 1e-9, 'probabilities add up to 1');
});

t('hard bot keeps a Monarch-killer for the end and uses it when the Monarch is the only target', () => {
  // public history: every one of the opponent's pieces except the Monarch has been destroyed
  const st = state(['monarch'], ['dragon', 'empress', 'monarch', 'fool']);
  const gone = ['dragon', 'knight', 'wizard', 'wizard', 'knave', 'knave', 'fool', 'fool', 'empress', 'joker'];
  st.history = gone.map((ty, i) => ({ round: i + 1, types: [ty, 'fool'], outcome: 'win1', destroyed: [{ seat: 0, type: ty, royal: false, wasJoker: false }], spent: [], became: null }));
  assert.deepStrictEqual(Object.keys(E.trackHand(st.history, 0).counts).filter((k) => E.trackHand(st.history, 0).counts[k] > 0), ['monarch']);
  const rng = seeded(8);
  ['normal', 'hard'].forEach((lv) => {
    for (let i = 0; i < 40; i++) {
      const pick = E.botPick(st, 1, rng, lv);
      const ty = st.hands[1].find((p) => p.id === pick).type;
      assert.ok(ty === 'dragon' || ty === 'empress', lv + ' played ' + ty);
    }
  });
});

t('levels are ordered by strength: hard beats normal beats easy', () => {
  function duel(la, lb, N, seed) {
    const rng = seeded(seed); let a = 0, b = 0;
    for (let g = 0; g < N; g++) {
      const aSeat = g % 2, lv = aSeat === 0 ? [la, lb] : [lb, la];
      let s = E.createGame(), n = 0;
      while (!s.over && n++ < 300) s = E.play(s, E.botPick(s, 0, rng, lv[0]), E.botPick(s, 1, rng, lv[1]));
      if (s.over && s.winner !== 'draw') { if (s.winner === aSeat) a++; else b++; }
    }
    return a / Math.max(1, a + b);
  }
  const hn = duel('hard', 'normal', 240, 21), he = duel('hard', 'easy', 240, 22), ne = duel('normal', 'easy', 240, 23);
  assert.ok(hn > 0.6, 'hard vs normal ' + hn.toFixed(2));
  assert.ok(he > 0.6, 'hard vs easy ' + he.toFixed(2));
  assert.ok(ne > 0.5, 'normal vs easy ' + ne.toFixed(2));
});

console.log('\n' + passed + ' tests passed');
