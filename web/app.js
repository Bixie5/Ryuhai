/* Ryuhai - web client. Online rooms (WebSocket), vs Bot, and Pass & play share one UI. */
(function () {
  'use strict';
  var E = window.HC, ART = window.HCArt;
  var $ = function (id) { return document.getElementById(id); };
  // Saved values that follow the player's account when they are signed in.
  var SYNC_KEYS = { hc_bananas: 1, hc_points: 1, hc_record: 1, hc_owned: 1, hc_equipped: 1, hc_banana_last: 1, hc_points_last: 1 };
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} if (SYNC_KEYS[k] && window.HCSync) window.HCSync.dirty(); },
    remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
    sget: function (k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    sset: function (k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} }
  };


  // ---------- Bananas (per-device currency) ----------
  // win +100, draw +50, loss -50. Paid once per finished game (online and vs Bot; not Pass & play).
  var BANANA_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5.5C5.4 6.6 5.8 8.6 6.3 10.8 8 20.5 15 28 26 27.2c1.7-.2 2.4-1.8 1-2.7C19 23.4 13.8 18 12.4 10 12 7.4 9.3 3.9 7 5.5z" fill="#ffd93b" stroke="#5e3f00" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.6 5.6 5.2 3.4" stroke="#5e3f00" stroke-width="2.6" stroke-linecap="round"/><path d="M9.2 9.5c1.6 7.8 6 13.2 13.3 15.6" fill="none" stroke="#fff7b0" stroke-width="1.5" stroke-linecap="round" opacity=".85"/><path d="M25.4 27.1l2.3-.4" stroke="#5e3f00" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var BANANA_VALUE = { win: 100, draw: 50, loss: -50 };                       // online games
  var BOT_BANANAS = {                                                          // games against the Bot, by level
    random: { win: 0,   draw: 0, loss: 0 },
    easy:   { win: 0,   draw: 0, loss: 0 },
    normal: { win: 50,  draw: 0, loss: -50 },
    hard:   { win: 100, draw: 0, loss: -50 }
  };
  var bananaShown = 0;
  function bananaBalance() { var n = parseInt(store.get('hc_bananas'), 10); return isNaN(n) ? 0 : n; }
  function fmtBananas(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US'); }
  function paintBananas(n) { bananaShown = n; $('bananaCount').textContent = fmtBananas(n); $('bananaBar').title = fmtBananas(n) + (Math.abs(n) === 1 ? ' banana' : ' bananas'); }
  function tweenBananas(from, to) {
    var bar = $('bananaBar'), t0 = Date.now(), dur = 700;
    bar.classList.remove('pop'); void bar.offsetWidth; bar.classList.add('pop');
    (function step() {
      var k = Math.min(1, (Date.now() - t0) / dur);
      paintBananas(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) setTimeout(step, 30);
    })();
  }
  // ---------- Points (per-device PvP score) ----------
  // Online PvP only: win +10, loss -10, draw +5. A win where the winning piece was the Empress is worth +20.
  var POINT_VALUE = { win: 10, empressWin: 20, draw: 5, loss: -10 };
  function pointsTotal() { var n = parseInt(store.get('hc_points'), 10); return isNaN(n) ? 0 : n; }
  function pointsRecord() { try { var r = JSON.parse(store.get('hc_record') || '{}'); return { w: +r.w || 0, l: +r.l || 0, d: +r.d || 0 }; } catch (e) { return { w: 0, l: 0, d: 0 }; } }
  function fmtPts(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US'); }
  function paintPoints() {
    var r = pointsRecord(), t = pointsTotal();
    $('pointsCount').textContent = fmtPts(t);
    $('pointsRec').textContent = r.w + 'W ' + r.l + 'L ' + r.d + 'D';
    $('pointsBar').title = 'PvP points: ' + fmtPts(t) + ' (' + r.w + ' wins, ' + r.l + ' losses, ' + r.d + ' draws)';
  }
  // Returns {delta, empress} or null when this game was already scored.
  function awardPoints(gameKey, kind, empress) {
    if (!gameKey || store.get('hc_points_last') === gameKey) return null;
    store.set('hc_points_last', gameKey);
    var delta = kind === 'win' ? (empress ? POINT_VALUE.empressWin : POINT_VALUE.win) : POINT_VALUE[kind];
    store.set('hc_points', String(pointsTotal() + delta));
    var r = pointsRecord(); if (kind === 'win') r.w++; else if (kind === 'loss') r.l++; else r.d++;
    store.set('hc_record', JSON.stringify(r));
    paintPoints();
    return { delta: delta, empress: !!(kind === 'win' && empress) };
  }

  // Returns the amount paid, or null if this game was already paid out.
  function awardBananas(gameKey, kind, table) {
    if (!gameKey || store.get('hc_banana_last') === gameKey) return null;
    store.set('hc_banana_last', gameKey);
    var delta = (table || BANANA_VALUE)[kind], from = bananaBalance(), to = from + delta;
    store.set('hc_bananas', String(to));
    tweenBananas(from, to);
    return delta;
  }


  // ---------- Skins: ownership, equipping, catalog ----------
  function loadJson(key, fallback) { try { var v = JSON.parse(store.get(key)); return v && typeof v === typeof fallback ? v : fallback; } catch (e) { return fallback; } }
  function ownedList() { var l = loadJson('hc_owned', []); return Array.isArray(l) ? l : []; }
  function isOwned(id) { return ownedList().indexOf(id) !== -1; }
  function equippedRaw() { var m = loadJson('hc_equipped', {}); return (m && !Array.isArray(m)) ? m : {}; }
  // Only skins that are owned and still in the shop count; everything else falls back to the classic art.
  function equippedMap() {
    var raw = equippedRaw(), out = {};
    E.ORDER.forEach(function (t) { var id = raw[t]; if (id && isOwned(id) && ART.item(id) && ART.item(id).piece === t) out[t] = id; });
    return out;
  }
  function setEquipped(piece, id) { var m = equippedRaw(); if (id) m[piece] = id; else delete m[piece]; store.set('hc_equipped', JSON.stringify(m)); }
  var skinCtx = { you: {}, opp: {} };

  // Where the shop catalog and its images come from: the game server (when known) or the bundled copy.
  function httpBase() {
    var hosted = /^https?:$/.test(location.protocol) && location.host && location.hostname !== 'appassets.androidplatform.net';
    if (hosted) return '';
    var u = wsUrl();
    return u ? u.replace(/^ws/, 'http').replace(/\/ws$/, '/') : null;
  }
  // The shop list comes from, in order: the always-on remote copy (HC_CONFIG.shopUrl, e.g. on GitHub), the game server,
  // then the last copy this device saved, then the one bundled in the app. It is fetched every time the game opens.
  function remoteShopBase() {
    var u = window.HC_CONFIG && window.HC_CONFIG.shopUrl;
    if (!u || typeof u !== 'string') return null;
    return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(u) ? u.replace(/\/*$/, '/') : null;
  }
  function cacheCatalog(j, base) { try { store.set('hc_catalog_cache', JSON.stringify({ base: base, j: j })); } catch (e) {} }
  function applyCachedCatalog() {
    try { var c = JSON.parse(store.get('hc_catalog_cache')); if (c && c.j && typeof c.base === 'string') { ART.setCatalog(c.j, c.base); return true; } } catch (e) {}
    return false;
  }
  function refreshCatalog(done) {
    var sources = [], remote = remoteShopBase(), srv = httpBase();
    if (remote) sources.push(remote);
    if (srv !== null) sources.push(srv + 'shop/');
    if (!sources.length || typeof fetch !== 'function') { if (done) done(); return; }
    var stamp = Math.floor(Date.now() / 60000);
    (function next(i) {
      if (i >= sources.length) { if (done) done(); return; }
      fetch(sources[i] + 'catalog.json?t=' + stamp, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
        .then(function (j) { if (!j || !Array.isArray(j.items)) throw new Error('bad'); ART.setCatalog(j, sources[i]); cacheCatalog(j, sources[i]); if (done) done(); })
        .catch(function () { next(i + 1); });
    })(0);
  }

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
    return store.get('hc_server') || (window.HC_CONFIG && window.HC_CONFIG.server) || '';
  }
  // A bare internet host name (no port, not an IP, not localhost) is reached securely (wss/https), as hosting services require.
  function looksPublic(a) {
    var h = a.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
    if (/:\d+$/.test(h)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^localhost$/i.test(h) || /\.(local|lan|home|internal)$/i.test(h) || h.indexOf('.') === -1) return false;
    return true;
  }
  function wsUrl() {
    var a = serverAddress();
    if (!a) return '';
    var explicit = /^(https|wss):\/\//.test(a) ? true : /^(http|ws):\/\//.test(a) ? false : null;
    var secure = explicit !== null ? explicit : (location.protocol === 'https:' || looksPublic(a));
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
  function localSession(kind, level) {
    var s = { kind: kind, level: level || 'normal', gid: null, game: null, picks: [null, null], viewSeat: 0, cover: null, phase: 'pick' };
    var names = kind === 'bot' ? [playerName() || 'Player', 'The Bot'] : ['Player 1', 'Player 2'];
    function emit() {
      if (session !== s) return;
      var locked = [s.picks[0] != null, s.picks[1] != null];
      render({
        code: kind === 'bot' ? 'BOT \u00b7 ' + s.level.toUpperCase() : 'LOCAL', names: names, connected: [true, true], started: true, rematch: [false, false],
        view: E.viewFor(s.game, s.viewSeat, locked), cover: s.cover, phase: s.phase, next: null, gid: kind === 'bot' ? s.gid : null
      });
    }
    function resolve() {
      s.game = E.play(s.game, s.picks[0], s.picks[1]);
      s.picks = [null, null]; s.cover = null;
      // Bot games are always seen from seat 0. In Pass & play the result stays on the player who just picked (Player 2).
      if (kind !== 'hotseat') s.viewSeat = 0;
      // Pass & play: stop on the result until someone presses Next turn.
      s.phase = (kind === 'hotseat' && !s.game.over) ? 'result' : 'pick';
    }
    function idOfType(seat, type) { var p = s.game.hands[seat].filter(function (x) { return x.type === type; })[0]; return p && p.id; }
    s.start = function () { s.gid = kind + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 7); s.game = E.createGame(); s.picks = [null, null]; s.viewSeat = 0; s.cover = null; s.phase = 'pick'; emit(); };
    s.pick = function (type) {
      if (s.game.over) return;
      var seat = s.viewSeat;
      if (s.picks[seat] != null) return;
      s.picks[seat] = idOfType(seat, type);
      if (kind === 'bot') {
        emit();
        setTimeout(function () { s.picks[1] = E.botPick(s.game, 1, null, s.level); resolve(); emit(); }, 700 + Math.random() * 600);
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
    $('roomCode').textContent = s.kind === 'online' ? '----' : (s.kind === 'bot' ? 'Bot \u00b7 ' + ({ random: 'Random', easy: 'Easy', normal: 'Normal', hard: 'Hard' }[s.level] || 'Normal') : 'Local');
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
      $('hand').innerHTML = '';
      arenaSig = ''; setIdle('Waiting...', 'Share room code ' + msg.code + ' with your opponent.');
      show('arenaIdle', true); show('arenaReveal', false);
      $('btnLock').disabled = true; $('pickInfo').textContent = '';
      $('oppStatus').textContent = ''; $('youStatus').textContent = '';
      return;
    }

    if (myPick && (myPick.round !== v.round || myPick.seat !== seat)) myPick = null;
    var kindNow = session && session.kind;
    skinCtx = kindNow === 'online' ? { you: equippedMap(), opp: msg.oppSkins || {} } : kindNow === 'hotseat' ? { you: equippedMap(), opp: equippedMap() } : { you: equippedMap(), opp: {} };
    curPhase = msg.phase || 'pick';
    var key = v.round + ':' + seat + ':' + curPhase;
    if (key !== lastKey) { selType = null; lastKey = key; }
    lastRoundSeen = v.round;
    $('roundNo').textContent = String(v.round + 1);

    var oppOnline = msg.connected[1 - seat];
    $('oppStatus').textContent = !oppOnline ? 'disconnected' : (curPhase === 'result' && !v.over ? (session && session.kind === 'hotseat' ? '' : msg.next && msg.next.opp ? 'ready for next turn' : 'reviewing...') : v.locked.opp ? 'locked in' : (v.over ? '' : 'thinking...'));
    $('oppWho').querySelector('.dot').style.opacity = oppOnline ? 1 : .3;
    $('youStatus').textContent = v.locked.you ? 'locked in' : '';

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

  function avatar(type, skinId) { var d = el('span', 'av'); d.innerHTML = ART.face(type, skinId); return d; }

  function renderHand(v) {
    var box = $('hand'); box.innerHTML = '';
    var g = groupHand(v.you);
    var disabled = v.over || v.locked.you || curPhase === 'result';
    E.ORDER.forEach(function (t) {
      var n = g[t] || 0;
      var b = el('button', 'card' + (n ? '' : ' gone') + (disabled && n ? ' locked' : '') + (selType === t && n ? ' sel' : ''));
      b.type = 'button'; b.setAttribute('role', 'option'); b.dataset.t = t; b.style.setProperty('--c', ART.color(t));
      b.setAttribute('aria-label', E.PIECES[t].name + (n ? ' x' + n : ' (used)'));
      var pic = el('div', 'pic'); pic.innerHTML = ART.portrait(t, skinCtx.you[t]); b.appendChild(pic);
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
    if (type) { pic.innerHTML = ART.portrait(type, (skinCtx[side === 'opp' ? 'opp' : 'you'] || {})[type]); frame.appendChild(pic); }
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
    // bananas: only for games with a real opponent or the bot (never Pass & play)
    var gain = $('bananaGain'); gain.hidden = true;
    if (!hot && msg.gid != null) {
      var kind = w === 'draw' ? 'draw' : (w === seat ? 'win' : 'loss');
      var table = session && session.kind === 'bot' ? (BOT_BANANAS[session.level] || BOT_BANANAS.normal) : null;
      var paid = awardBananas(msg.code + ':' + msg.gid, kind, table);
      if (paid === 0) {
        gain.className = 'banana-gain zero';
        gain.innerHTML = '<span class="bi">' + BANANA_SVG + '</span><span>' + (table && (session.level === 'easy' || session.level === 'random') ? 'No bananas at ' + (session.level === 'easy' ? 'Easy' : 'Random') + ' level' : 'No bananas this time') + '</span>';
        gain.hidden = false;
      } else if (paid != null) {
        gain.className = 'banana-gain ' + (paid > 0 ? 'plus' : 'minus');
        gain.innerHTML = '<span class="bi">' + BANANA_SVG + '</span><b>' + (paid > 0 ? '+' : '-') + Math.abs(paid) + '</b> ' + (Math.abs(paid) === 1 ? 'banana' : 'bananas');
        gain.hidden = false;
      }
    }
    var pg = $('pointsGain'); pg.hidden = true;
    if (session && session.kind === 'online' && msg.gid != null) {
      var k2 = w === 'draw' ? 'draw' : (w === seat ? 'win' : 'loss');
      var lastRound = v.last, emp = !!(lastRound && k2 === 'win' && lastRound.types[seat] === 'empress' && (lastRound.outcome === (seat === 0 ? 'win0' : 'win1')));
      var pr = awardPoints(msg.code + ':' + msg.gid, k2, emp);
      if (pr) {
        pg.className = 'points-gain ' + (pr.delta > 0 ? 'plus' : 'minus');
        pg.innerHTML = '<b>' + (pr.delta > 0 ? '+' : '-') + Math.abs(pr.delta) + '</b> points' + (pr.empress ? ' <small>Empress victory!</small>' : '');
        pg.hidden = false;
      }
    }
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
    whenOpen(function () { netSend({ type: 'join', code: code, name: playerName() || 'Player 2', skins: equippedMap() }); });
  }
  $('btnCreate').addEventListener('click', function () { whenOpen(function () { netSend({ type: 'create', name: playerName() || 'Player 1', isPublic: true, skins: equippedMap() }); }); });
  $('btnJoin').addEventListener('click', function () { doJoin($('joinCode').value); });
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(this.value); });
  $('joinCode').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  function openBotChoice() {
    var last = store.get('hc_bot_level') || 'normal';
    Array.prototype.forEach.call(document.querySelectorAll('#botOverlay .lvl'), function (b) { b.classList.toggle('last', b.getAttribute('data-level') === last); });
    show('botOverlay', true);
  }
  $('btnBot').addEventListener('click', openBotChoice);
  $('btnBotCancel').addEventListener('click', function () { show('botOverlay', false); });
  Array.prototype.forEach.call(document.querySelectorAll('#botOverlay .lvl'), function (b) {
    b.addEventListener('click', function () {
      var lv = b.getAttribute('data-level'); store.set('hc_bot_level', lv);
      show('botOverlay', false); startSession(localSession('bot', lv));
    });
  });
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


  // ---------- Shop ----------
  var shopFilter = 'all';
  function setBananaBalance(to) { var from = bananaBalance(); store.set('hc_bananas', String(to)); tweenBananas(from, to); }
  function priceText(n) { return n === 0 ? 'Free' : fmtBananas(n); }

  function openShop() {
    show('home', false); show('shop', true);
    window.scrollTo(0, 0);
    renderShop(); refreshCatalog(renderShop);
  }
  function closeShop() { show('shop', false); show('home', true); }

  function openPreview(piece, it) {
    $('previewImg').innerHTML = ART.portrait(piece, it && it.id);
    $('previewName').textContent = it ? it.name : 'Classic ' + E.PIECES[piece].name;
    $('previewDesc').textContent = it ? (it.description || '') : ART.title(piece);
    show('previewOverlay', true);
  }

  function equipSkin(piece, it) {
    setEquipped(piece, it ? it.id : null);
    toast((it ? it.name : 'Classic ' + E.PIECES[piece].name) + ' equipped');
    renderShop();
  }
  function buySkin(it) {
    if (isOwned(it.id)) return;
    var bal = bananaBalance();
    if (bal < it.price) { toast('Not enough bananas. You need ' + fmtBananas(it.price - bal) + ' more.'); return; }
    if (!confirm('Buy ' + it.name + ' for ' + priceText(it.price) + (it.price ? ' bananas' : '') + '?')) return;
    var owned = ownedList(); owned.push(it.id); store.set('hc_owned', JSON.stringify(owned));
    if (it.price) setBananaBalance(bal - it.price);
    setEquipped(it.piece, it.id);
    toast(it.name + ' is yours and equipped!');
    renderShop();
  }

  function shopCard(piece, it) {
    var c = el('div', 'shopcard' + (it ? '' : ' classic'));
    c.style.setProperty('--c', ART.color(piece));
    var eq = equippedMap()[piece] || null;
    var isEq = it ? eq === it.id : !eq;
    var owned = !it || isOwned(it.id);
    if (isEq) c.classList.add('equipped');
    var pic = el('button', 'pic'); pic.type = 'button';
    pic.setAttribute('aria-label', 'Preview ' + (it ? it.name : 'Classic ' + E.PIECES[piece].name));
    pic.innerHTML = ART.portrait(piece, it && it.id);
    pic.addEventListener('click', function () { openPreview(piece, it); });
    c.appendChild(pic);
    c.appendChild(el('span', 'ptag', E.PIECES[piece].name));
    var body = el('div', 'sbody');
    body.appendChild(el('b', 'sname', it ? it.name : 'Classic'));
    if (it && it.description) body.appendChild(el('small', 'sdesc', it.description));
    var act = el('div', 'sact');
    if (owned) {
      if (isEq) act.appendChild(el('span', 'badge-eq', 'Equipped'));
      else { var b = el('button', 'btn small', 'Equip'); b.type = 'button'; b.addEventListener('click', function () { equipSkin(piece, it); }); act.appendChild(b); }
      if (it && !isEq) body.appendChild(el('small', 'sowned', 'Owned'));
    } else {
      var poor = bananaBalance() < it.price;
      var pr = el('span', 'price' + (poor ? ' poor' : ''));
      var ic = el('span', 'bi'); ic.innerHTML = BANANA_SVG; pr.appendChild(ic); pr.appendChild(el('b', '', priceText(it.price)));
      act.appendChild(pr);
      var buy = el('button', 'btn small primary' + (poor ? ' poor' : ''), 'Buy'); buy.type = 'button';
      buy.addEventListener('click', function () { buySkin(it); });
      act.appendChild(buy);
    }
    body.appendChild(act);
    c.appendChild(body);
    return c;
  }

  function renderShop() {
    var items = ART.items();
    // filter chips
    var fbox = $('shopFilters'); fbox.innerHTML = '';
    [['all', 'All']].concat(E.ORDER.map(function (t) { return [t, E.PIECES[t].name]; })).forEach(function (f) {
      var b = el('button', 'fchip' + (shopFilter === f[0] ? ' on' : ''), f[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', shopFilter === f[0]);
      b.addEventListener('click', function () { shopFilter = f[0]; renderShop(); });
      fbox.appendChild(b);
    });
    $('shopEmpty').hidden = items.length > 0;
    var grid = $('shopGrid'); grid.innerHTML = '';
    E.ORDER.forEach(function (piece) {
      if (shopFilter !== 'all' && shopFilter !== piece) return;
      grid.appendChild(shopCard(piece, null));
      items.filter(function (it) { return it.piece === piece; }).sort(function (x, y) { return x.price - y.price; })
        .forEach(function (it) { grid.appendChild(shopCard(piece, it)); });
    });
  }

  $('btnShop').addEventListener('click', openShop);
  $('btnShopBack').addEventListener('click', closeShop);
  $('btnClosePreview').addEventListener('click', function () { show('previewOverlay', false); });


  // ---------- Online save (account) ----------
  function cloudRead() {
    return { bananas: bananaBalance(), points: pointsTotal(), record: pointsRecord(), owned: ownedList(), equipped: equippedRaw(), bananaLast: store.get('hc_banana_last'), pointsLast: store.get('hc_points_last') };
  }
  function cloudWrite(d) {
    store.set('hc_bananas', String(d.bananas)); store.set('hc_points', String(d.points)); store.set('hc_record', JSON.stringify(d.record));
    store.set('hc_owned', JSON.stringify(d.owned)); store.set('hc_equipped', JSON.stringify(d.equipped));
    if (d.bananaLast != null) store.set('hc_banana_last', d.bananaLast);
    if (d.pointsLast != null) store.set('hc_points_last', d.pointsLast);
    paintBananas(d.bananas); paintPoints();
    if (!$('shop').hidden) renderShop();
  }
  function summaryText(d) {
    var r = d.record || {}, n = (d.owned || []).length;
    return fmtBananas(d.bananas || 0) + ' bananas, ' + fmtPts(d.points || 0) + ' pts, ' + (r.w || 0) + 'W ' + (r.l || 0) + 'L ' + (r.d || 0) + 'D, ' + n + (n === 1 ? ' skin' : ' skins');
  }
  var acctMode = 'in', acctPending = null;
  function ago(t) {
    if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function acctMsg(t, good) { var m = $('acctMsg'); m.textContent = t || ''; m.style.color = good ? 'var(--win)' : 'var(--lose)'; }
  function renderAccount() {
    var signed = window.HCSync.signedIn(), st = window.HCSync.state();
    $('acctLabel').textContent = signed ? window.HCSync.username() : 'Sign in';
    $('acctDot').className = 'acct-dot ' + (!signed ? '' : st.status === 'error' ? 'bad' : st.status === 'syncing' ? 'busy' : 'good');
    var pending = !!acctPending;
    $('acctOut').hidden = signed || pending; $('acctChoice').hidden = !pending; $('acctIn').hidden = !signed || pending;
    if (signed) {
      $('acctName').textContent = window.HCSync.username();
      $('acctStatus').textContent = st.status === 'syncing' ? 'Syncing...' : st.status === 'error' ? 'Could not sync: ' + st.error + ' Your progress is safe on this device and will retry.' : 'Saved online' + (st.lastOk ? ' (' + ago(st.lastOk) + ')' : '') + '. Changes upload automatically.';
      $('acctSummary').textContent = summaryText(cloudRead());
    }
    var reg = acctMode === 'new';
    $('acctTabIn').className = reg ? '' : 'on'; $('acctTabNew').className = reg ? 'on' : '';
    $('acctGo').textContent = reg ? 'Create account' : 'Sign in';
    $('acctHint').hidden = !reg;
    $('acctPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  }
  function acctBusy(on) { ['acctGo', 'acctSync', 'acctOutBtn', 'acctDel', 'chCloud', 'chBoth', 'chDevice'].forEach(function (id) { $(id).disabled = on; }); }
  function openAccount() { acctMsg(''); acctPending = null; renderAccount(); show('accountOverlay', true); if (window.HCSync.signedIn()) window.HCSync.syncNow(); }
  function afterAuth(res) {
    if (res && res.choice) {
      acctPending = res; $('cmpLocal').textContent = summaryText(res.local); $('cmpCloud').textContent = summaryText(res.cloud);
      acctMsg(''); renderAccount(); return;
    }
    acctPending = null; $('acctPass').value = ''; acctMsg('You are signed in. Your progress is saved online.', true); renderAccount();
  }
  $('btnAccount').addEventListener('click', openAccount);
  $('btnAcctClose').addEventListener('click', function () { show('accountOverlay', false); });
  $('acctTabIn').addEventListener('click', function () { acctMode = 'in'; acctMsg(''); renderAccount(); });
  $('acctTabNew').addEventListener('click', function () { acctMode = 'new'; acctMsg(''); renderAccount(); });
  $('acctOut').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('acctUser').value.trim(), p = $('acctPass').value;
    if (!u || !p) { acctMsg('Enter a username and password.'); return; }
    acctBusy(true); acctMsg('Please wait...', true);
    var go = acctMode === 'new' ? window.HCSync.register(u, p) : window.HCSync.login(u, p);
    go.then(afterAuth, function (err) { acctMsg(err.message); }).then(function () { acctBusy(false); renderAccount(); });
  });
  function choose(kind) {
    var pend = acctPending; if (!pend) return;
    acctBusy(true); acctMsg('Saving...', true);
    window.HCSync.resolve(kind, pend).then(function () { acctPending = null; $('acctPass').value = ''; acctMsg('Done. Your progress is saved online.', true); }, function (err) { acctMsg(err.message); })
      .then(function () { acctBusy(false); renderAccount(); });
  }
  $('chCloud').addEventListener('click', function () { choose('cloud'); });
  $('chBoth').addEventListener('click', function () { choose('both'); });
  $('chDevice').addEventListener('click', function () { choose('device'); });
  $('acctSync').addEventListener('click', function () {
    acctBusy(true); acctMsg('Syncing...', true);
    window.HCSync.syncNow().then(function () { var st = window.HCSync.state(); acctMsg(st.status === 'error' ? st.error : 'Up to date.', st.status !== 'error'); acctBusy(false); renderAccount(); });
  });
  $('acctOutBtn').addEventListener('click', function () {
    acctBusy(true);
    window.HCSync.logout().then(function () { acctMsg('Signed out. Your progress stays on this device.', true); acctBusy(false); renderAccount(); });
  });
  $('acctDel').addEventListener('click', function () {
    var pw = window.prompt('Delete your online account? Your progress stays on this device, but the online copy is erased for good.\n\nType your password to confirm:');
    if (!pw) return;
    acctBusy(true);
    window.HCSync.deleteAccount(pw).then(function () { acctMsg('Account deleted.', true); }, function (err) { acctMsg(err.message); }).then(function () { acctBusy(false); renderAccount(); });
  });

  // ---------- Boot ----------
  $('name').value = store.get('hc_name');
  $('bananaIcon').innerHTML = BANANA_SVG; $('shopBtnIcon').innerHTML = BANANA_SVG; paintBananas(bananaBalance()); paintPoints();
  // Start from what this device saved last time (so skins show instantly, even offline), else the bundled list; then refresh.
  if (!applyCachedCatalog()) ART.setCatalog(window.HC_CATALOG || { items: [] }, 'shop/');
  refreshCatalog(function () { if (!$('shop').hidden) renderShop(); });
  window.HCSync.init({ base: httpBase, read: cloudRead, write: cloudWrite, store: store,
    onChange: function () { renderAccount(); },
    onNotice: function (t) { toast(t); } });
  renderAccount();
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
    var ids = ['previewOverlay', 'rulesOverlay', 'historyOverlay', 'serverOverlay', 'accountOverlay', 'botOverlay'];
    for (var i = 0; i < ids.length; i++) { if (!$(ids[i]).hidden) { show(ids[i], false); return true; } }
    if (!$('shop').hidden) { closeShop(); return true; }
    if (!$('endOverlay').hidden) { goHome(); return true; }
    if (session) { if (confirm('Leave this game?')) goHome(); return true; }
    return false;
  };
  window.__hc = { wsUrl: wsUrl, get session() { return session; }, get last() { return lastMsg; } };
})();
