/* Ryuhai - room server. Serves the web client and relays two-player games over WebSocket. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('../shared/engine');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

function createServer(opts) {
  opts = opts || {};
  const rooms = new Map(); // code -> room
  const ROOM_TTL = 1000 * 60 * 60 * 3;

  const server = http.createServer((req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url === '/') url = '/web/index.html';
    let file;
    if (url.startsWith('/shared/')) file = path.join(ROOT, url);
    else if (url.startsWith('/web/')) file = path.join(ROOT, url);
    else file = path.join(ROOT, 'web', url);
    if (!path.resolve(file).startsWith(ROOT) || file.includes('..')) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const newCode = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const cleanName = (n, fallback) => String(n || '').replace(/[^\w \-.']/g, '').trim().slice(0, 16) || fallback;

  function pushState(room) {
    [0, 1].forEach((seat) => {
      const p = room.players[seat];
      if (!p) return;
      const locked = [room.picks[0] != null, room.picks[1] != null];
      send(p.ws, {
        type: 'state',
        code: room.code,
        names: room.players.map((q, i) => (q ? q.name : 'Waiting...')),
        connected: room.players.map((q) => !!(q && q.ws && q.ws.readyState === 1)),
        started: !!room.game,
        rematch: room.rematch,
        phase: room.phase,
        next: { you: !!room.nextReady[seat], opp: !!room.nextReady[1 - seat] },
        view: room.game ? E.viewFor(room.game, seat, locked) : null
      });
    });
  }

  function openRooms() {
    const list = [];
    rooms.forEach((r) => { if (r.isPublic && !r.players[1] && r.players[0]) list.push({ code: r.code, host: r.players[0].name }); });
    return list;
  }

  function startGame(room) {
    room.game = E.createGame();
    room.picks = [null, null];
    room.rematch = [false, false];
    room.phase = 'pick';
    room.nextReady = [false, false];
    pushState(room);
  }

  function seatOf(room, ws) { return room.players.findIndex((p) => p && p.ws === ws); }

  function handle(ws, msg) {
    switch (msg.type) {
      case 'list': return send(ws, { type: 'rooms', rooms: openRooms() });
      case 'create': {
        const code = newCode();
        const token = crypto.randomBytes(12).toString('hex');
        const room = { code, players: [{ ws, name: cleanName(msg.name, 'Player 1'), token }, null], picks: [null, null], game: null, rematch: [false, false], phase: 'pick', nextReady: [false, false], isPublic: msg.isPublic !== false, touched: Date.now() };
        rooms.set(code, room);
        ws.room = room;
        send(ws, { type: 'joined', code, seat: 0, token });
        return pushState(room);
      }
      case 'join': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return send(ws, { type: 'error', message: 'No room with that code.' });
        if (room.players[1]) return send(ws, { type: 'error', message: 'That room is already full.' });
        const token = crypto.randomBytes(12).toString('hex');
        room.players[1] = { ws, name: cleanName(msg.name, 'Player 2'), token };
        ws.room = room;
        room.touched = Date.now();
        send(ws, { type: 'joined', code: room.code, seat: 1, token });
        return startGame(room);
      }
      case 'resume': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const seat = room ? room.players.findIndex((p) => p && p.token === msg.token) : -1;
        if (seat < 0) return send(ws, { type: 'error', message: 'That game is no longer available.', fatal: true });
        room.players[seat].ws = ws;
        ws.room = room;
        send(ws, { type: 'joined', code: room.code, seat, token: msg.token });
        return pushState(room);
      }
      case 'pick': {
        const room = ws.room;
        if (!room || !room.game || room.game.over || room.phase !== 'pick') return;
        const seat = seatOf(room, ws);
        if (seat < 0 || room.picks[seat] != null) return;
        if (!room.game.hands[seat].some((p) => p.id === msg.id)) return send(ws, { type: 'error', message: 'You cannot play that piece.' });
        room.picks[seat] = msg.id;
        room.touched = Date.now();
        if (room.picks[0] != null && room.picks[1] != null) {
          room.game = E.play(room.game, room.picks[0], room.picks[1]);
          room.picks = [null, null];
          // After every round both players review the result, then each presses "Next turn".
          room.phase = room.game.over ? 'pick' : 'result';
          room.nextReady = [false, false];
        }
        return pushState(room);
      }
      case 'next': {
        const room = ws.room;
        if (!room || !room.game || room.game.over || room.phase !== 'result') return;
        const seat = seatOf(room, ws);
        if (seat < 0) return;
        room.nextReady[seat] = true;
        if (room.nextReady[0] && room.nextReady[1]) { room.phase = 'pick'; room.nextReady = [false, false]; }
        room.touched = Date.now();
        return pushState(room);
      }
      case 'rematch': {
        const room = ws.room;
        if (!room || !room.game || !room.game.over) return;
        const seat = seatOf(room, ws);
        if (seat < 0) return;
        room.rematch[seat] = true;
        if (room.rematch[0] && room.rematch[1]) return startGame(room);
        return pushState(room);
      }
      case 'leave': return leave(ws, true);
      case 'ping': return send(ws, { type: 'pong' });
    }
  }

  function leave(ws, explicit) {
    const room = ws.room;
    if (!room) return;
    const seat = seatOf(room, ws);
    if (seat < 0) return;
    if (explicit) {
      const other = room.players[1 - seat];
      room.players[seat] = null;
      ws.room = null;
      if (!other) rooms.delete(room.code);
      else {
        send(other.ws, { type: 'opponent_left' });
        rooms.delete(room.code);
        other.ws.room = null;
      }
    } else {
      pushState(room);
    }
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg && typeof msg.type === 'string') { try { handle(ws, msg); } catch (e) { send(ws, { type: 'error', message: 'Something went wrong.' }); } }
    });
    ws.on('close', () => leave(ws, false));
  });

  const timer = setInterval(() => {
    wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
    const now = Date.now();
    rooms.forEach((r, code) => {
      const anyone = r.players.some((p) => p && p.ws && p.ws.readyState === 1);
      if (!anyone && now - r.touched > 1000 * 60 * 10) rooms.delete(code);
      else if (now - r.touched > ROOM_TTL) rooms.delete(code);
    });
  }, 15000);
  server.on('close', () => clearInterval(timer));
  return { server, wss, rooms };
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((n) => (nets[n] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log('\nRyuhai is running.\n');
    console.log('  This computer:   http://localhost:' + port);
    lanAddresses().forEach((ip) => console.log('  Same Wi-Fi/LAN:  http://' + ip + ':' + port));
    console.log('\nShare the LAN address with the other player, then create or join a room.\n');
  });
}

module.exports = { createServer, lanAddresses };
