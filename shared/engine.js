/* Ryuhai - shared rules engine (runs in Node and in the browser) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // count      = copies each player starts with
  // singleUse  = the piece is spent after winning a round (only the Dragon)
  const PIECES = {
    dragon:  { name: 'Dragon',  icon: '\u{1F409}', count: 1, singleUse: true,  blurb: 'Beats every piece. One use per game.' },
    monarch: { name: 'Monarch', icon: '\u{1F451}', count: 1, singleUse: false, blurb: 'Beats Knight, Wizard, Knave, Fool. You lose only when your last Monarch falls.' },
    knight:  { name: 'Knight',  icon: '\u{1F6E1}\uFE0F', count: 1, singleUse: false, blurb: 'Beats Wizard, Knave, Fool, Empress.' },
    wizard:  { name: 'Wizard',  icon: '\u{1F9D9}', count: 2, singleUse: false,  blurb: 'Beats Knave, Fool, Empress. You hold two.' },
    knave:   { name: 'Knave',   icon: '\u{1F5E1}\uFE0F', count: 2, singleUse: false,  blurb: 'Beats Fool, Empress. You hold two.' },
    fool:    { name: 'Fool',    icon: '\u{1F921}', count: 2, singleUse: false,  blurb: 'Beats only the Empress. You hold two.' },
    empress: { name: 'Empress', icon: '\u{1F478}', count: 1, singleUse: false, blurb: 'Beats only the Monarch.' },
    joker:   { name: 'Joker',   icon: '\u{1F0CF}', count: 1, singleUse: false, blurb: 'Becomes the piece it meets; both return to hand.' }
  };
  const ORDER = ['dragon', 'monarch', 'knight', 'wizard', 'knave', 'fool', 'empress', 'joker'];

  const BEATS = {
    dragon:  ['monarch', 'knight', 'wizard', 'knave', 'fool', 'empress'],
    monarch: ['knight', 'wizard', 'knave', 'fool'],
    knight:  ['wizard', 'knave', 'fool', 'empress'],
    wizard:  ['knave', 'fool', 'empress'],
    knave:   ['fool', 'empress'],
    fool:    ['empress'],
    empress: ['monarch'],
    joker:   []
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Any piece currently of type Monarch counts, including a Joker that has become one.
  const isMonarch = (p) => p.type === 'monarch';
  const beats = (a, b) => BEATS[a].indexOf(b) !== -1;

  function newHand(seat) {
    const hand = [];
    ORDER.forEach((type) => {
      for (let i = 0; i < PIECES[type].count; i++) {
        hand.push({ id: seat + '-' + type + '-' + i, type: type, royal: type === 'monarch' });
      }
    });
    return hand;
  }

  function createGame() {
    return { hands: [newHand(0), newHand(1)], round: 0, idle: 0, over: false, winner: null, end: null, history: [] };
  }

  function lossReason(s, seat, royalLost) {
    const mine = s.hands[seat];
    // Losing one Monarch is not fatal while any other Monarch (including a transformed Joker) remains.
    if (royalLost[seat] && !mine.some(isMonarch)) return 'monarch';
    if (!mine.length) return 'no_pieces';
    return null;
  }

  // Resolve one round. Returns a NEW state; the input is not modified.
  function play(state, idA, idB) {
    if (state.over) throw new Error('Game is over');
    const s = clone(state);
    const a = s.hands[0].find((p) => p.id === idA);
    const b = s.hands[1].find((p) => p.id === idB);
    if (!a || !b) throw new Error('Invalid piece');

    const ta = a.type, tb = b.type;
    const log = { round: s.round + 1, types: [ta, tb], outcome: '', destroyed: [], spent: [], became: null };
    const royalLost = [false, false];
    let progress = false;

    const remove = (seat, p) => { s.hands[seat] = s.hands[seat].filter((x) => x !== p); };
    const destroy = (seat, p) => {
      const mon = isMonarch(p);
      if (mon) royalLost[seat] = true;
      log.destroyed.push({ seat: seat, type: p.type, royal: mon, wasJoker: !!p.wasJoker });
      remove(seat, p);
      progress = true;
    };
    const spend = (seat, p) => { log.spent.push({ seat: seat, type: p.type }); remove(seat, p); };

    if (ta === 'joker' && tb === 'joker') {
      log.outcome = 'jokerclash';
    } else if (ta === 'joker') {
      a.type = tb; a.wasJoker = true;
      log.outcome = 'joker0'; log.became = { seat: 0, type: tb }; progress = true;
    } else if (tb === 'joker') {
      b.type = ta; b.wasJoker = true;
      log.outcome = 'joker1'; log.became = { seat: 1, type: ta }; progress = true;
    } else if (ta === tb) {
      log.outcome = 'tie';
      destroy(0, a); destroy(1, b);
    } else if (beats(ta, tb)) {
      log.outcome = 'win0';
      destroy(1, b);
      if (PIECES[ta].singleUse) spend(0, a);
    } else {
      log.outcome = 'win1';
      destroy(0, a);
      if (PIECES[tb].singleUse) spend(1, b);
    }

    s.round += 1;
    s.idle = progress ? 0 : s.idle + 1;
    s.history.push(log);

    // Losing the final Monarch (of any origin) is decisive, unless both players lose their final
    // Monarch in the same round. Losing one of multiple Monarchs is not game-ending.
    const finalRoyalLost = [0, 1].map((seat) =>
      royalLost[seat] && !s.hands[seat].some(isMonarch)
    );
    let l0, l1;
    if (finalRoyalLost[0] !== finalRoyalLost[1]) {
      l0 = finalRoyalLost[0] ? 'monarch' : null;
      l1 = finalRoyalLost[1] ? 'monarch' : null;
    } else {
      l0 = lossReason(s, 0, royalLost);
      l1 = lossReason(s, 1, royalLost);
    }
    if (l0 && l1) {
      s.over = true; s.winner = 'draw'; s.end = { code: 'mutual', reasons: [l0, l1] };
    } else if (l0) {
      s.over = true; s.winner = 1; s.end = { code: l0, loser: 0 };
    } else if (l1) {
      s.over = true; s.winner = 0; s.end = { code: l1, loser: 1 };
    }
    return s;
  }

  function describeRound(log, names) {
    const A = names[0], B = names[1];
    const na = PIECES[log.types[0]].name, nb = PIECES[log.types[1]].name;
    let t;
    switch (log.outcome) {
      case 'win0': t = A + "'s " + na + ' defeats ' + B + "'s " + nb + '.'; break;
      case 'win1': t = B + "'s " + nb + ' defeats ' + A + "'s " + na + '.'; break;
      case 'tie': t = 'Two ' + na + 's meet and destroy each other.'; break;
      case 'joker0': t = A + "'s Joker becomes a " + nb + '! Both pieces return to hand.'; break;
      case 'joker1': t = B + "'s Joker becomes a " + na + '! Both pieces return to hand.'; break;
      default: t = 'Joker meets Joker. Both return to hand.';
    }
    if (log.destroyed.some((d) => d.royal)) t += ' A Monarch has fallen!';
    return t;
  }

  function endText(end, names) {
    if (!end) return '';
    switch (end.code) {
      case 'monarch': return names[end.loser] + "'s Monarch has been taken.";
      case 'no_pieces': return names[end.loser] + ' has no pieces left.';
      default: return 'Both sides fell at the same moment.';
    }
  }

  // What one seat is allowed to see: its own hand, the opponent's piece COUNT, and the public history.
  // The opponent's hand and current pick are never sent.
  function viewFor(state, seat, locked) {
    return {
      seat: seat,
      round: state.round,
      over: state.over,
      winner: state.winner,
      end: state.end,
      you: state.hands[seat],
      locked: { you: !!locked[seat], opp: !!locked[1 - seat] },
      last: state.history.length ? state.history[state.history.length - 1] : null,
      history: state.history
    };
  }

  // What anyone can know about a player's hand: the starting set, minus every piece publicly destroyed or
  // spent, with Jokers that transformed counted as the piece they became. Returns { counts, royal } where
  // royal is 1 while that player holds at least one Monarch (a Joker that became a Monarch counts).
  function trackHand(history, seat) {
    const counts = {};
    ORDER.forEach((t) => { counts[t] = PIECES[t].count; });
    history.forEach((log) => {
      if (log.became && log.became.seat === seat) { if (counts.joker > 0) counts.joker--; counts[log.became.type]++; }
      log.destroyed.forEach((d) => { if (d.seat === seat) { if (counts[d.type] > 0) counts[d.type]--; } });
      log.spent.forEach((sp) => { if (sp.seat === seat && counts[sp.type] > 0) counts[sp.type]--; });
    });
    return { counts: counts, royal: counts.monarch > 0 ? 1 : 0 };
  }
  function estimateOpponent(history, oppSeat) { return trackHand(history, oppSeat).counts; }

  // ---------------------------------------------------------------------------------------------
  // Bot. It only ever uses PUBLIC information: its own hand, the pieces it has seen destroyed or
  // spent, and what the opponent revealed in earlier rounds. It never reads the opponent's hand or
  // their locked-in pick.
  //
  // 1. estimateOpponent: which piece types the opponent can still have.
  // 2. predictOpponent:  how likely each of those is to be played next, learned from their habits:
  //      - how often they play each piece (recent rounds count more),
  //      - what they tend to play after the piece they just played,
  //      - whether they stay with a piece after winning / switch after losing.
  // 3. botPick:          scores each of its own pieces against that prediction and picks, with a
  //                      little randomness so it cannot be read perfectly.
  //
  // Levels: easy (no habit learning, often random), normal (learns slowly), hard (learns fast,
  // picks the best option almost every time but avoids being predictable itself).
  // ---------------------------------------------------------------------------------------------
  const BOT_LEVELS = {
    // learn: how strongly habits are used (prior = pseudo-rounds of "no idea" before the data counts)
    // temp: how close to the best-looking piece it sticks (lower = sharper); mix: share of the unexploitable
    // equilibrium strategy (hard only); explore: share of purely random picks
    easy:   { learn: 0, prior: 1,   temp: 1.8, mix: 0,   explore: 0.3, exploit: 0 },
    normal: { learn: 1, prior: 4,   temp: 0.7, mix: 0,   explore: 0,   exploit: 1 },
    random: { pure: 1, learn: 0, prior: 1, temp: 1, mix: 0, explore: 0, exploit: 0 },
    hard:   { learn: 1, prior: 1.2, temp: 0.6, mix: 1,   explore: 0,   exploit: 0.35, qtemp: 1.2 }
  };
  const DECAY = 0.88; // a round one step older counts 12% less

  function resultFor(log, seat) {
    if (log.outcome === 'win' + seat) return 'won';
    if (log.outcome === 'win' + (1 - seat)) return 'lost';
    return 'other';
  }

  // Probability that the opponent plays each type next. Returns { type: p } over types they may still hold.
  function predictOpponent(history, oppSeat, est, level) {
    const lv = BOT_LEVELS[level] || BOT_LEVELS.normal;
    const avail = ORDER.filter((t) => est[t] > 0);
    const out = {};
    if (!avail.length) return out;
    // Before anything is known, assume the Monarch is played less often than other pieces: it is the piece that loses the game.
    const pw = {}; let pt = 0;
    avail.forEach((t) => { pw[t] = t === 'monarch' ? 0.35 : 1; pt += pw[t]; });
    avail.forEach((t) => { out[t] = pw[t] / pt; });
    if (!lv.learn || !history.length) return out;

    const n = history.length;
    const plays = history.map((l) => l.types[oppSeat]);
    const age = (i) => Math.pow(DECAY, n - 1 - i);           // newest round has weight 1

    // (a) how often each piece has been played
    const freq = {}; let ft = 0;
    avail.forEach((t) => { freq[t] = 0; });
    plays.forEach((t, i) => { if (freq[t] !== undefined) { freq[t] += age(i); ft += age(i); } });
    let dist = {};
    avail.forEach((t) => { dist[t] = (lv.prior * out[t] + freq[t]) / (lv.prior + ft); });

    // (b) what they play after the piece they played last
    const last = plays[n - 1];
    const trans = {}; let tt = 0;
    avail.forEach((t) => { trans[t] = 0; });
    for (let i = 1; i < n; i++) {
      if (plays[i - 1] === last && trans[plays[i]] !== undefined) { trans[plays[i]] += age(i); tt += age(i); }
    }
    if (tt > 0) {
      const lam = tt / (tt + 2.5);
      avail.forEach((t) => { dist[t] = (1 - lam) * dist[t] + lam * (trans[t] / tt); });
    }

    // (c) do they stay with the same piece after this kind of result?
    const res = resultFor(history[n - 1], oppSeat);
    let stay = 0, tot = 0;
    for (let i = 1; i < n; i++) {
      if (resultFor(history[i - 1], oppSeat) === res) { tot += age(i); if (plays[i] === plays[i - 1]) stay += age(i); }
    }
    if (tot > 0 && dist[last] !== undefined && dist[last] < 1) {
      const base = dist[last];
      const sRate = (stay + 1.5 * base) / (tot + 1.5);
      const rest = 1 - base;
      avail.forEach((t) => { dist[t] = t === last ? sRate : (rest > 0 ? (1 - sRate) * dist[t] / rest : 0); });
    }

    let sum = 0; avail.forEach((t) => { sum += dist[t]; });
    avail.forEach((t) => { out[t] = dist[t] / sum; });
    return out;
  }

  // ---- scoring a possible round ----
  // How much each piece is worth to hold. The Monarch is scored separately (losing it loses the game).
  const HOLD = { dragon: 4, monarch: 2, knight: 3.2, wizard: 2.6, knave: 2, fool: 1, empress: 2.2, joker: 4 };
  const GAME = 40;   // value of winning (or losing) the game outright

  const KILL = 7;    // holding a Monarch-killer (Dragon or Empress) while the other side still has its Monarch
  function material(h, enemyRoyal) {
    let v = 0; ORDER.forEach((t) => { v += HOLD[t] * h.counts[t]; });
    if (enemyRoyal && (h.counts.dragon > 0 || h.counts.empress > 0)) v += KILL;
    return v;
  }
  const cloneHand = (h) => ({ counts: Object.assign({}, h.counts), royal: h.royal });
  const refresh = (h) => { h.royal = h.counts.monarch > 0 ? 1 : 0; return h; };

  // Payoff, for the player holding `me`, of playing type p against type q (positive is good for me).
  function roundPayoff(me, opp, p, q) {
    const m = cloneHand(me), o = cloneHand(opp);
    const before = material(me, opp.royal) - material(opp, me.royal);
    // A side is on its last Monarch when exactly one remains: losing it ends the game for that side.
    const meLast = me.counts.monarch <= 1, oppLast = opp.counts.monarch <= 1;
    if (p === 'joker' && q === 'joker') return 0;
    if (p === 'joker') { m.counts.joker--; m.counts[q]++; }
    else if (q === 'joker') { o.counts.joker--; o.counts[p]++; }
    else if (p === q) {
      m.counts[p]--; o.counts[q]--;
      if (p === 'monarch') {
        if (meLast && oppLast) return 0;                                  // both last Monarchs fall: a draw
        if (meLast) return -GAME;
        if (oppLast) return GAME;
      }
    } else if (beats(p, q)) {
      if (q === 'monarch' && oppLast) return GAME;                        // the last Monarch is taken
      o.counts[q]--; if (p === 'dragon') m.counts.dragon--;
    } else {
      if (p === 'monarch' && meLast) return -GAME;
      m.counts[p]--; if (q === 'dragon') o.counts.dragon--;
    }
    refresh(m); refresh(o);
    return (material(m, o.royal) - material(o, m.royal)) - before;
  }

  function payoffMatrix(me, opp, rows, cols) { return rows.map((p) => cols.map((q) => roundPayoff(me, opp, p, q))); }

  // Unexploitable mix for a zero-sum matrix game (regret matching; the averaged strategy approaches the equilibrium).
  function solveMix(A, iters) {
    const m = A.length, n = A[0].length;
    const rr = new Array(m).fill(0), cr = new Array(n).fill(0), rs = new Array(m).fill(0);
    const pos = (r) => { let t = 0; const w = r.map((x) => { const v = x > 0 ? x : 0; t += v; return v; }); return t > 0 ? w.map((x) => x / t) : r.map(() => 1 / r.length); };
    for (let it = 0; it < iters; it++) {
      const x = pos(rr), y = pos(cr);
      for (let i = 0; i < m; i++) rs[i] += x[i];
      const rv = A.map((row) => row.reduce((acc, a, j) => acc + a * y[j], 0));
      let ev = 0; for (let i = 0; i < m; i++) ev += x[i] * rv[i];
      for (let i = 0; i < m; i++) rr[i] += rv[i] - ev;
      const cv = new Array(n).fill(0);
      for (let j = 0; j < n; j++) { for (let i = 0; i < m; i++) cv[j] -= A[i][j] * x[i]; }
      let cev = 0; for (let j = 0; j < n; j++) cev += y[j] * cv[j];
      for (let j = 0; j < n; j++) cr[j] += cv[j] - cev;
    }
    const tot = rs.reduce((a, b) => a + b, 0) || 1;
    return rs.map((x) => x / tot);
  }

  // Quantal-response equilibrium: both sides pick better pieces more often but never exclusively, so every
  // sensible piece keeps real probability (an exact equilibrium of this heuristic table is nearly one piece).
  function solveQuantal(A, temp, iters) {
    const m = A.length, n = A[0].length;
    let x = new Array(m).fill(1 / m), y = new Array(n).fill(1 / n);
    for (let it = 0; it < iters; it++) {
      const ev = A.map((row) => row.reduce((a, v, j) => a + v * y[j], 0));
      const cv = new Array(n).fill(0);
      for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) cv[j] -= A[i][j] * x[i];
      const nx = softmax(ev, temp), ny = softmax(cv, temp);
      x = x.map((v, i) => 0.7 * v + 0.3 * nx[i]); y = y.map((v, j) => 0.7 * v + 0.3 * ny[j]);
    }
    return x;
  }

  function softmax(scores, temp) {
    const top = Math.max.apply(null, scores);
    const w = scores.map((s) => Math.exp((s - top) / temp));
    const t = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / t);
  }

  function botPick(state, seat, rng, level) {
    rng = rng || Math.random;
    const lv = BOT_LEVELS[level] || BOT_LEVELS.normal;
    const mine = state.hands[seat];
    if (lv.pure) {
      // Purely random, except it never plays a piece that is certain to lose against everything the opponent
      // can still have (their hand is worked out from what has been revealed, including Jokers that transformed).
      const opp = trackHand(state.history, 1 - seat);
      const left = ORDER.filter((t) => opp.counts[t] > 0);
      const types = ORDER.filter((t) => mine.some((x) => x.type === t));
      let ok = left.length ? types.filter((t) => t === 'joker' || !left.every((q) => beats(q, t))) : types;
      if (!ok.length) ok = types;
      const pick = ok[Math.floor(rng() * ok.length)];
      const own = mine.filter((x) => x.type === pick);
      return own[Math.floor(rng() * own.length)].id;
    }
    if (lv.explore && rng() < lv.explore) return mine[Math.floor(rng() * mine.length)].id;

    // What is publicly known: my own hand exactly, the opponent's hand from what has been revealed.
    const me = { counts: {}, royal: 0 };
    ORDER.forEach((t) => { me.counts[t] = 0; });
    mine.forEach((x) => { me.counts[x.type]++; });
    me.royal = me.counts.monarch > 0 ? 1 : 0;
    let opp = trackHand(state.history, 1 - seat);
    if (!ORDER.some((t) => opp.counts[t] > 0)) opp = { counts: Object.assign({}, opp.counts, { joker: 1 }), royal: 0 };

    const rows = ORDER.filter((t) => me.counts[t] > 0);
    const cols = ORDER.filter((t) => opp.counts[t] > 0);
    const A = payoffMatrix(me, opp, rows, cols);

    // Best reply to what this opponent's habits suggest (easy: assumes they pick anything with equal chance).
    const prob = predictOpponent(state.history, 1 - seat, opp.counts, level);
    const expect = A.map((row) => row.reduce((acc, a, j) => acc + a * (prob[cols[j]] || 0), 0));
    const reply = softmax(expect.map((v, i) => v - (PIECES[rows[i]].singleUse ? 0.1 : 0)), lv.temp);

    let dist;
    if (lv.mix) {
      const safe = solveQuantal(A, lv.qtemp || 1.2, 200);
      const k = lv.exploit * Math.min(1, state.history.length / 10);   // trust the habit reading more as rounds pass
      dist = safe.map((x, i) => (1 - k) * x + k * reply[i]);
    } else dist = reply;
    if (lv.mix && rows.length > 1 && state.history.length) {   // don't fall into a rhythm: lean away from the piece just played
      const li = rows.indexOf(state.history[state.history.length - 1].types[seat]);
      if (li >= 0) { dist = dist.slice(); dist[li] *= 0.6; const t = dist.reduce((a, b) => a + b, 0); dist = dist.map((v) => v / t); }
    }

    let r = rng(), type = rows[rows.length - 1];
    for (let i = 0; i < rows.length; i++) { r -= dist[i]; if (r <= 0) { type = rows[i]; break; } }
    // Any piece of the chosen type will do; every Monarch is equal.
    return mine.filter((x) => x.type === type)[0].id;
  }

  return { PIECES, ORDER, BEATS, beats, newHand, createGame, play, describeRound, endText, viewFor, botPick, predictOpponent, estimateOpponent, trackHand, BOT_LEVELS };
});
