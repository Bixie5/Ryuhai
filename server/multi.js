/* Ryuhai - multiplayer rooms (2 to 6 players, bots can fill seats).
 *
 * Message types (all start with "m" so they never clash with the 2-player rooms):
 *   mlist                       list public lobbies
 *   mcreate {name, skins, isPublic}   open a room and sit in seat 0 (the host)
 *   mjoin {code, name, skins}   take the next free seat while the room is in its lobby
 *   mresume {code, token}       reconnect to your seat
 *   maddbot {level}             host: add a bot ("random" or "smart")
 *   mrembot {seat}              host: remove a bot
 *   mstart                      host: start (2 or more seats)
 *   mpick {id, copy}            lock in a piece (copy = the player a Joker copies)
 *   mnext                       ready for the next round
 *   magain                      host: back to the lobby after a game
 *   mleave                      leave the room
 *
 * Server -> client: "mjoined" {code, seat, token}, "mstate" {...}, "mrooms" {rooms}, "mleft", "error".
 * Other players' hands and current picks are never sent.
 */
const crypto = require('crypto');
const M = require('../shared/multi');

const MAX = M.MAX_PLAYERS;
const OFFLINE_MS = 45 * 1000;      // a player who stays disconnected this long is replaced by a bot
const BOT_NAMES = ['Aoi', 'Ren', 'Kaito', 'Yuki', 'Sora', 'Hana', 'Riku', 'Mei'];

