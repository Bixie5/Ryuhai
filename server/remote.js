/* Ryuhai - remote shop copy on GitHub.
 *
 * The shop admin saves skins on this computer AND mirrors them (images + catalog.json) into a public
 * GitHub repository. GitHub serves those files for free, around the clock, so the game can load the
 * shop from there even when this computer is off.
 *
 * Settings (environment variables):
 *   REMOTE_GITHUB_REPO    "owner/name" of the repository that holds the skins   (required to turn this on)
 *   REMOTE_GITHUB_TOKEN   a fine-grained access token with "Contents: Read and write" on that repo only
 *   REMOTE_GITHUB_BRANCH  default "main"
 *   REMOTE_GITHUB_DIR     folder inside the repo, default "" (the top of the repo)
 *   REMOTE_GITHUB_API     default https://api.github.com (only changed in tests)
 *
 * The token stays on the server. It is never sent to a browser or written to any file.
 */

const IMG_RE = /^art\/[a-z0-9._-]+$/;

function createRemote(opts) {
  opts = opts || {};
  const repo = String(opts.repo || '').trim();
  const token = String(opts.token || '').trim();
  const branch = String(opts.branch || 'main').trim() || 'main';
  const dir = String(opts.dir || '').replace(/^\/+|\/+$/g, '');
  const api = String(opts.api || 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const enabled = !!(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && token && doFetch);
  const p = (rel) => (dir ? dir + '/' : '') + rel;
  const rawBase = enabled ? 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + (dir ? dir + '/' : '') : '';

  const st = { state: enabled ? 'idle' : 'off', lastOk: 0, error: '', last: null };
  let running = false, pending = false;
  let getItems = null, readImage = null;

  class RemoteError extends Error { constructor(m, status) { super(m); this.status = status; } }

  async function gh(method, path, body) {
    const res = await doFetch(api + '/repos/' + repo + '/' + path, {
      method: method,
      headers: Object.assign({
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ryuhai-admin'
      }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, ok: res.ok, data: data };
  }
  function explain(r, what) {
    const m = (r.data && r.data.message) || '';
    if (r.status === 401) return 'GitHub rejected the token (expired or wrong). Make a new one and update REMOTE_GITHUB_TOKEN.';
    if (r.status === 403) return 'GitHub refused (' + (m || 'permission or rate limit') + '). The token needs "Contents: Read and write" on ' + repo + '.';
    if (r.status === 404) return 'GitHub could not find ' + repo + ' (branch "' + branch + '"). Check the repository name, that it exists, and that the token can access it.';
    return 'GitHub error ' + r.status + ' while ' + what + (m ? ': ' + m : '') + '.';
  }
  async function need(r, what) { if (!r.ok) throw new RemoteError(explain(r, what), r.status); return r; }

  const q = '?ref=' + encodeURIComponent(branch);
  const enc = (s) => s.split('/').map(encodeURIComponent).join('/');

  async function listDir(rel) {
    const r = await gh('GET', 'contents/' + enc(p(rel)) + q);
    if (r.status === 404 && /not found/i.test((r.data && r.data.message) || '')) {
      // Either the folder is missing (fine, empty) or the repo/branch is wrong. Check the repo itself to tell which.
      const repoCheck = await gh('GET', 'branches/' + encodeURIComponent(branch));
      if (!repoCheck.ok) await need(repoCheck, 'looking for the branch');
      return {};
    }
    await need(r, 'listing ' + rel);
    const out = {};
    (Array.isArray(r.data) ? r.data : []).forEach((f) => { if (f.type === 'file') out[f.name] = f.sha; });
    return out;
  }
  async function getFile(rel) {   // -> {sha, text} | null
    const r = await gh('GET', 'contents/' + enc(p(rel)) + q);
    if (r.status === 404) return null;
    await need(r, 'reading ' + rel);
    const d = r.data || {};
    let text = null;
    if (d.encoding === 'base64' && typeof d.content === 'string') text = Buffer.from(d.content, 'base64').toString('utf8');
    return { sha: d.sha, text: text };
  }
  async function putFile(rel, buf, sha, msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await gh('PUT', 'contents/' + enc(p(rel)), { message: msg, content: Buffer.from(buf).toString('base64'), branch: branch, sha: sha || undefined });
      if (r.ok) return r;
      if ((r.status === 409 || r.status === 422) && attempt === 0) {   // someone changed it meanwhile: refetch the sha and try once more
        const cur = await getFile(rel); sha = cur ? cur.sha : undefined; continue;
      }
      await need(r, 'saving ' + rel);
    }
  }
  async function delFile(rel, sha, msg) {
    const r = await gh('DELETE', 'contents/' + enc(p(rel)), { message: msg, sha: sha, branch: branch });
    if (!r.ok && r.status !== 404 && r.status !== 422) await need(r, 'deleting ' + rel);
  }

  // Make the remote copy match the local shop. Safe to run any number of times.
  async function syncOnce(items, readImg) {
    const sum = { uploaded: 0, deleted: 0, catalog: false };
    const remoteArt = await listDir('art');
    const wanted = {};
    items.forEach((it) => { if (IMG_RE.test(it.image)) wanted[it.image.slice(4)] = it; });
    for (const name of Object.keys(wanted)) {
      if (remoteArt[name]) continue;
      const buf = readImg(wanted[name].image);
      if (!buf) continue;
      await putFile('art/' + name, buf, null, 'Add skin image ' + name);
      sum.uploaded++;
    }
    const text = JSON.stringify({ items: items }, null, 2) + '\n';
    const cur = await getFile('catalog.json');
    if (!cur || cur.text !== text) { await putFile('catalog.json', Buffer.from(text), cur && cur.sha, 'Update shop catalog'); sum.catalog = true; }
    for (const name of Object.keys(remoteArt)) {
      if (wanted[name]) continue;
      await delFile('art/' + name, remoteArt[name], 'Remove unused skin image ' + name);
      sum.deleted++;
    }
    return sum;
  }

  async function run() {
    if (running) { pending = true; return; }
    running = true; st.state = 'syncing';
    try {
      do {
        pending = false;
        st.last = await syncOnce(getItems(), readImage);
        st.lastOk = Date.now(); st.error = '';
      } while (pending);
      st.state = 'ok';
    } catch (e) {
      st.state = 'error'; st.error = e.message || 'Could not reach GitHub.';
      if (!(e instanceof RemoteError)) st.error = 'Could not reach GitHub (' + (e.message || 'network error') + ').';
    }
    running = false;
  }

  // Download the remote catalog and images (used to rebuild the local shop after a fresh start).
  async function fetchAll() {
    const cur = await getFile('catalog.json');
    if (!cur || !cur.text) return { items: [], images: {} };
    let cat; try { cat = JSON.parse(cur.text); } catch (e) { return { items: [], images: {} }; }
    const items = Array.isArray(cat.items) ? cat.items : [];
    const images = {};
    for (const it of items) {
      if (!it || !IMG_RE.test(String(it.image))) continue;
      const r = await doFetch(api + '/repos/' + repo + '/contents/' + enc(p(it.image)) + q, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ryuhai-admin' } });
      if (r.ok) images[it.image] = Buffer.from(await r.arrayBuffer());
    }
    return { items: items, images: images };
  }

  return {
    enabled: enabled,
    rawBase: rawBase,
    // Tell the remote about the shop. `items()` returns the current list, `image(rel)` returns the file bytes (or null).
    attach(itemsFn, imageFn) { getItems = itemsFn; readImage = imageFn; },
    request() { if (!enabled || !getItems) return Promise.resolve(); return run(); },
    fetchAll: fetchAll,
    status() { return { enabled: enabled, repo: enabled ? repo : '', branch: branch, dir: dir, url: rawBase, state: st.state, lastOk: st.lastOk, error: st.error, last: st.last }; }
  };
}

function fromEnv(env) {
  env = env || process.env;
  return createRemote({ repo: env.REMOTE_GITHUB_REPO, token: env.REMOTE_GITHUB_TOKEN, branch: env.REMOTE_GITHUB_BRANCH, dir: env.REMOTE_GITHUB_DIR, api: env.REMOTE_GITHUB_API });
}

module.exports = { createRemote, fromEnv };
