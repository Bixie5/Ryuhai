/* Ryuhai - web client. Online rooms (WebSocket), vs Bot, and Pass & play share one UI. */
(function () {
  'use strict';
  var E = window.HC, ART = window.HCArt;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    sget: function (k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    sset: function (k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- UI state ----------
  var session = null;      // current game session (online / bot / hotseat)
  var selType = null;      // piece type currently highlighted in hand
  var myPick = null;       // {seat, type} the piece this device locked in this round
  var lastRoundSeen = 0;
  var lastKey = '';       // round:seat:phase, selection is cleared whenever it changes
  var curPhase = 'pick';
  var lastMsg = null;
  var endTimer = null;

  function show(id, on) { $(id).hidden = !on; }
  function toast(text) {
    var t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function playerName() { var n = $('name').value.trim(); store.set('hc_name', n); return n; }

  // ---------- Online (WebSocket) ----------
  var net = { ws: null, open: false, wantOpen: false, retry: null, handlers: {} };

  function serverAddress() {
    var hosted = /^https?:$/.test(location.protocol) && location.host && location.hostname !== 'appassets.androidplatform.net';
    if (hosted) return location.host;
    return store.get('hc_server');
  }
  function wsUrl() {
    var a = serverAddress();
    if (!a) return '';
    var secure = /^https:\/\//.test(a) || (location.protocol === 'https:' && !/^http:\/\//.test(a) && !/^ws:\/\//.test(a));
    a = a.replace(/^(https?|wss?):\/\//, '').replace(/\/+$/, '');
    return (secure ? 'wss://' : 'ws://') + a + '/ws';
  }
  function connect() {
    var url = wsUrl();
    if (!url) return false;
    if (net.ws && (net.ws.readyState === 0 || net.ws.readyState === 1)) return true;
    net.wantOpen = true;
    var ws;
    try { ws = new WebSocket(url); } catch (e) { return false; }
    net.ws = ws;
    ws.onopen = function () {
      net.open = true;
      var r = store.sget('hc_resume');
      if (r && session && session.kind === 'online') { try { ws.send(JSON.stringify(Object.assign({ type: 'resume' }, JSON.parse(r)))); } catch (e) {} }
      else if (!session) ws.send(JSON.stringify({ type: 'list' }));
      if (net.onopen) net.onopen();
    };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onNet(m); };
    ws.onclose = function () {
      net.open = false;
      if (net.ws === ws) net.ws = null;
      if (net.wantOpen) {
        if (session && session.kind === 'online') toast('Connection lost. Reconnecting...');
        clearTimeout(net.retry); net.retry = setTimeout(connect, 2000);
      }
    };
    ws.onerror = function () {};
    return true;
  }
  function netSend(m) { if (net.ws && net.ws.readyState === 1) { net.ws.send(JSON.stringify(m)); return true; } return false; }
  function whenOpen(fn) {
    if (!wsUrl()) { homeMsg('Set the server address first (Server, bottom of the menu).'); show('serverOverlay', true); return; }
    if (net.open) return fn();
    homeMsg('Connecting...');
    var tries = 0;
    connect();
    var iv = setInterval(function () {
      if (net.open) { clearInterval(iv); homeMsg(''); fn(); }
      else if (++tries > 40) { clearInterval(iv); homeMsg('Could not reach the server at ' + serverAddress() + '.'); }
    }, 100);
  }
  function homeMsg(t) { $('homeMsg').textContent = t || ''; }

  function onNet(m) {
    switch (m.type) {
      case 'rooms': return renderRooms(m.rooms);
      case 'joined':
        store.sset('hc_resume', JSON.stringify({ code: m.code, token: m.token }));
        if (!session || session.kind !== 'online') startSession(onlineSession());
        session.seat = m.seat; return;
      case 'state':
        if (session && session.kind === 'online') render(m);
        return;
      case 'error':
        if (m.fatal) { store.sset('hc_resume', ''); if (session) goHome(); }
        homeMsg(m.message); toast(m.message); return;
      case 'opponent_left':
        toast('Your opponent left the room.');
        goHome(); return;
    }
  }
  function onlineSession() {
    return {
      kind: 'online', seat: 0,
      pick: function (type) { var id = idFor(type); if (id) netSend({ type: 'pick', id: id }); },
      next: function () { netSend({ type: 'next' }); },
      rematch: function () { netSend({ type: 'rematch' }); },
      leave: function () { netSend({ type: 'leave' }); store.sset('hc_resume', ''); }
    };
  }

  // ---------- Local sessions (bot / pass & play) ----------
  function localSession(kind) {
    var s = { kind: kind, game: null, picks: [null, null], viewSeat: 0, cover: null, phase: 'pick' };
    var names = kind === 'bot' ? [playerName() || 'Player', 'The Bot'] : ['Player 1', 'Player 2'];
    function emit() {
      if (session !== s) return;
      var locked = [s.picks[0] != null, s.picks[1] != null];
      render({
        code: kind === 'bot' ? 'BOT' : 'LOCAL', names: names, connected: [true, true], started: true, rematch: [false, false],
        view: E.viewFor(s.game, s.viewSeat, locked), cover: s.cover, phase: s.phase, next: null
      });
    }
    function resolve() {
      s.game = E.play(s.game, s.picks[0], s.picks[1]);
      s.picks = [null, null]; s.viewSeat = 0; s.cover = null;
      // Pass & play: stop on the result until someone presses Next turn.
      s.phase = (kind === 'hotseat' && !s.game.over) ? 'result' : 'pick';
    }
    function idOfType(seat, type) { var p = s.game.hands[seat].filter(function (x) { return x.type === type; })[0]; return p && p.id; }
    s.start = function () { s.game = E.createGame(); s.picks = [null, null]; s.viewSeat = 0; s.cover = null; s.phase = 'pick'; emit(); };
    s.pick = function (type) {
      if (s.game.over) return;
      var seat = s.viewSeat;
      if (s.picks[seat] != null) return;
      s.picks[seat] = idOfType(seat, type);
      if (kind === 'bot') {
        emit();
        setTimeout(function () { s.picks[1] = E.botPick(s.game, 1); resolve(); emit(); }, 700 + Math.random() * 600);
      } else if (seat === 0) {
        s.viewSeat = 1; s.cover = { title: 'Pass to ' + names[1], text: names[0] + ' has locked in. Hand the device to ' + names[1] + ', then tap Ready.', btn: 'I am ' + names[1] };
        emit();
      } else {
        resolve(); emit();
      }
    };
    // Pass & play: either player presses Next turn, then Player 1 confirms they hold the device.
    s.next = function () {
      if (s.phase !== 'result' || s.game.over) return;
      s.phase = 'pick'; s.viewSeat = 0;
      s.cover = { title: 'Next turn', text: 'Hand the device to ' + names[0] + ', then tap the button when you are ready.', btn: 'I am ' + names[0] };
      emit();
    };
    s.uncover = function () { s.cover = null; emit(); };
    s.rematch = function () { s.start(); };
    s.leave = function () {};
    s.names = names;
    return s;
  }

  // ---------- Session lifecycle ----------
  function startSession(s) {
    session = s; selType = null; myPick = null; lastRoundSeen = 0; lastMsg = null; arenaSig = '';
    show('home', false); show('game', true); show('endOverlay', false);
    $('roomCode').textContent = s.kind === 'online' ? '----' : (s.kind === 'bot' ? 'Bot' : 'Local');
    if (s.start) s.start();
    else render({ code: '----', names: ['You', 'Waiting...'], connected: [true, false], started: false, view: null });
  }
  function goHome() {
    if (session && session.leave) session.leave();
    session = null; lastMsg = null; clearTimeout(endTimer);
    store.sset('hc_resume', '');
    show('game', false); show('home', true); show('endOverlay', false); show('cover', false);
    homeMsg('');
    if (wsUrl()) { connect(); if (net.open) netSend({ type: 'list' }); }
  }

  // ---------- Rendering ----------
  function idFor(type) {
    if (!lastMsg || !lastMsg.view) return null;
    var p = lastMsg.view.you.filter(function (x) { return x.type === type; })[0];
    return p ? p.id : null;
  }
  function groupHand(hand) {
    var g = {}; hand.forEach(function (p) { g[p.type] = (g[p.type] || 0) + 1; }); return g;
  }

  function render(msg) {
    lastMsg = msg;
    var v = msg.view;
    $('roomCode').textContent = msg.code;
    var seat = v ? v.seat : (session ? session.seat : 0);
    $('youName').textContent = msg.names[seat] + (session && session.kind === 'hotseat' ? '' : ' (you)');
    $('oppName').textContent = msg.names[1 - seat];

    show('cover', !!msg.cover);
    if (msg.cover) { $('coverTitle').textContent = msg.cover.title; $('coverText').textContent = msg.cover.text; $('coverBtn').textContent = msg.cover.btn; }

    if (!v) {
      $('roundNo').textContent = '-';
      $('oppHand').innerHTML = ''; $('hand').innerHTML = '';
      arenaSig = ''; setIdle('Waiting...', 'Share room code ' + msg.code + ' with your opponent.');
      show('arenaIdle', true); show('arenaReveal', false);
      $('btnLock').disabled = true; $('pickInfo').textContent = '';
      $('oppStatus').textContent = ''; $('youStatus').textContent = '';
      return;
    }

    if (myPick && (myPick.round !== v.round || myPick.seat !== seat)) myPick = null;
    curPhase = msg.phase || 'pick';
    var key = v.round + ':' + seat + ':' + curPhase;
    if (key !== lastKey) { selType = null; lastKey = key; }
    lastRoundSeen = v.round;
    $('roundNo').textContent = String(v.round + 1);

    var oppOnline = msg.connected[1 - seat];
    $('oppStatus').textContent = !oppOnline ? 'disconnected' : (curPhase === 'result' && !v.over ? (session && session.kind === 'hotseat' ? '' : msg.next && msg.next.opp ? 'ready for next turn' : 'reviewing...') : v.locked.opp ? 'locked in' : (v.over ? '' : 'thinking...'));
    $('oppWho').querySelector('.dot').style.opacity = oppOnline ? 1 : .3;
    $('youStatus').textContent = v.locked.you ? 'locked in' : '';

    renderMini(v, 1 - seat);
    renderHand(v);
    renderArena(msg, v, seat);

    var resultPhase = curPhase === 'result' && !v.over;
    var canPlay = !v.over && !v.locked.you && !resultPhase;
    $('btnLock').hidden = resultPhase;
    $('btnNext').hidden = !resultPhase;
    if (resultPhase) {
      var waiting = !!(msg.next && msg.next.you);
      $('btnNext').disabled = waiting;
      $('btnNext').textContent = waiting ? 'Waiting...' : 'Next turn';
      $('pickInfo').textContent = session && session.kind === 'hotseat' ? 'Either player can press Next turn.' :
        waiting ? 'Waiting for your opponent to press Next turn...' : 'Check the result, then press Next turn when you are ready.';
    } else {
      $('btnLock').disabled = !(canPlay && selType);
      $('btnLock').textContent = v.locked.you ? 'Locked' : 'Lock in';
      $('pickInfo').textContent = v.over ? '' : v.locked.you ? 'Waiting for your opponent...' :
        selType ? E.PIECES[selType].name + ': ' + E.PIECES[selType].blurb : 'Select a piece';
    }

    if (v.over) {
      clearTimeout(endTimer);
      endTimer = setTimeout(function () { showEnd(msg, v, seat); }, v.last ? 1800 : 0);
    } else { clearTimeout(endTimer); show('endOverlay', false); }
  }

  function avatar(type) { var d = el('span', 'av'); d.innerHTML = ART.face(type); return d; }

  // The opponent's hand is hidden. Show only what is public: how many pieces they hold,
  // and which of their pieces have been destroyed or spent so far.
  function renderMini(v, oppSeat) {
    var box = $('oppHand'); box.innerHTML = '';
    box.appendChild(el('span', 'chip hidden-count', '\u{1F0A0} ' + v.oppCount + (v.oppCount === 1 ? ' piece hidden' : ' pieces hidden')));
    var fallen = {}, spent = {};
    (v.history || []).forEach(function (l) {
      l.destroyed.forEach(function (d) { if (d.seat === oppSeat) { var t = d.wasJoker ? 'joker' : d.type; fallen[t] = (fallen[t] || 0) + 1; } });
      l.spent.forEach(function (s) { if (s.seat === oppSeat) spent[s.type] = (spent[s.type] || 0) + 1; });
    });
    E.ORDER.forEach(function (t) {
      if (fallen[t]) { var f = el('span', 'chip fallen'); f.appendChild(avatar(t)); f.appendChild(el('i', '', E.PIECES[t].name + (fallen[t] > 1 ? ' ×' + fallen[t] : '') + ' lost')); box.appendChild(f); }
      if (spent[t]) { var s = el('span', 'chip fallen'); s.appendChild(avatar(t)); s.appendChild(el('i', '', E.PIECES[t].name + ' used')); box.appendChild(s); }
    });
  }

  function renderHand(v) {
    var box = $('hand'); box.innerHTML = '';
    var g = groupHand(v.you);
    var disabled = v.over || v.locked.you || curPhase === 'result';
    E.ORDER.forEach(function (t) {
      var n = g[t] || 0;
      var b = el('button', 'card' + (n ? '' : ' gone') + (disabled && n ? ' locked' : '') + (selType === t && n ? ' sel' : ''));
      b.type = 'button'; b.setAttribute('role', 'option'); b.dataset.t = t; b.style.setProperty('--c', ART.color(t));
      b.setAttribute('aria-label', E.PIECES[t].name + (n ? ' x' + n : ' (used)'));
      var pic = el('div', 'pic'); pic.innerHTML = ART.portrait(t); b.appendChild(pic);
      if (n > 1) b.appendChild(el('span', 'n', '×' + n));
      b.appendChild(el('span', 'nm', E.PIECES[t].name));
      if (n && !disabled) b.addEventListener('click', function () { selType = t; render(lastMsg); });
      box.appendChild(b);
    });
  }

  // ---------- fight arena ----------
  function fighter(type, who, side, cls, ribbon) {
    var d = el('div', 'fighter ' + side + ' ' + (cls || ''));
    d.style.setProperty('--c', type ? ART.color(type) : '#7a63ff');
    var frame = el('div', 'frame'), pic = el('div', 'pic');
    if (type) { pic.innerHTML = ART.portrait(type); frame.appendChild(pic); }
    else { pic.appendChild(el('div', 'sigil', '♛')); frame.appendChild(pic); }
    var plate = el('div', 'plate');
    plate.appendChild(el('b', '', type ? E.PIECES[type].name : '???'));
    plate.appendChild(el('span', '', who));
    frame.appendChild(plate);
    d.appendChild(frame);
    if (ribbon) d.appendChild(el('span', 'ribbon', ribbon));
    return d;
  }
  function setIdle(title, text) {
    var box = $('arenaIdle'); box.innerHTML = '';
    box.appendChild(el('b', '', title)); box.appendChild(document.createTextNode(text));
  }
  var arenaSig = '';

  function renderArena(msg, v, seat) {
    var you = $('slotYou'), opp = $('slotOpp');
    var sig, fresh;
    if (v.locked.you && !v.over) {
      var mine = myPick && myPick.seat === seat ? myPick.type : null;
      sig = 'L' + v.round + ':' + seat + ':' + mine + ':' + v.locked.opp;
      if (sig === arenaSig) return;
      arenaSig = sig;
      show('arenaIdle', false); show('arenaReveal', true);
      you.innerHTML = ''; opp.innerHTML = '';
      you.appendChild(fighter(mine, msg.names[seat], 'you', mine ? '' : 'back', 'LOCKED'));
      opp.appendChild(fighter(null, msg.names[1 - seat], 'opp', 'back' + (v.locked.opp ? '' : ' waiting'), v.locked.opp ? 'LOCKED' : ''));
      $('impact').className = 'impact'; $('stamp').className = 'stamp'; $('stamp').textContent = '';
      $('revealText').textContent = v.locked.opp ? '' : 'Your piece is locked. Waiting for your opponent...';
      return;
    }
    if (v.last) {
      sig = 'R' + v.round + ':' + seat;
      if (sig === arenaSig) return;
      arenaSig = sig;
      show('arenaIdle', false); show('arenaReveal', true);
      you.innerHTML = ''; opp.innerHTML = '';
      var l = v.last, names = msg.names, o = l.outcome;
      var youWon = (o === 'win0' && seat === 0) || (o === 'win1' && seat === 1);
      var oppWon = (o === 'win0' && seat === 1) || (o === 'win1' && seat === 0);
      var tie = o === 'tie';
      you.appendChild(fighter(l.types[seat], names[seat], 'you', youWon ? 'won' : oppWon ? 'lost' : tie ? 'lost' : 'draw'));
      opp.appendChild(fighter(l.types[1 - seat], names[1 - seat], 'opp', oppWon ? 'won' : youWon ? 'lost' : tie ? 'lost' : 'draw'));
      var text = E.describeRound(l, names);
      l.spent.forEach(function (sp) { text += ' ' + (session && session.kind === 'hotseat' ? names[sp.seat] + "'s " : sp.seat === seat ? 'Your ' : 'Their ') + E.PIECES[sp.type].name + ' is spent.'; });
      $('revealText').textContent = text;
      var st = $('stamp'), im = $('impact'), ar = $('arena');
      var label = youWon ? ['STRIKE!', 'win'] : oppWon ? ['BROKEN!', 'lose'] : tie ? ['CLASH!', 'draw'] : o === 'jokerclash' ? ['MIRROR!', 'joker'] : ['JOKER!', 'joker'];
      st.textContent = label[0]; st.className = 'stamp ' + label[1]; im.className = 'impact';
      void st.offsetWidth; // restart animations
      st.className = 'stamp go ' + label[1]; im.className = 'impact go';
      ar.classList.remove('shake'); void ar.offsetWidth; ar.classList.add('shake');
    } else {
      sig = 'I' + v.locked.opp;
      if (sig === arenaSig) return;
      arenaSig = sig;
      show('arenaIdle', true); show('arenaReveal', false);
      setIdle(v.locked.opp ? 'Your move!' : 'Choose your piece', v.locked.opp ? 'Your opponent has locked in.' : 'Your opponent cannot see it.');
    }
  }

  function showEnd(msg, v, seat) {
    var w = v.winner, names = msg.names, hot = session && session.kind === 'hotseat';
    var title, cls;
    if (w === 'draw') {  title = 'Draw'; cls = 'draw'; }
    else if (hot) {  title = names[w] + ' wins!'; cls = 'win'; }
    else if (w === seat) {  title = 'Victory'; cls = 'win'; }
    else {  title = 'Defeat'; cls = 'lose'; }
    $('endOverlay').className = 'overlay ' + cls;
    $('endTitle').textContent = title;
    $('endText').textContent = E.endText(v.end, names);
    var waiting = msg.rematch && msg.rematch[seat];
    $('btnRematch').disabled = !!waiting;
    $('rematchNote').style.color = 'var(--mute)';
    $('rematchNote').textContent = waiting ? 'Waiting for your opponent to accept...' : (msg.rematch && msg.rematch[1 - seat] ? 'Your opponent wants a rematch.' : '');
    show('endOverlay', true);
  }

  function renderRooms(list) {
    var box = $('openRooms');
    if (session) return;
    box.innerHTML = '';
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    list.forEach(function (r) {
      var row = el('div', 'room');
      var info = el('div', ''); info.appendChild(el('b', '', r.host)); info.appendChild(document.createTextNode(' ')); info.appendChild(el('small', '', 'room ' + r.code));
      var b = el('button', 'btn', 'Join'); b.addEventListener('click', function () { doJoin(r.code); });
      row.appendChild(info); row.appendChild(b); box.appendChild(row);
    });
  }

  // ---------- Actions ----------
  function doJoin(code) {
    code = (code || '').toUpperCase().trim();
    if (code.length !== 4) return homeMsg('Enter the 4-letter room code.');
    whenOpen(function () { netSend({ type: 'join', code: code, name: playerName() || 'Player 2' }); });
  }
  $('btnCreate').addEventListener('click', function () { whenOpen(function () { netSend({ type: 'create', name: playerName() || 'Player 1', isPublic: true }); }); });
  $('btnJoin').addEventListener('click', function () { doJoin($('joinCode').value); });
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(this.value); });
  $('joinCode').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('btnBot').addEventListener('click', function () { startSession(localSession('bot')); });
  $('btnHotseat').addEventListener('click', function () { startSession(localSession('hotseat')); });
  $('btnLock').addEventListener('click', function () {
    if (!session || !selType || !lastMsg || !lastMsg.view || lastMsg.view.locked.you) return;
    myPick = { seat: lastMsg.view.seat, type: selType, round: lastMsg.view.round };
    session.pick(selType);
  });
  $('btnNext').addEventListener('click', function () { if (session && session.next) session.next(); });
  $('coverBtn').addEventListener('click', function () { if (session && session.uncover) session.uncover(); });
  $('btnRematch').addEventListener('click', function () { if (session) { session.rematch(); show('endOverlay', false); if (session.kind !== 'online') { myPick = null; } } });
  $('btnEndLeave').addEventListener('click', goHome);
  $('btnLeave').addEventListener('click', function () { if (confirm('Leave this game?')) goHome(); });

  $('btnHistory').addEventListener('click', function () {
    var ol = $('historyList'); ol.innerHTML = '';
    var h = (lastMsg && lastMsg.view && lastMsg.view.history) || [];
    if (!h.length) ol.appendChild(el('li', '', 'No rounds yet.'));
    h.forEach(function (l) { ol.appendChild(el('li', '', E.describeRound(l, lastMsg.names))); });
    show('historyOverlay', true);
  });
  $('btnCloseHistory').addEventListener('click', function () { show('historyOverlay', false); });
  $('btnRules').addEventListener('click', function () { show('rulesOverlay', true); });
  $('btnCloseRules').addEventListener('click', function () { show('rulesOverlay', false); });
  $('btnServer').addEventListener('click', function () { $('serverInput').value = store.get('hc_server'); show('serverOverlay', true); });
  $('btnServerClose').addEventListener('click', function () { show('serverOverlay', false); });
  $('btnServerSave').addEventListener('click', function () {
    store.set('hc_server', $('serverInput').value.trim());
    show('serverOverlay', false);
    if (net.ws) { net.wantOpen = false; net.ws.close(); net.ws = null; net.open = false; }
    homeMsg(''); if (wsUrl()) connect();
  });

  // rules table + home hero art
  (function () {
    var box = $('rulesTable');
    E.ORDER.forEach(function (t) {
      var r = el('div', 'rule'); r.style.setProperty('--c', ART.color(t));
      r.appendChild(avatar(t));
      var d = el('div', ''); d.appendChild(el('b', '', E.PIECES[t].name + '  ')); d.appendChild(el('small', '', ART.title(t))); d.appendChild(el('div', '', E.PIECES[t].blurb)); r.appendChild(d);
      box.appendChild(r);
    });
    var hero = $('heroArt'), picks = [['knight', -8, '0s'], ['dragon', 0, '.4s', 'mid'], ['wizard', 8, '.8s']];
    picks.forEach(function (p) {
      var c = el('div', 'hc' + (p[3] ? ' ' + p[3] : '')); c.style.setProperty('--r', p[1] + 'deg'); c.style.setProperty('--d', p[2]); c.innerHTML = ART.portrait(p[0]); hero.appendChild(c);
    });
  })();

  // ---------- Boot ----------
  $('name').value = store.get('hc_name');
  // Show the server box only as a hint when not hosted by the game server
  if (/^https?:$/.test(location.protocol) && location.hostname !== 'appassets.androidplatform.net') $('btnServer').hidden = true;
  if (wsUrl()) {
    var r = store.sget('hc_resume');
    if (r) { session = onlineSession(); startSession(session); }
    connect();
    setInterval(function () { if (!session && net.open) netSend({ type: 'list' }); }, 4000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && wsUrl() && !net.open) connect(); });

  // Android back button / browser back: close overlays first, then offer to leave the game.
  window.__hcBack = function () {
    var ids = ['rulesOverlay', 'historyOverlay', 'serverOverlay'];
    for (var i = 0; i < ids.length; i++) { if (!$(ids[i]).hidden) { show(ids[i], false); return true; } }
    if (!$('endOverlay').hidden) { goHome(); return true; }
    if (session) { if (confirm('Leave this game?')) goHome(); return true; }
    return false;
  };
  window.__hc = { get session() { return session; }, get last() { return lastMsg; } };
})();