function createMulti(deps) {
  const send = deps.send, cleanName = deps.cleanName, cleanSkins = deps.cleanSkins, newCode = deps.newCode;
  const rooms = deps.rooms || new Map();
  const AUTO_MS = deps.autoMs == null ? 2500 : deps.autoMs;
  const botLevel = (l) => (l === 'random' ? 'random' : 'smart');

  const uniqueName = (room, name) => {
    const taken = room.seats.map((s) => s.name.toLowerCase());
    if (taken.indexOf(name.toLowerCase()) === -1) return name;
    for (let i = 2; i < 20; i++) { const n = (name + ' ' + i).slice(0, 18); if (taken.indexOf(n.toLowerCase()) === -1) return n; }
    return name;
  };
  const botName = (room) => {
    const taken = room.seats.map((s) => s.name);
    const free = BOT_NAMES.filter((n) => taken.indexOf(n) === -1);
    return free.length ? free[crypto.randomInt(free.length)] : 'Bot ' + (room.seats.length + 1);
  };

  const isOn = (seat) => !!(seat.kind === 'human' && seat.ws && seat.ws.readyState === 1);
  const seatOf = (room, ws) => room.seats.findIndex((s) => s.kind === 'human' && s.ws === ws);
  const hostSeat = (room) => room.seats.findIndex((s) => s.kind === 'human');

  function push(room) {
    const names = room.seats.map((s) => s.name);
    const common = {
      type: 'mstate', code: room.code, phase: room.phase, gid: room.gid, host: hostSeat(room),
      names: names, kinds: room.seats.map((s) => s.kind), levels: room.seats.map((s) => s.level || null),
      connected: room.seats.map((s) => (s.kind === 'bot' ? true : isOn(s))),
      skins: room.seats.map((s) => s.skins || {}), rated: !!room.rated, isPublic: room.isPublic, max: MAX
    };
    room.seats.forEach((s, seat) => {
      if (s.kind !== 'human') return;
      const view = room.game ? M.viewFor(room.game, seat, room.picks.map((p) => p != null)) : null;
      if (view && !view.alive[seat]) view.you = [];
      send(s.ws, Object.assign({ seat: seat }, common, {
        next: room.seats.map((q, i) => !!room.ready[i]),
        view: view
      }));
    });
  }

  function botPicks(room) {
    M.aliveSeats(room.game).forEach((i) => {
      const s = room.seats[i];
      if (s.kind === 'bot' && room.picks[i] == null) room.picks[i] = M.botPick(room.game, i, Math.random, s.level);
    });
  }

  function startGame(room) {
    room.game = M.createGame(room.seats.length);
    room.picks = room.seats.map(() => null);
    room.ready = room.seats.map(() => false);
    room.phase = 'pick';
    room.gid = (room.gid || 0) + 1;
    room.rated = room.seats.length >= 2 && room.seats.every((s) => s.kind === 'human');
    botPicks(room);
    settle(room);
  }

  function aliveHumansReady(room) {
    const alive = M.aliveSeats(room.game);
    return alive.every((i) => room.seats[i].kind === 'bot' || room.ready[i]);
  }

  // Move the room forward as far as it can go without waiting for anyone.
  function settle(room) {
    clearTimeout(room.timer); room.timer = null;
    if (room.phase === 'pick') {
      const alive = M.aliveSeats(room.game);
      if (alive.every((i) => room.picks[i] != null)) {
        room.game = M.play(room.game, room.picks);
        room.picks = room.seats.map(() => null);
        room.ready = room.seats.map(() => false);
        room.phase = room.game.over ? 'over' : 'result';
      }
    } else if (room.phase === 'result') {
      if (aliveHumansReady(room)) {
        room.phase = 'pick'; room.ready = room.seats.map(() => false);
        botPicks(room);
        return settle(room);
      }
    }
    // Only bots are still in the game: keep it moving on its own so the people who are out can watch it finish.
    if (room.phase === 'result' && !M.aliveSeats(room.game).some((i) => room.seats[i].kind === 'human')) {
      room.timer = setTimeout(() => { room.timer = null; if (rooms.has(room.code) && room.phase === 'result') { room.phase = 'pick'; room.ready = room.seats.map(() => false); botPicks(room); settle(room); push(room); } }, AUTO_MS);
    }
    push(room);
  }

  function lobbyList() {
    const out = [];
    rooms.forEach((r) => { if (r.isPublic && r.phase === 'lobby' && r.seats.length < MAX && hostSeat(r) >= 0) out.push({ code: r.code, host: r.seats[hostSeat(r)].name, count: r.seats.length, max: MAX }); });
    return out;
  }

  function removeSeat(room, seat) {
    room.seats.splice(seat, 1);
  }

  // A human leaves for good. In a lobby the seat is freed. Mid-game a bot takes over so the others can finish.
  function drop(room, seat) {
    const s = room.seats[seat];
    if (!s || s.kind !== 'human') return;
    if (s.ws) s.ws.mroom = null;
    if (room.phase === 'lobby') {
      removeSeat(room, seat);
      if (hostSeat(room) < 0) { rooms.delete(room.code); return; }
      return push(room);
    }
    room.seats[seat] = { kind: 'bot', level: 'smart', name: s.name, skins: s.skins, replaced: true };
    room.rated = false;
    if (!room.seats.some((q) => q.kind === 'human')) { clearTimeout(room.timer); rooms.delete(room.code); return; }
    if (room.phase === 'pick') botPicks(room);
    settle(room);
  }

  function handle(ws, msg) {
    const type = msg.type;
    switch (type) {
      case 'mlist': send(ws, { type: 'mrooms', rooms: lobbyList() }); return true;
      case 'mcreate': {
        if (ws.mroom) drop(ws.mroom, seatOf(ws.mroom, ws));
        const code = newCode();
        const token = crypto.randomBytes(12).toString('hex');
        const room = { code: code, seats: [{ kind: 'human', ws: ws, name: cleanName(msg.name, 'Player 1'), token: token, skins: cleanSkins(msg.skins) }], phase: 'lobby', game: null, picks: [], ready: [], gid: 0, rated: false, isPublic: msg.isPublic !== false, touched: Date.now(), timer: null };
        rooms.set(code, room);
        ws.mroom = room;
        send(ws, { type: 'mjoined', code: code, seat: 0, token: token });
        push(room); return true;
      }
      case 'mjoin': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) { send(ws, { type: 'error', multi: true, message: 'No room with that code.' }); return true; }
        if (room.phase !== 'lobby') { send(ws, { type: 'error', multi: true, message: 'That game has already started.' }); return true; }
        if (room.seats.length >= MAX) { send(ws, { type: 'error', multi: true, message: 'That room is full (' + MAX + ' players).' }); return true; }
        if (ws.mroom) drop(ws.mroom, seatOf(ws.mroom, ws));
        const token = crypto.randomBytes(12).toString('hex');
        const name = uniqueName(room, cleanName(msg.name, 'Player ' + (room.seats.length + 1)));
        room.seats.push({ kind: 'human', ws: ws, name: name, token: token, skins: cleanSkins(msg.skins) });
        ws.mroom = room; room.touched = Date.now();
        send(ws, { type: 'mjoined', code: room.code, seat: room.seats.length - 1, token: token });
        push(room); return true;
      }
      case 'mresume': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const seat = room ? room.seats.findIndex((s) => s.kind === 'human' && s.token === msg.token) : -1;
        if (seat < 0) { send(ws, { type: 'error', multi: true, message: 'That game is no longer available.', fatal: true }); return true; }
        room.seats[seat].ws = ws; room.seats[seat].offlineSince = 0;
        ws.mroom = room;
        send(ws, { type: 'mjoined', code: room.code, seat: seat, token: msg.token });
        push(room); return true;
      }
    }
    const room = ws.mroom;
    if (!room) { return type[0] === 'm'; }
    const seat = seatOf(room, ws);
    if (seat < 0) return true;
    room.touched = Date.now();
    switch (type) {
      case 'maddbot': {
        if (room.phase !== 'lobby' || seat !== hostSeat(room) || room.seats.length >= MAX) return true;
        room.seats.push({ kind: 'bot', level: botLevel(msg.level), name: botName(room), skins: {} });
        push(room); return true;
      }
      case 'mrembot': {
        const k = Number(msg.seat);
        if (room.phase !== 'lobby' || seat !== hostSeat(room) || !room.seats[k] || room.seats[k].kind !== 'bot') return true;
        removeSeat(room, k); push(room); return true;
      }
      case 'mstart': {
        if (room.phase !== 'lobby' || seat !== hostSeat(room)) return true;
        if (room.seats.length < M.MIN_PLAYERS) { send(ws, { type: 'error', multi: true, message: 'You need at least 2 players. Invite a friend or add a bot.' }); return true; }
        startGame(room); return true;
      }
      case 'mpick': {
        if (room.phase !== 'pick' || room.picks[seat] != null || !room.game.players[seat].alive) return true;
        const pick = { id: String(msg.id || '') };
        if (msg.copy != null) pick.copy = Number(msg.copy);
        const err = M.checkPick(room.game, seat, pick);
        if (err) { send(ws, { type: 'error', multi: true, message: err }); return true; }
        const p = room.game.players[seat].hand.find((x) => x.id === pick.id);
        if (p.type !== 'joker') delete pick.copy;
        room.picks[seat] = pick;
        settle(room); return true;
      }
      case 'mnext': {
        if (room.phase !== 'result') return true;
        room.ready[seat] = true; settle(room); return true;
      }
      case 'magain': {
        if (room.phase !== 'over' || seat !== hostSeat(room)) return true;
        // Back to the lobby with whoever is still here, plus the bots.
        room.seats = room.seats.filter((s) => s.kind === 'bot' ? !s.replaced : isOn(s));
        room.seats.forEach((s) => { if (s.kind === 'human') s.offlineSince = 0; });
        room.phase = 'lobby'; room.game = null; room.picks = []; room.ready = [];
        push(room); return true;
      }
      case 'mleave': {
        drop(room, seat); send(ws, { type: 'mleft' }); return true;
      }
    }
    return type[0] === 'm';
  }

  // Called when a socket closes (not a deliberate leave): the seat is kept so the player can reconnect.
  function onClose(ws) {
    const room = ws.mroom;
    if (!room) return;
    const seat = seatOf(room, ws);
    if (seat < 0) return;
    room.seats[seat].offlineSince = Date.now();
    if (room.phase === 'lobby') {
      // Nobody can wait in a lobby they have left: free the seat after a short grace period (sweep).
    }
    push(room);
  }

  // Run every few seconds. Replaces players who stayed away too long and cleans up empty rooms.
  function sweep(now, ttl) {
    rooms.forEach((room, code) => {
      if (!room.seats.some((s) => s.kind === 'human')) { clearTimeout(room.timer); rooms.delete(code); return; }
      const idle = !room.seats.some(isOn);
      if (idle && now - room.touched > 10 * 60 * 1000) { clearTimeout(room.timer); rooms.delete(code); return; }
      if (now - room.touched > ttl) { clearTimeout(room.timer); rooms.delete(code); return; }
      for (let i = room.seats.length - 1; i >= 0; i--) {
        const s = room.seats[i];
        if (!s || s.kind !== 'human' || isOn(s)) continue;
        if (!s.offlineSince) { s.offlineSince = now; continue; }
        if (now - s.offlineSince > OFFLINE_MS) { drop(room, i); if (!rooms.has(code)) return; }
      }
    });
  }

  return { rooms: rooms, handle: handle, onClose: onClose, sweep: sweep };
}

module.exports = { createMulti, OFFLINE_MS };
