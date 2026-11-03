/* Ryuhai - online accounts. A player picks a username + password and their progress
 * (bananas, PvP points, bought skins, equipped skins) is saved on the server so it can be
 * loaded on any device. Stored in one JSON file (data/accounts.json by default).
 *
 * Passwords are never stored, only a scrypt hash with a per-user salt. Login tokens are random
 * and only their SHA-256 is stored. This is a small-scale system meant for a server you run
 * yourself; the game data is still decided by the player's device (it is a save file, not an
 * anti-cheat system).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIECES = ['dragon', 'monarch', 'knight', 'wizard', 'knave', 'fool', 'empress', 'joker'];
const SESSION_MS = 90 * 24 * 3600 * 1000;
const MAX_SESSIONS = 10;
const ID_RE = /^[a-z0-9-]{1,48}$/;

class AccountError extends Error {
  constructor(message, status, extra) { super(message); this.status = status || 400; this.extra = extra || null; }
}

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? rej(e) : res(k))));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const int = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };

// Keep only the fields we know, with safe types and sizes.
function cleanData(d) {
  d = d && typeof d === 'object' ? d : {};
  const rec = d.record && typeof d.record === 'object' ? d.record : {};
  const owned = Array.isArray(d.owned) ? d.owned.filter((x) => typeof x === 'string' && ID_RE.test(x)) : [];
  const equipped = {};
  if (d.equipped && typeof d.equipped === 'object' && !Array.isArray(d.equipped)) {
    PIECES.forEach((p) => { const v = d.equipped[p]; if (typeof v === 'string' && ID_RE.test(v)) equipped[p] = v; });
  }
  return {
    bananas: int(d.bananas, -1e9, 1e9),
    points: int(d.points, -1e9, 1e9),
    record: { w: int(rec.w, 0, 1e9), l: int(rec.l, 0, 1e9), d: int(rec.d, 0, 1e9) },
    owned: Array.from(new Set(owned)).slice(0, 500),
    equipped: equipped,
    bananaLast: String(d.bananaLast || '').slice(0, 80),
    pointsLast: String(d.pointsLast || '').slice(0, 80)
  };
}

function createAccounts(file) {
  let users = {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.users && typeof j.users === 'object') users = j.users;
  } catch (e) { users = {}; }

  let saving = false, again = false;
  function save() {
    if (saving) { again = true; return; }
    saving = true;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ users: users }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) { console.error('Could not save accounts:', e.message); }
    saving = false;
    if (again) { again = false; save(); }
  }

  // --- rate limits (in memory) ---
  const fails = new Map();   // "ip|name" -> {n, until}
  const regs = new Map();    // ip -> [timestamps]
  function checkLocked(key) {
    const f = fails.get(key);
    if (f && f.until > Date.now()) throw new AccountError('Too many tries. Wait a minute and try again.', 429);
  }
  function noteFail(key) {
    const f = fails.get(key) || { n: 0, until: 0 };
    if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
    f.n += 1;
    if (f.n >= 5) { f.until = Date.now() + 60 * 1000; f.n = 0; }
    fails.set(key, f);
  }

  function validName(name) {
    name = String(name == null ? '' : name).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) throw new AccountError('Username must be 3 to 20 letters, numbers or underscores.');
    return name;
  }
  function validPass(pw) {
    pw = String(pw == null ? '' : pw);
    if (pw.length < 6) throw new AccountError('Password must be at least 6 characters.');
    if (pw.length > 100) throw new AccountError('Password is too long (max 100).');
    return pw;
  }

  function newSession(u) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    u.sessions = (u.sessions || []).filter((s) => s.exp > now);
    u.sessions.push({ h: sha(token), exp: now + SESSION_MS });
    if (u.sessions.length > MAX_SESSIONS) u.sessions = u.sessions.slice(-MAX_SESSIONS);
    return token;
  }
  const out = (u, token) => ({ token: token, username: u.name, rev: u.rev, data: u.data });

  async function register(name, password, data, ip) {
    name = validName(name); password = validPass(password);
    const now = Date.now(), list = (regs.get(ip) || []).filter((t) => now - t < 3600 * 1000);
    if (list.length >= 20) throw new AccountError('Too many new accounts from this connection. Try again later.', 429);
    const key = name.toLowerCase();
    if (users[key]) throw new AccountError('That username is taken.', 409);
    list.push(now); regs.set(ip, list);
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt);
    if (users[key]) throw new AccountError('That username is taken.', 409);
    const u = { name: name, salt: salt.toString('hex'), hash: hash.toString('hex'), created: now, rev: 1, data: cleanData(data), sessions: [] };
    users[key] = u;
    const token = newSession(u);
    save();
    return out(u, token);
  }

  async function login(name, password, ip) {
    const key = String(name || '').trim().toLowerCase();
    const lk = ip + '|' + key;
    checkLocked(lk);
    const u = users[key];
    // Do the hash either way so a missing user can't be told apart by timing.
    const salt = u ? Buffer.from(u.salt, 'hex') : crypto.randomBytes(16);
    const hash = await scrypt(String(password == null ? '' : password).slice(0, 100), salt);
    const ok = u && crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'));
    if (!ok) { noteFail(lk); throw new AccountError('Wrong username or password.', 401); }
    fails.delete(lk);
    const token = newSession(u);
    save();
    return out(u, token);
  }

  function find(token) {
    if (typeof token !== 'string' || token.length < 20) return null;
    const h = sha(token), now = Date.now();
    for (const k of Object.keys(users)) {
      const u = users[k];
      if ((u.sessions || []).some((s) => s.h === h && s.exp > now)) return u;
    }
    return null;
  }
  function auth(token) {
    const u = find(token);
    if (!u) throw new AccountError('Please sign in again.', 401);
    return u;
  }

  function getData(token) { const u = auth(token); return { username: u.name, rev: u.rev, data: u.data }; }

  // Save. `baseRev` is the revision the client last saw; a mismatch means another device saved in between.
  function putData(token, data, baseRev) {
    const u = auth(token);
    if (Number(baseRev) !== u.rev) throw new AccountError('Your cloud save changed on another device.', 409, { rev: u.rev, data: u.data });
    u.data = cleanData(data);
    u.rev += 1;
    save();
    return { rev: u.rev, data: u.data };
  }

  function logout(token) {
    const u = find(token); if (!u) return;
    const h = sha(token);
    u.sessions = u.sessions.filter((s) => s.h !== h);
    save();
  }

  async function remove(token, password) {
    const u = auth(token);
    const hash = await scrypt(String(password == null ? '' : password).slice(0, 100), Buffer.from(u.salt, 'hex'));
    if (!crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex'))) throw new AccountError('Wrong password.', 401);
    delete users[u.name.toLowerCase()];
    save();
  }

  return { register, login, getData, putData, logout, remove, cleanData, AccountError, count: () => Object.keys(users).length };
}

module.exports = { createAccounts, cleanData, AccountError };
