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
    // Losing one Monarch is not fatal if another true Monarch remains in hand.
    if (royalLost[seat] && !mine.some((p) => p.royal)) return 'monarch';
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
      if (p.royal) royalLost[seat] = true;
      log.destroyed.push({ seat: seat, type: p.type, royal: !!p.royal, wasJoker: !!p.wasJoker });
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

    // Losing the final true Monarch is decisive, unless both players lose their final
    // Monarch in the same round. Losing one of multiple Monarchs is not game-ending.
    const finalRoyalLost = [0, 1].map((seat) =>
      royalLost[seat] && !s.hands[seat].some((p) => p.royal)
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
    if (log.destroyed.some((d) => d.royal)) t += ' The Monarch has fallen!';
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

  // What a player can know about the opponent's pieces: the starting set minus everything
  // publicly destroyed or spent. Jokers that already transformed are tracked as jokers.
  function estimateOpponent(history, oppSeat) {
    const c = {};
    ORDER.forEach((t) => { c[t] = PIECES[t].count; });
    history.forEach((log) => {
      log.destroyed.forEach((d) => { if (d.seat === oppSeat) { const t = d.wasJoker ? 'joker' : d.type; if (c[t] > 0) c[t]--; } });
      log.spent.forEach((sp) => { if (sp.seat === oppSeat && c[sp.type] > 0) c[sp.type]--; });
    });
    return c;
  }

  // Simple bot: uses only public information, then picks with noise.
  function botPick(state, seat, rng) {
    rng = rng || Math.random;
    const mine = state.hands[seat];
    const est = estimateOpponent(state.history, 1 - seat);
    const theirs = [];
    ORDER.forEach((t) => { for (let i = 0; i < est[t]; i++) theirs.push({ type: t, royal: t === 'monarch' }); });
    if (!theirs.length) theirs.push({ type: 'joker', royal: false });
    const value = (p, q) => {
      if (p.type === 'joker') return q.type === 'joker' ? 0 : 0.3 + (q.type === 'dragon' ? 0.6 : q.type === 'monarch' ? 0.3 : 0);
      if (q.type === 'joker') return 0;
      if (p.type === q.type) return p.royal ? -3 : -0.3;
      if (beats(p.type, q.type)) return 1 + (q.royal ? 3 : 0);
      return p.royal ? -3 : -1;
    };
    const scores = mine.map((p) => {
      let s = 0;
      theirs.forEach((q) => { s += value(p, q); });
      s = s / theirs.length;
      if (PIECES[p.type].singleUse) s -= 0.1;
      return s;
    });
    const weights = scores.map((s) => Math.exp(s / 0.6));
    const total = weights.reduce((x, y) => x + y, 0);
    let r = rng() * total;
    for (let i = 0; i < mine.length; i++) { r -= weights[i]; if (r <= 0) return mine[i].id; }
    return mine[mine.length - 1].id;
  }

  return { PIECES, ORDER, BEATS, beats, createGame, play, describeRound, endText, viewFor, botPick, estimateOpponent };
});
