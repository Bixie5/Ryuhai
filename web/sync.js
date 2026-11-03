/* Ryuhai - cloud save. Talks to the server's /api/account/* routes and keeps this device's
 * progress (bananas, points, record, skins) in step with the player's account.
 *
 * Two devices can change things while apart, so every save is a 3-way merge:
 *   base   = what this device and the cloud last agreed on
 *   local  = what this device has now
 *   server = what the cloud has now
 * Numbers merge as server + (local - base) so both devices' games count; skins are combined.
 */
(function () {
  'use strict';
  var KEYS = { token: 'hc_acct_token', user: 'hc_acct_user', rev: 'hc_acct_rev', base: 'hc_acct_base' };
  var EMPTY = { bananas: 0, points: 0, record: { w: 0, l: 0, d: 0 }, owned: [], equipped: {}, bananaLast: '', pointsLast: '' };

  var cfg = null;          // { base(): url prefix or null, read(): data, write(data), store, onChange(), onNotice(text) }
  var status = 'out';      // out | idle | syncing | ok | error
  var lastOk = 0, lastErr = '';
  var timer = null, busy = false, again = false, applying = false;

  function get(k) { return cfg.store.get(k); }
  function set(k, v) { cfg.store.set(k, v); }
  function parse(s, d) { try { var v = JSON.parse(s); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  function norm(d) {
    d = d || {};
    var r = d.record || {};
    return {
      bananas: +d.bananas || 0, points: +d.points || 0,
      record: { w: +r.w || 0, l: +r.l || 0, d: +r.d || 0 },
      owned: (d.owned || []).slice().sort(),
      equipped: sortKeys(d.equipped || {}),
      bananaLast: d.bananaLast || '', pointsLast: d.pointsLast || ''
    };
  }
  function sortKeys(o) { var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function hasProgress(d) { d = norm(d); return d.bananas !== 0 || d.points !== 0 || d.record.w + d.record.l + d.record.d > 0 || d.owned.length > 0; }

  function merge(local, base, server) {
    local = norm(local); base = norm(base); server = norm(server);
    var out = {
      bananas: server.bananas + (local.bananas - base.bananas),
      points: server.points + (local.points - base.points),
      record: {
        w: Math.max(0, server.record.w + (local.record.w - base.record.w)),
        l: Math.max(0, server.record.l + (local.record.l - base.record.l)),
        d: Math.max(0, server.record.d + (local.record.d - base.record.d))
      },
      owned: server.owned.slice(),
      equipped: {},
      bananaLast: local.bananaLast, pointsLast: local.pointsLast
    };
    local.owned.forEach(function (id) { if (out.owned.indexOf(id) === -1) out.owned.push(id); });
    var pieces = {};
    Object.keys(server.equipped).concat(Object.keys(local.equipped), Object.keys(base.equipped)).forEach(function (p) { pieces[p] = 1; });
    Object.keys(pieces).forEach(function (p) {
      var v = local.equipped[p] !== base.equipped[p] ? local.equipped[p] : server.equipped[p];
      if (v) out.equipped[p] = v;
    });
    return out;
  }

  // ----- network -----
  function request(method, path, body, token) {
    var base = cfg.base();
    if (base === null) return Promise.reject(netErr('Set the server address first (Server, bottom of the menu).'));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(base + 'api/account/' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; e.body = j; throw e; }
          return j;
        });
      }, function () { throw netErr('Could not reach the server. Check the address and your connection.'); })
      .then(function (j) { if (t) clearTimeout(t); return j; }, function (e) { if (t) clearTimeout(t); throw e; });
  }
  function netErr(m) { var e = new Error(m); e.network = true; return e; }

  // ----- state -----
  function token() { return get(KEYS.token); }
  function signedIn() { return !!token(); }
  function username() { return get(KEYS.user); }
  function setStatus(s, err) { status = s; if (err !== undefined) lastErr = err; if (s === 'ok') lastOk = Date.now(); if (cfg && cfg.onChange) cfg.onChange(); }
  function saveSession(res) {
    set(KEYS.token, res.token || token()); set(KEYS.user, res.username || username());
    set(KEYS.rev, String(res.rev)); set(KEYS.base, JSON.stringify(res.data));
  }
  function clearSession() { [KEYS.token, KEYS.user, KEYS.rev, KEYS.base].forEach(function (k) { cfg.store.remove(k); }); }
  function writeLocal(d) { applying = true; try { cfg.write(d); } finally { applying = false; } }

  // ----- sign in / out -----
  function register(name, pw) {
    var local = cfg.read();
    return request('POST', 'register', { username: name, password: pw, data: local }).then(function (res) {
      saveSession(res); writeLocal(res.data); setStatus('ok', ''); return { done: true };
    });
  }
  // Resolves { done:true } or { choice:true, local, cloud, res } when both sides have different progress.
  function login(name, pw) {
    return request('POST', 'login', { username: name, password: pw }).then(function (res) {
      var local = cfg.read();
      if (!hasProgress(local) || same(local, res.data)) { saveSession(res); writeLocal(res.data); setStatus('ok', ''); return { done: true }; }
      if (!hasProgress(res.data)) { return upload(res, local).then(function () { return { done: true }; }); }
      return { choice: true, local: local, cloud: res.data, res: res };
    });
  }
  function upload(res, data) {
    saveSession(res);
    return request('PUT', 'data', { rev: res.rev, data: data }, res.token).then(function (r) {
      set(KEYS.rev, String(r.rev)); set(KEYS.base, JSON.stringify(r.data)); writeLocal(r.data); setStatus('ok', '');
    });
  }
  function resolve(kind, pending) {
    var res = pending.res;
    if (kind === 'cloud') { saveSession(res); writeLocal(res.data); setStatus('ok', ''); return Promise.resolve(); }
    if (kind === 'device') return upload(res, pending.local);
    return upload(res, merge(pending.local, EMPTY, res.data)); // combine
  }
  function logout() {
    var t = token();
    return push(true).catch(function () {}).then(function () {
      clearSession(); setStatus('out', '');
      if (t) request('POST', 'logout', {}, t).catch(function () {});
    });
  }
  function deleteAccount(pw) {
    return request('POST', 'delete', { password: pw }, token()).then(function () { clearSession(); setStatus('out', ''); });
  }

  // ----- syncing -----
  function handleAuthLost() { clearSession(); setStatus('out', ''); if (cfg.onNotice) cfg.onNotice('You were signed out. Sign in again to keep saving online.'); }

  function reconcile(server) {
    // server = {rev, data}. Merge into local, remember the agreement.
    var merged = merge(cfg.read(), parse(get(KEYS.base), EMPTY), server.data);
    set(KEYS.rev, String(server.rev)); set(KEYS.base, JSON.stringify(server.data));
    if (!same(merged, cfg.read())) writeLocal(merged);
    return merged;
  }

  // Send local changes (if any). Resolves when settled.
  function push(quiet) {
    if (!signedIn()) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    var local = cfg.read(), base = parse(get(KEYS.base), EMPTY);
    if (same(local, base)) { if (status !== 'ok') setStatus('ok'); return Promise.resolve(); }
    busy = true; if (!quiet) setStatus('syncing');
    function attempt(tries) {
      return request('PUT', 'data', { rev: parseInt(get(KEYS.rev), 10) || 0, data: cfg.read() }, token()).then(function (r) {
        set(KEYS.rev, String(r.rev)); set(KEYS.base, JSON.stringify(r.data));
      }, function (e) {
        if (e.status === 409 && tries < 3) { reconcile(e.body); return attempt(tries + 1); }
        throw e;
      });
    }
    return attempt(0).then(function () { busy = false; setStatus('ok', ''); if (again) { again = false; return push(true); } },
      function (e) {
        busy = false; again = false;
        if (e.status === 401) { handleAuthLost(); return; }
        setStatus('error', e.message);
      });
  }

  // Fetch the cloud copy and merge it in.
  function pull() {
    if (!signedIn()) return Promise.resolve();
    setStatus('syncing');
    return request('GET', 'data', null, token()).then(function (r) {
      reconcile(r);
      return push(true);
    }).then(function () { setStatus('ok', ''); }, function (e) {
      if (e.status === 401) { handleAuthLost(); return; }
      setStatus('error', e.message);
    });
  }
  function syncNow() { return pull(); }

  // Called whenever a saved value changes on this device.
  function dirty() {
    if (!cfg || applying || !signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { push(); }, 1500);
  }

  function init(c) {
    cfg = c;
    status = signedIn() ? 'idle' : 'out';
    document.addEventListener('visibilitychange', function () {
      if (!signedIn()) return;
      if (document.hidden) { clearTimeout(timer); push(true); } else pull();
    });
    window.addEventListener('online', function () { if (signedIn()) pull(); });
    if (signedIn()) pull();
  }

  window.HCSync = {
    init: init, dirty: dirty, register: register, login: login, resolve: resolve, logout: logout,
    deleteAccount: deleteAccount, syncNow: syncNow, signedIn: signedIn, username: username,
    state: function () { return { status: status, lastOk: lastOk, error: lastErr }; },
    _merge: merge
  };
})();
