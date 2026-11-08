/* Ryuhai - multiplayer rules (2 to 6 players). Runs in Node and in the browser.
 *
 * Every round each living player secretly picks ONE piece. All picks are then revealed and the piece of
 * every player clashes with the piece of EVERY other living player (a separate 1v1 clash per pair), all at
 * once, judged only from the revealed picks. Nobody's elimination cancels a clash.
 *
 *   - A piece that loses (or ties) any clash is destroyed, even if it won another one.
 *   - A piece that wins or draws every clash returns to hand. Only the Dragon is spent, after winning.
 *   - Joker: its owner chooses, together with the pick and before anything is revealed, which player's piece
 *     it copies. It becomes that piece for good. It draws against the player it copied (both return) and
 *     fights everyone else as the copied piece. If it copies a Joker it stays a Joker this round (Jokers
 *     cannot be destroyed before they transform) and draws every clash.
 *   - A player is out when their last Monarch (a Joker that became a Monarch counts) is destroyed, or they
 *     have no pieces. Everyone who falls in the same round shares a place. Last one standing wins; if the
 *     last players fall together they all share first place (a draw).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.HCM = factory(root.HC);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const PIECES = E.PIECES, ORDER = E.ORDER, beats = E.beats;
  const MIN_PLAYERS = 2, MAX_PLAYERS = 6;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function createGame(n) {
    n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.trunc(n) || 0));
    const players = [];
    for (let i = 0; i < n; i++) players.push({ hand: E.newHand(i), alive: true, place: null });
    return { n: n, players: players, round: 0, over: false, winners: [], history: [] };
  }

  const aliveSeats = (s) => s.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);

  // Is this a legal pick for `seat`? pick = { id, copy }. Returns an error text or '' when fine.
  function checkPick(s, seat, pick) {
    if (s.over) return 'The game is over.';
    const pl = s.players[seat];
    if (!pl || !pl.alive) return 'You are out of this game.';
    if (!pick || typeof pick.id !== 'string') return 'Pick a piece.';
    const p = pl.hand.find((x) => x.id === pick.id);
    if (!p) return 'You cannot play that piece.';
    if (p.type === 'joker') {
      const c = pick.copy;
      if (!Number.isInteger(c) || c === seat || !s.players[c] || !s.players[c].alive) return 'Choose which player\'s piece the Joker copies.';
    }
    return '';
  }

  // Resolve one round. `picks` is an array indexed by seat: { id, copy } for every living player.
  // Returns a NEW state; the input is not modified.
  function play(state, picks) {
    if (state.over) throw new Error('Game is over');
    const s = clone(state);
    const live = aliveSeats(s);
    const info = {};
    live.forEach((i) => {
      const err = checkPick(s, i, picks[i]);
      if (err) throw new Error('Seat ' + i + ': ' + err);
      const piece = s.players[i].hand.find((x) => x.id === picks[i].id);
      info[i] = { piece: piece, raw: piece.type, eff: piece.type, copy: picks[i].copy, lost: false, won: false, drew: false };
    });
    // Jokers transform into the piece they chose to copy (unless that piece is a Joker too).
    live.forEach((i) => {
      const x = info[i];
      if (x.raw !== 'joker') return;
      const target = info[x.copy];
      x.eff = target.raw === 'joker' ? 'joker' : target.raw;
    });

    const clashes = [];
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        const i = live[a], j = live[b], A = info[i], B = info[j];
        let r;   // 'a' = i wins, 'b' = j wins, 'tie' = both destroyed, 'draw' = both return
        const copied = (A.raw === 'joker' && A.copy === j) || (B.raw === 'joker' && B.copy === i);
        if (copied || A.eff === 'joker' || B.eff === 'joker') r = 'draw';
        else if (A.eff === B.eff) r = 'tie';
        else if (beats(A.eff, B.eff)) r = 'a';
        else r = 'b';
        if (r === 'a') { A.won = true; B.lost = true; }
        else if (r === 'b') { B.won = true; A.lost = true; }
        else if (r === 'tie') { A.lost = true; B.lost = true; }
        else { A.drew = true; B.drew = true; }
        clashes.push({ a: i, b: j, result: r });
      }
    }

    const log = { round: s.round + 1, picks: [], clashes: clashes, destroyed: [], spent: [], became: [], eliminated: [] };
    const royalLost = {};
    live.forEach((i) => {
      const x = info[i], hand = s.players[i].hand;
      log.picks.push({ seat: i, type: x.raw, as: x.eff, copy: x.raw === 'joker' ? x.copy : null });
      if (x.raw === 'joker' && x.eff !== 'joker') { x.piece.type = x.eff; x.piece.wasJoker = true; log.became.push({ seat: i, type: x.eff, from: x.copy }); }
      if (x.lost) {
        const mon = x.piece.type === 'monarch';
        if (mon) royalLost[i] = true;
        log.destroyed.push({ seat: i, type: x.piece.type, royal: mon, wasJoker: !!x.piece.wasJoker });
        s.players[i].hand = hand.filter((p) => p !== x.piece);
      } else if (x.won && PIECES[x.piece.type].singleUse) {
        log.spent.push({ seat: i, type: x.piece.type });
        s.players[i].hand = hand.filter((p) => p !== x.piece);
      }
    });

    // Eliminations are simultaneous.
    const out = live.filter((i) => {
      const hand = s.players[i].hand;
      return (royalLost[i] && !hand.some((p) => p.type === 'monarch')) || !hand.length;
    });
    const aliveAfter = live.length - out.length;
    out.forEach((i) => { s.players[i].alive = false; s.players[i].place = aliveAfter === 0 ? 1 : aliveAfter + 1; log.eliminated.push(i); });
    if (aliveAfter <= 1) {
      s.over = true;
      if (aliveAfter === 1) { const w = aliveSeats(s)[0]; s.players[w].place = 1; s.winners = [w]; }
      else s.winners = out.slice();
    }
    s.round += 1;
    s.history.push(log);
    return s;
  }

  // ---------- text ----------
  function describeRound(log, names) {
    const bits = [];
    log.picks.forEach((p) => {
      if (p.copy != null) {
        bits.push(p.as === 'joker' ? names[p.seat] + "'s Joker copies a Joker and stays a Joker."
          : names[p.seat] + "'s Joker copies " + names[p.copy] + "'s piece and becomes a " + PIECES[p.as].name + '.');
      }
    });
    const dead = log.destroyed.map((d) => names[d.seat] + "'s " + PIECES[d.type].name);
    if (dead.length) bits.push(dead.join(', ') + (dead.length === 1 ? ' is destroyed.' : ' are destroyed.'));
    else bits.push('Nobody loses a piece.');
    if (log.destroyed.some((d) => d.royal)) bits.push('A Monarch has fallen!');
    if (log.eliminated.length) bits.push(log.eliminated.map((i) => names[i]).join(' and ') + (log.eliminated.length === 1 ? ' is out!' : ' are out!'));
    return bits.join(' ');
  }

  function endText(s, names) {
    if (!s.over) return '';
    if (s.winners.length === 1) return names[s.winners[0]] + ' is the last one standing!';
    return s.winners.map((i) => names[i]).join(' and ') + ' fell at the same moment. It is a draw.';
  }

  // Finishing place of every player, 1 = best. Ties share a place.
  function placings(s) { return s.players.map((p) => p.place); }

  // ---------- what a player may see ----------
  // Own hand, who is still in, who has locked, and the public history (which already reveals every pick after
  // each round). Other players' hands and current picks are never included.
  function viewFor(s, seat, locked) {
    return {
      seat: seat, n: s.n, round: s.round, over: s.over, winners: s.winners,
      you: s.players[seat].hand,
      alive: s.players.map((p) => p.alive),
      places: placings(s),
      locked: s.players.map((p, i) => !!(locked && locked[i])),
      last: s.history.length ? s.history[s.history.length - 1] : null,
      history: s.history
    };
  }

  // What anyone can work out about a player's hand from the public history.
  function trackHand(history, seat) {
    const counts = {};
    ORDER.forEach((t) => { counts[t] = PIECES[t].count; });
    history.forEach((log) => {
      log.became.forEach((b) => { if (b.seat === seat) { if (counts.joker > 0) counts.joker--; counts[b.type]++; } });
      log.destroyed.forEach((d) => { if (d.seat === seat && counts[d.type] > 0) counts[d.type]--; });
      log.spent.forEach((sp) => { if (sp.seat === seat && counts[sp.type] > 0) counts[sp.type]--; });
    });
    return counts;
  }

  // ---------- bots (only use public information, like the 2-player bot) ----------
  const HOLD = { dragon: 4, monarch: 2, knight: 3.2, wizard: 2.6, knave: 2, fool: 1, empress: 2.2, joker: 4 };
  const BOT_LEVELS = { random: { pure: 1 }, smart: { temp: 0.8 } };

  // Can this opponent still play something that destroys (or ties) a piece of type `t`?
  function allDestroy(t, counts) {
    const left = ORDER.filter((q) => counts[q] > 0);
    return left.length > 0 && left.every((q) => beats(q, t) || q === t);
  }

  function softmax(scores, temp) {
    const top = Math.max.apply(null, scores);
    const w = scores.map((x) => Math.exp((x - top) / temp));
    const tot = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / tot);
  }

  function botPick(state, seat, rng, level) {
    rng = rng || Math.random;
    const lv = BOT_LEVELS[level] || BOT_LEVELS.smart;
    const hand = state.players[seat].hand;
    const foes = aliveSeats(state).filter((i) => i !== seat);
    const known = {};
    foes.forEach((j) => { known[j] = trackHand(state.history, j); });
    const types = ORDER.filter((t) => hand.some((x) => x.type === t));
    const pieceOf = (t) => hand.filter((x) => x.type === t)[Math.floor(rng() * hand.filter((x) => x.type === t).length)];

    // Whom should a Joker copy? The living player who might still hold the strongest piece.
    const strongest = (j) => { let best = 0; ORDER.forEach((q) => { if (q !== 'joker' && known[j][q] > 0) best = Math.max(best, HOLD[q]); }); return best; };
    const copyTarget = () => {
      if (lv.pure) return foes[Math.floor(rng() * foes.length)];
      let best = foes[0], bs = -1;
      foes.forEach((j) => { const v = strongest(j) + rng() * 0.5; if (v > bs) { bs = v; best = j; } });
      return best;
    };
    const finish = (t) => { const p = pieceOf(t); return t === 'joker' ? { id: p.id, copy: copyTarget() } : { id: p.id }; };

    if (lv.pure) {
      // Uniformly random, but never a piece that some opponent is certain to destroy.
      let ok = types.filter((t) => t === 'joker' || !foes.some((j) => allDestroy(t, known[j])));
      if (!ok.length) ok = types;
      return finish(ok[Math.floor(rng() * ok.length)]);
    }

    // Smart: chance to come through the round alive, plus what a win is worth, with a heavy fear of
    // losing the last Monarch and a taste for taking an opponent's last Monarch.
    const myMonarchs = hand.filter((x) => x.type === 'monarch').length;
    const score = types.map((t) => {
      if (t === 'joker') return 1.5 + HOLD.joker * 0.15 + rng() * 0.5;
      let surv = 1, gain = 0;
      foes.forEach((j) => {
        const c = known[j];
        const tot = ORDER.reduce((a, q) => a + c[q], 0) || 1;
        let pLose = 0, pWin = 0;
        ORDER.forEach((q) => {
          const w = c[q] / tot;
          if (q === 'joker') return;
          if (q === t || beats(q, t)) pLose += w;
          else if (beats(t, q)) { pWin += w; gain += w * (q === 'monarch' && c.monarch === 1 ? 6 : HOLD[q] * 0.5); }
        });
        surv *= 1 - pLose;
      });
      const loss = t === 'monarch' && myMonarchs === 1 ? 40 : HOLD[t] * 2;
      // The Dragon is a one-shot trump: keep it back while the table is crowded (several players may throw
      // theirs at once and destroy each other), and spend it when few opponents are left.
      const reserve = PIECES[t].singleUse ? 1 + 1.6 * Math.max(0, foes.length - 1) : 0;
      return surv * HOLD[t] * 0.5 + gain - (1 - surv) * loss - reserve;
    });
    const dist = softmax(score, lv.temp);
    let r = rng(), pick = types[types.length - 1];
    for (let i = 0; i < types.length; i++) { r -= dist[i]; if (r <= 0) { pick = types[i]; break; } }
    return finish(pick);
  }

  return { MIN_PLAYERS, MAX_PLAYERS, createGame, aliveSeats, checkPick, play, describeRound, endText, placings, viewFor, trackHand, botPick, BOT_LEVELS };
});
