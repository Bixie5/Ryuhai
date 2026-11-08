/* Ryuhai - room server. Serves the web client and relays two-player games over WebSocket. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('../shared/engine');
const { createAccounts } = require('./accounts');
const { createShop } = require('./shop');
const { createRemote, fromEnv } = require('./remote');
const { createMulti } = require('./multi');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

function createServer(opts) {
  opts = opts || {};
  const rooms = new Map(); // code -> room
  const ROOM_TTL = 1000 * 60 * 60 * 3;

  // DATA_DIR puts everything that changes while the server runs (accounts, shop skins) in one folder, so one disk/volume keeps it all.
  // If that folder cannot be written (a host that did not mount a disk), keep running with a temporary folder instead of crashing.
  let dataDir = process.env.DATA_DIR || '';
  if (dataDir) {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK); }
    catch (e) {
      const tmp = path.join(os.tmpdir(), 'ryuhai-data');
      console.error('WARNING: cannot write to DATA_DIR (' + dataDir + '): ' + e.message + '\n         Using ' + tmp + ' instead. Accounts and skins will be lost on restart. Attach a persistent disk to keep them.');
      dataDir = tmp;
    }
  }
  const shopDir = opts.shopDir || (dataDir ? path.join(dataDir, 'shop') : path.join(ROOT, 'web', 'shop'));
  const shop = createShop(shopDir);
  // Optional free always-on copy of the shop on GitHub (see server/remote.js). Off unless configured.
  const remote = opts.remote || fromEnv();
  remote.attach(() => shop.list(), (rel) => shop.readImage(rel));
  if (remote.enabled) {
    // A fresh or wiped computer/host: rebuild the local shop from the remote copy first, so nothing is lost.
    const boot = shop.list().length ? remote.request() : remote.fetchAll().then((all) => {
      const n = shop.importAll(all.items, all.images);
      if (n) console.log('Restored ' + n + ' skin(s) from the remote shop.');
      // If some remote skins could not be downloaded, do NOT push: that would erase them from the remote copy.
      if (n < all.items.length) throw new Error('only ' + n + ' of ' + all.items.length + ' remote skins could be restored, so nothing was pushed. Restart to try again.');
      return remote.request();
    });
    Promise.resolve(boot).catch((e) => console.error('Remote shop sync failed:', e.message));
  }
  // Key for the admin page. Set ADMIN_KEY in the environment to keep it the same between runs.
  const adminKey = opts.adminKey || process.env.ADMIN_KEY || crypto.randomBytes(8).toString('hex');
  const keyOk = (k) => { const a = Buffer.from(String(k || '')), b = Buffer.from(adminKey); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  function adminApi(req, res, url) {
    if (!keyOk(req.headers['x-admin-key'])) return json(res, 401, { error: 'Wrong or missing admin key.' });
    const m = url.match(/^\/api\/admin\/(items|check|remote)(?:\/([a-z0-9-]+))?$/);
    if (!m) return json(res, 404, { error: 'Not found' });
    if (m[1] === 'check') return json(res, 200, { ok: true });
    if (m[1] === 'remote') {
      if (req.method === 'POST' && m[2] === 'sync') { remote.request(); return json(res, 200, { remote: remote.status() }); }
      return json(res, 200, { remote: remote.status() });
    }
    const id = m[2];
    if (req.method === 'GET' && !id) return json(res, 200, { items: shop.list(), pieces: shop.PIECES, remote: remote.status() });
    if (req.method === 'DELETE' && id) { try { shop.deleteItem(id); remote.request(); return json(res, 200, { ok: true, remote: remote.status() }); } catch (e) { return json(res, e.status || 500, { error: e.message }); } }
    if ((req.method === 'POST' && !id) || (req.method === 'PUT' && id)) {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { json(res, 413, { error: 'Upload too large.' }); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return json(res, 400, { error: 'Bad request.' }); }
        try { const item = id ? shop.updateItem(id, body) : shop.addItem(body); remote.request(); return json(res, 200, { item: item, remote: remote.status() }); }
        catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not save.' }); }
      });
      return;
    }
    return json(res, 405, { error: 'Method not allowed' });
  }

  // ---------- player accounts (cloud save) ----------
  const accounts = createAccounts(opts.accountsFile || process.env.ACCOUNTS_FILE || path.join(dataDir || path.join(ROOT, 'data'), 'accounts.json'));
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' };
  const cjson = (res, status, obj) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS)); res.end(JSON.stringify(obj)); };
  function accountApi(req, res, url) {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const route = url.slice('/api/account/'.length);
    // Behind a proxy (Render, Fly, Cloudflare...) every request arrives from the proxy, so read the real client address when told to trust it.
    const fwd = process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = fwd || req.socket.remoteAddress || '?';
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const fail = (e) => cjson(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Something went wrong.' }, e.extra || {}));
    const run = (fn) => { Promise.resolve().then(fn).then((r) => cjson(res, 200, r || { ok: true }), fail); };
    if (route === 'ping' && req.method === 'GET') return cjson(res, 200, { ok: true });
    if (route === 'data' && req.method === 'GET') return run(() => accounts.getData(bearer));
    if (route === 'logout' && req.method === 'POST') return run(() => { accounts.logout(bearer); });
    if (req.method !== 'POST' && req.method !== 'PUT') return cjson(res, 405, { error: 'Method not allowed' });
    const chunks = []; let size = 0, dead = false;
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { dead = true; cjson(res, 413, { error: 'Too much data.' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (dead) return;
      let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return cjson(res, 400, { error: 'Bad request.' }); }
      if (!b || typeof b !== 'object') b = {};
      if (route === 'register' && req.method === 'POST') return run(() => accounts.register(b.username, b.password, b.data, ip));
      if (route === 'login' && req.method === 'POST') return run(() => accounts.login(b.username, b.password, ip));
      if (route === 'data' && req.method === 'PUT') return run(() => accounts.putData(bearer, b.data, b.rev));
      if (route === 'delete' && req.method === 'POST') return run(() => accounts.remove(bearer, b.password));
      cjson(res, 404, { error: 'Not found' });
    });
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
    if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.startsWith('/api/admin/')) return adminApi(req, res, url);
    if (url.startsWith('/api/account/')) return accountApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (url === '/') url = '/web/index.html';
    if (url === '/admin') url = '/web/admin.html';
    let file;
    if (url.startsWith('/shared/')) file = path.join(ROOT, url);
    else if (url.startsWith('/web/')) file = path.join(ROOT, url);
    else if (url.startsWith('/shop/') && shopDir !== path.join(ROOT, 'web', 'shop')) file = path.join(shopDir, url.slice('/shop/'.length));
    else file = path.join(ROOT, 'web', url);
    if ((!path.resolve(file).startsWith(ROOT) && !path.resolve(file).startsWith(path.resolve(shopDir))) || file.includes('..')) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      // CORS: the Android app loads pages from file:// and reads the shop catalog and images from this server.
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const multiRooms = new Map();   // multiplayer rooms (2 to 6 players), see server/multi.js
  const newCode = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
      if (!rooms.has(c) && !multiRooms.has(c)) return c;
    }
  };
  // Equipped skins are cosmetic: { piece: skinId }. Only well-formed ids for known pieces are relayed.
  const cleanSkins = (o) => {
    const out = {};
    if (o && typeof o === 'object') shop.PIECES.forEach((p) => { const v = o[p]; if (typeof v === 'string' && /^[a-z0-9-]{1,48}$/.test(v)) out[p] = v; });
    return out;
  };
  const cleanName = (n, fallback) => String(n || '').replace(/[^\w \-.']/g, '').trim().slice(0, 16) || fallback;
  const multi = createMulti({ send: send, cleanName: cleanName, cleanSkins: cleanSkins, newCode: newCode, rooms: multiRooms, autoMs: opts.multiAutoMs });

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
        gid: room.gid,
        oppSkins: (room.players[1 - seat] && room.players[1 - seat].skins) || {},
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
    room.gid = (room.gid || 0) + 1; // lets clients pay out bananas exactly once per game
    pushState(room);
  }

  function seatOf(room, ws) { return room.players.findIndex((p) => p && p.ws === ws); }

  function handle(ws, msg) {
    if (msg.type[0] === 'm' && multi.handle(ws, msg)) return;
    switch (msg.type) {
      case 'list': return send(ws, { type: 'rooms', rooms: openRooms() });
      case 'create': {
        const code = newCode();
        const token = crypto.randomBytes(12).toString('hex');
        const room = { code, players: [{ ws, name: cleanName(msg.name, 'Player 1'), token, skins: cleanSkins(msg.skins) }, null], picks: [null, null], game: null, rematch: [false, false], phase: 'pick', nextReady: [false, false], isPublic: msg.isPublic !== false, touched: Date.now() };
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
        room.players[1] = { ws, name: cleanName(msg.name, 'Player 2'), token, skins: cleanSkins(msg.skins) };
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
    ws.on('close', () => { leave(ws, false); multi.onClose(ws); });
  });

  const timer = setInterval(() => {
    wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
    const now = Date.now();
    multi.sweep(now, ROOM_TTL);
    rooms.forEach((r, code) => {
      const anyone = r.players.some((p) => p && p.ws && p.ws.readyState === 1);
      if (!anyone && now - r.touched > 1000 * 60 * 10) rooms.delete(code);
      else if (now - r.touched > ROOM_TTL) rooms.delete(code);
    });
  }, 15000);
  server.on('close', () => clearInterval(timer));
  return { server, wss, rooms, multi, shop, adminKey };
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((n) => (nets[n] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server, adminKey } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log('\nRyuhai is running.\n');
    console.log('  This computer:   http://localhost:' + port);
    lanAddresses().forEach((ip) => console.log('  Same Wi-Fi/LAN:  http://' + ip + ':' + port));
    console.log('\nShare the LAN address with the other player, then create or join a room.');
    console.log('\nShop admin (add skins, set prices):  http://localhost:' + port + '/admin?key=' + adminKey);
    console.log('Keep that link private. Set ADMIN_KEY in the environment to choose your own key.\n');
  });
}

module.exports = { createServer, lanAddresses };
