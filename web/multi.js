/* Ryuhai - multiplayer client (2 to 6 players). Talks to the "m*" messages of server/multi.js.
 * The 2-player game in app.js is untouched; this file only borrows a few helpers through window.__hcApp. */
(function () {
  'use strict';
  var A = window.__hcApp, M = window.HCM, E = window.HC, ART = window.HCArt;
  if (!A || !M) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = A.el, show = A.show, store = A.store;

  var MASCOT = ['dragon', 'monarch', 'knight', 'wizard', 'empress', 'knave'];   // each seat gets a face
  var st = { active: false, msg: null, sel: null, copy: null, key: '', endFor: 0, timer: null, tick: null };

  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function faceOf(m, seat) {
    var type = MASCOT[seat % MASCOT.length], sk = (m.skins && m.skins[seat]) || {};
    var d = el('span', 'av'); d.style.setProperty('--c', ART.color(type)); d.innerHTML = ART.face(type, sk[type]); return d;
  }
  function active() { return st.active; }

  // ---------- network ----------
  function onNet(m) {
    switch (m.type) {
      case 'mrooms': renderRooms(m.rooms); return true;
      case 'mjoined':
        store.sset('hc_mresume', JSON.stringify({ code: m.code, token: m.token }));
        if (!st.active) enter();
        return true;
      case 'mstate': if (st.active) render(m); return true;
      case 'mleft': return true;
      case 'error':
        if (m.multi) {
          if (m.fatal) { reset(); A.home(); }
          $('mJoinMsg').textContent = m.message || '';
          A.toast(m.message || 'Something went wrong.');
          return true;
        }
        return false;
    }
    return false;
  }
  function enter() {
    st.active = true; st.msg = null; st.key = ''; st.endFor = 0; st.sel = null; st.copy = null;
    show('home', false); show('mJoinOverlay', false); show('mgame', false); show('mEnd', false); show('mlobby', true);
  }
  function reset() {
    st.active = false; st.msg = null; clearTimeout(st.timer);
    store.sset('hc_mresume', '');
    ['mlobby', 'mgame', 'mEnd', 'mJoinOverlay', 'historyOverlay'].forEach(function (id) { show(id, false); });
  }
  function leave() { A.netSend({ type: 'mleave' }); reset(); A.home(); }
  function back() {
    if (!st.active) return false;
    if (confirm('Leave this room?')) leave();
    return true;
  }

  // ---------- join sheet ----------
  function renderRooms(list) {
    var box = $('mRooms'); box.innerHTML = '';
    box.hidden = !list || !list.length;
    (list || []).forEach(function (r) {
      var b = el('button', 'btn ghost'); b.type = 'button';
      b.textContent = r.code + ' · ' + r.host + ' · ' + r.count + '/' + r.max;
      b.addEventListener('click', function () { join(r.code); });
      box.appendChild(b);
    });
  }
  function join(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) { $('mJoinMsg').textContent = 'Enter the 4-letter room code.'; return; }
    $('mJoinMsg').textContent = '';
    A.whenOpen(function () { A.netSend({ type: 'mjoin', code: code, name: A.playerName() || 'Player', skins: A.equippedMap() }); });
  }
  function openJoin() {
    $('mJoinMsg').textContent = ''; show('mJoinOverlay', true);
    A.whenOpen(function () { A.netSend({ type: 'mlist' }); });
    clearInterval(st.tick);
    st.tick = setInterval(function () { if ($('mJoinOverlay').hidden) clearInterval(st.tick); else A.netSend({ type: 'mlist' }); }, 4000);
  }

  // ---------- rendering ----------
  function render(m) {
    st.msg = m;
    if (m.phase === 'lobby') {
      show('mgame', false); show('mEnd', false); show('mlobby', true); show('historyOverlay', false);
      st.key = ''; st.endFor = 0;
      return renderLobby(m);
    }
    show('mlobby', false); show('mgame', true); show('home', false);
    renderGame(m);
  }

  function renderLobby(m) {
    var me = m.seat, host = m.host === me;
    $('mLobbyCode').textContent = m.code;
    var humansOnly = m.kinds.every(function (k) { return k === 'human'; });
    $('mLobbyHint').textContent = (host ? 'Share the code ' + m.code + ' with your friends. Add bots to fill empty seats, then start. ' : 'Waiting for ' + m.names[m.host] + ' to start the game. ')
      + (humansOnly && m.names.length >= 2 ? 'Human-only game: bananas and points are paid by finishing place.' : 'Games with bots pay no bananas or points.');
    var box = $('mSeats'); box.innerHTML = '';
    for (var i = 0; i < m.max; i++) {
      if (i >= m.names.length) { var o = el('div', 'mseat open'); o.appendChild(el('span', 'nm', 'Open seat')); box.appendChild(o); continue; }
      var row = el('div', 'mseat' + (i === me ? ' me' : ''));
      row.appendChild(faceOf(m, i));
      row.appendChild(el('span', 'nm', m.names[i] + (i === me ? ' (you)' : '')));
      if (m.kinds[i] === 'bot') row.appendChild(el('span', 'tag bot', 'Bot · ' + (m.levels[i] === 'random' ? 'Random' : 'Smart')));
      else if (i === m.host) row.appendChild(el('span', 'tag', 'Host'));
      if (m.kinds[i] === 'human' && !m.connected[i]) row.appendChild(el('span', 'tag off', 'Offline'));
      if (host && m.kinds[i] === 'bot') {
        var x = el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove bot'); x.dataset.seat = i;
        x.addEventListener('click', function () { A.netSend({ type: 'mrembot', seat: +this.dataset.seat }); });
        row.appendChild(x);
      }
      box.appendChild(row);
    }
    $('mHostBtns').hidden = !host || m.names.length >= m.max;
    var start = $('mStart'); start.hidden = !host; start.disabled = m.names.length < 2;
    start.textContent = m.names.length < 2 ? 'Need at least 2 players' : 'Start game (' + m.names.length + ' players)';
    $('mLobbyNote').textContent = '';
  }

  function idFor(m, type) { var p = m.view.you.filter(function (x) { return x.type === type; })[0]; return p ? p.id : null; }

  function renderGame(m) {
    var v = m.view, me = m.seat, alive = v.alive[me], pick = m.phase === 'pick', result = m.phase === 'result', over = m.phase === 'over';
    var key = v.round + ':' + m.phase;     // a new round or phase clears the highlighted piece
    if (key !== st.key) { st.sel = null; st.copy = null; st.key = key; }
    $('mCode').textContent = m.code;
    $('mRound').textContent = over || result ? v.round : v.round + 1;

    // players strip
    var strip = $('mPlayers'); strip.innerHTML = '';
    m.names.forEach(function (name, i) {
      var out = !v.alive[i];
      var c = el('div', 'mp' + (i === me ? ' me' : '') + (out ? ' out' : '') + (!out && pick && v.locked[i] ? ' locked' : '') + (m.kinds[i] === 'human' && !m.connected[i] ? ' off' : ''));
      c.appendChild(faceOf(m, i));
      var t = el('span', 't'); t.appendChild(el('b', '', name));
      var sub = out ? ordinal(v.places[i]) + ' place' : m.kinds[i] === 'human' && !m.connected[i] ? 'offline' : pick ? (v.locked[i] ? 'locked in' : 'choosing…') : result ? (m.next[i] || m.kinds[i] === 'bot' ? 'ready' : 'reading…') : '';
      t.appendChild(el('small', '', sub + (m.kinds[i] === 'bot' ? ' · bot' : '')));
      c.appendChild(t); strip.appendChild(c);
    });

    var line = $('mYouLine'); line.innerHTML = '';
    var who = el('div', 'who'); who.appendChild(el('span', 'dot me')); who.appendChild(el('b', '', m.names[me] + ' (you)'));
    who.appendChild(el('small', '', alive ? '' : 'out · ' + ordinal(v.places[me]) + ' place')); line.appendChild(who);

    renderArena(m);
    renderHand(m, alive && pick && !v.locked[me]);

    // Joker target chooser
    var needTarget = alive && pick && !v.locked[me] && st.sel === 'joker';
    show('mTarget', needTarget);
    if (needTarget) {
      var tb = $('mTargetBtns'); tb.innerHTML = '';
      m.names.forEach(function (name, i) {
        if (i === me || !v.alive[i]) return;
        var b = el('button', st.copy === i ? 'sel' : ''); b.type = 'button'; b.appendChild(faceOf(m, i)); b.appendChild(el('span', '', name));
        b.addEventListener('click', function () { st.copy = i; renderGame(st.msg); });
        tb.appendChild(b);
      });
    }

    // buttons and info text
    var lock = $('mLock'), next = $('mNext'), info = $('mInfo');
    lock.hidden = !(alive && pick); next.hidden = !(alive && result && !m.next[me]);
    lock.disabled = !(st.sel && (st.sel !== 'joker' || st.copy != null) && !v.locked[me]);
    var lockedCount = v.alive.filter(function (a, i) { return a && v.locked[i]; }).length, aliveCount = v.alive.filter(Boolean).length;
    if (!alive) info.textContent = over ? 'The game is over.' : 'You are out. You finished ' + ordinal(v.places[me]) + '. Keep watching!';
    else if (over) info.textContent = 'The game is over.';
    else if (pick && v.locked[me]) info.textContent = 'Locked in. Waiting for the others (' + lockedCount + '/' + aliveCount + ')';
    else if (pick) info.textContent = st.sel === 'joker' ? (st.copy == null ? 'Choose whose piece the Joker copies' : 'Joker copies ' + m.names[st.copy]) : st.sel ? E.PIECES[st.sel].name + ' selected' : 'Select a piece';
    else if (result && m.next[me]) info.textContent = 'Waiting for the others to press Next turn';
    else info.textContent = 'Read the result, then press Next turn';

    if (over && st.endFor !== m.gid) { st.endFor = m.gid; clearTimeout(st.timer); st.timer = setTimeout(function () { if (st.active && st.msg && st.msg.phase === 'over') showEnd(st.msg); }, 2200); }
    else if (!over) show('mEnd', false);
  }

  function renderHand(m, enabled) {
    var v = m.view, box = $('mHand'); box.innerHTML = '';
    box.hidden = !v.alive[m.seat];
    var g = {}; v.you.forEach(function (p) { g[p.type] = (g[p.type] || 0) + 1; });
    var mine = (m.skins && m.skins[m.seat]) || {};
    E.ORDER.forEach(function (t) {
      var n = g[t] || 0;
      var b = el('button', 'card' + (n ? '' : ' gone') + (!enabled && n ? ' locked' : '') + (st.sel === t && n ? ' sel' : ''));
      b.type = 'button'; b.dataset.t = t; b.style.setProperty('--c', ART.color(t));
      b.setAttribute('aria-label', E.PIECES[t].name + (n ? ' x' + n : ' (used)'));
      var pic = el('div', 'pic'); pic.innerHTML = ART.portrait(t, mine[t]); b.appendChild(pic);
      if (n > 1) b.appendChild(el('span', 'n', '×' + n));
      b.appendChild(el('span', 'nm', E.PIECES[t].name));
      if (n && enabled) b.addEventListener('click', function () { st.sel = t; if (t !== 'joker') st.copy = null; renderGame(st.msg); });
      box.appendChild(b);
    });
  }

  function renderArena(m) {
    var v = m.view, idle = $('mIdle'), rev = $('mReveal');
    var showResult = (m.phase === 'result' || m.phase === 'over') && v.last;
    idle.hidden = !!showResult; rev.hidden = !showResult;
    if (!showResult) {
      idle.innerHTML = '';
      idle.appendChild(el('b', '', 'Round ' + (v.round + 1)));
      idle.appendChild(document.createTextNode(v.alive[m.seat] ? 'Pick a piece in secret. Every piece fights every other piece at once.' : 'You are out. Watch the rest of the game.'));
      return;
    }
    var log = v.last, names = m.names;
    var sig = m.gid + ':' + log.round;
    if (rev.dataset.sig === sig) return;      // already drawn: do not replay the animation on every update
    rev.dataset.sig = sig; rev.innerHTML = '';
    var dead = {}, spent = {};
    log.destroyed.forEach(function (d) { dead[d.seat] = d; });
    log.spent.forEach(function (d) { spent[d.seat] = d; });
    var grid = el('div', 'mgrid');
    log.picks.forEach(function (p, idx) {
      var f = el('div', 'fighter you ' + (dead[p.seat] ? 'lost' : 'safe'));
      f.style.setProperty('--c', ART.color(p.type)); f.style.animationDelay = (idx * 0.08) + 's';
      var frame = el('div', 'frame'), pic = el('div', 'pic'), sk = (m.skins && m.skins[p.seat]) || {};
      pic.innerHTML = ART.portrait(p.type, sk[p.type]); frame.appendChild(pic);
      frame.appendChild(el('div', 'badge', dead[p.seat] ? 'DESTROYED' : spent[p.seat] ? 'SPENT' : 'SAFE'));
      var plate = el('div', 'plate'); plate.appendChild(el('b', '', E.PIECES[p.type].name)); plate.appendChild(el('span', '', names[p.seat]));
      frame.appendChild(plate); f.appendChild(frame);
      if (p.copy != null) f.appendChild(el('span', 'ribbon', p.as === 'joker' ? 'copies Joker' : '→ ' + E.PIECES[p.as].name));
      grid.appendChild(f);
    });
    rev.appendChild(grid);
    rev.appendChild(el('p', 'mtext' + (log.destroyed.some(function (d) { return d.royal; }) ? ' fall' : ''), M.describeRound(log, names)));
    var lines = [];
    log.clashes.forEach(function (c) {
      var pa = log.picks.filter(function (p) { return p.seat === c.a; })[0], pb = log.picks.filter(function (p) { return p.seat === c.b; })[0];
      if (!pa || !pb) return;
      var na = names[c.a] + "'s " + E.PIECES[pa.as].name, nb = names[c.b] + "'s " + E.PIECES[pb.as].name;
      if (c.result === 'a') lines.push(na + ' beats ' + nb);
      else if (c.result === 'b') lines.push(nb + ' beats ' + na);
      else if (c.result === 'tie') lines.push(na + ' and ' + nb + ' destroy each other');
    });
    if (lines.length) {
      var d = el('details', 'mclashes'); d.appendChild(el('summary', '', 'Who beat whom (' + lines.length + ')'));
      var ul = el('ul', 'mclashes'); lines.forEach(function (t) { ul.appendChild(el('li', '', t)); }); d.appendChild(ul); rev.appendChild(d);
    }
  }

  // ---------- end of game, standings, payouts ----------
  function tieValue(place, n, places, hi, lo, draw, step) {
    var k = places.filter(function (p) { return p === place; }).length;
    if (place === 1) return k === 1 ? hi : draw;
    var sum = 0, i;
    for (i = 0; i < k; i++) sum += n < 2 ? hi : hi - (place - 1 + i) * (hi - lo) / (n - 1);
    return Math.round(sum / k / step) * step;
  }
  function award(m) {
    var key = 'm' + m.code + ':' + m.gid;
    if (store.get('hc_banana_last') === key) return null;
    var v = m.view, n = m.names.length, place = v.places[m.seat];
    var bananas = tieValue(place, n, v.places, 100, -50, 50, 10), points = tieValue(place, n, v.places, 10, -10, 5, 1);
    var k = v.places.filter(function (p) { return p === 1; }).length;
    var kind = place === 1 ? (k === 1 ? 'w' : 'd') : 'l';
    store.set('hc_banana_last', key); store.set('hc_points_last', key);
    var from = A.bananaBalance(); store.set('hc_bananas', String(from + bananas)); A.tweenBananas(from, from + bananas);
    store.set('hc_points', String(A.pointsTotal() + points));
    var r = A.pointsRecord(); r[kind]++; store.set('hc_record', JSON.stringify(r)); A.paintPoints();
    return { bananas: bananas, points: points };
  }
  function showEnd(m) {
    var v = m.view, me = m.seat, n = m.names.length, place = v.places[me];
    var iWon = v.winners.indexOf(me) !== -1, shared = v.winners.length > 1;
    $('mEndTitle').textContent = iWon ? (shared ? 'Draw!' : 'You win!') : 'You finished ' + ordinal(place) + ' of ' + n;
    $('mEndText').textContent = M.endText({ over: true, winners: v.winners }, m.names);
    var list = $('mStandings'); list.innerHTML = '';
    m.names.map(function (name, i) { return i; }).sort(function (a, b) { return v.places[a] - v.places[b] || a - b; }).forEach(function (i) {
      var li = el('li', (i === me ? 'me ' : '') + (v.places[i] === 1 ? 'first' : ''));
      li.appendChild(el('span', 'pl', ordinal(v.places[i]))); li.appendChild(faceOf(m, i));
      li.appendChild(el('span', '', m.names[i] + (i === me ? ' (you)' : '') + (m.kinds[i] === 'bot' ? ' · bot' : '')));
      list.appendChild(li);
    });
    var gain = m.rated ? award(m) : null, bb = $('mBanana'), pp = $('mPoints');
    if (gain) {
      bb.hidden = false; bb.className = 'banana-gain ' + (gain.bananas >= 0 ? 'plus' : 'minus');
      bb.innerHTML = '<span class="bi">' + A.BANANA_SVG + '</span><b>' + (gain.bananas >= 0 ? '+' : '') + A.fmtBananas(gain.bananas) + '</b><span>bananas</span>';
      pp.hidden = false; pp.textContent = (gain.points >= 0 ? '+' : '') + A.fmtPts(gain.points) + ' points';
    } else if (m.rated) { bb.hidden = true; pp.hidden = true; }
    else { bb.hidden = false; bb.className = 'banana-gain'; bb.innerHTML = '<span>No bananas or points: this game had bots.</span>'; pp.hidden = true; }
    var host = m.host === me;
    $('mAgain').hidden = !host; $('mAgainNote').textContent = host ? '' : 'Waiting for ' + m.names[m.host] + ' to start another game.';
    show('mEnd', true);
  }

  // ---------- wiring ----------
  $('btnMulti').addEventListener('click', openJoin);
  $('mJoinCancel').addEventListener('click', function () { show('mJoinOverlay', false); });
  $('mCreate').addEventListener('click', function () { A.whenOpen(function () { A.netSend({ type: 'mcreate', name: A.playerName() || 'Player', skins: A.equippedMap(), isPublic: true }); }); });
  $('mJoin').addEventListener('click', function () { join($('mJoinCode').value); });
  $('mJoinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(this.value); });
  $('mJoinCode').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('mLobbyLeave').addEventListener('click', leave);
  $('mLeave').addEventListener('click', function () { if (confirm('Leave this game? A bot will take your seat.')) leave(); });
  $('mEndLeave').addEventListener('click', leave);
  $('mAddSmart').addEventListener('click', function () { A.netSend({ type: 'maddbot', level: 'smart' }); });
  $('mAddRandom').addEventListener('click', function () { A.netSend({ type: 'maddbot', level: 'random' }); });
  $('mStart').addEventListener('click', function () { A.netSend({ type: 'mstart' }); });
  $('mAgain').addEventListener('click', function () { A.netSend({ type: 'magain' }); });
  $('mNext').addEventListener('click', function () { A.netSend({ type: 'mnext' }); });
  $('mLock').addEventListener('click', function () {
    var m = st.msg; if (!m || !m.view || !st.sel || m.view.locked[m.seat]) return;
    var id = idFor(m, st.sel); if (!id) return;
    var msg = { type: 'mpick', id: id }; if (st.sel === 'joker') msg.copy = st.copy;
    A.netSend(msg);
  });
  $('mLog').addEventListener('click', function () {
    var m = st.msg; if (!m || !m.view) return;
    var ol = $('historyList'); ol.innerHTML = '';
    if (!m.view.history.length) ol.appendChild(el('li', '', 'No rounds yet.'));
    m.view.history.forEach(function (log) { ol.appendChild(el('li', '', 'Round ' + log.round + ': ' + M.describeRound(log, m.names))); });
    show('historyOverlay', true);
  });

  window.HCMulti = { onNet: onNet, active: active, back: back, leave: leave, _state: st };
})();
