/* Ryuhai - shop catalog. Items are alternate artwork ("skins") for one piece each.
 *
 * Data lives in web/shop/:
 *   catalog.json   the list of items (read by the server and by the game over HTTP)
 *   catalog.js     the same data as `window.HC_CATALOG = {...}` (so the bundled Android app can read it offline)
 *   art/           the image files
 *
 * You can edit these files by hand, or use the admin page (/admin) which calls the functions below.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIECES = ['dragon', 'monarch', 'knight', 'wizard', 'knave', 'fool', 'empress', 'joker'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PRICE = 1000000;

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'skin';
}

class ShopError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

function createShop(dir) {
  const artDir = path.join(dir, 'art');
  const jsonFile = path.join(dir, 'catalog.json');
  const jsFile = path.join(dir, 'catalog.js');
  fs.mkdirSync(artDir, { recursive: true });
  let items = [];

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      items = (Array.isArray(j.items) ? j.items : []).filter((it) => it && /^[a-z0-9-]{1,48}$/.test(String(it.id)) && PIECES.indexOf(it.piece) !== -1);
    } catch (e) { items = []; }
  }
  function writeAtomic(file, text) {
    const tmp = file + '.tmp' + process.pid;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  function save() {
    const data = { items: items };
    writeAtomic(jsonFile, JSON.stringify(data, null, 2) + '\n');
    writeAtomic(jsFile, '/* generated from catalog.json - do not edit by hand */\nwindow.HC_CATALOG = ' + JSON.stringify(data) + ';\n');
  }

  function cleanFields(f, partial) {
    const out = {};
    if (!partial || f.name !== undefined) {
      const name = String(f.name == null ? '' : f.name).trim().slice(0, 40);
      if (!name) throw new ShopError('Give the skin a name.');
      out.name = name;
    }
    if (!partial || f.piece !== undefined) {
      if (PIECES.indexOf(f.piece) === -1) throw new ShopError('Pick which piece this skin is for.');
      out.piece = f.piece;
    }
    if (!partial || f.price !== undefined) {
      const price = Number(f.price);
      if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) throw new ShopError('Price must be a whole number of bananas from 0 to ' + MAX_PRICE + '.');
      out.price = price;
    }
    if (!partial || f.description !== undefined) out.description = String(f.description == null ? '' : f.description).trim().slice(0, 140);
    if (f.faceCenter !== undefined || !partial) {
      const fc = Array.isArray(f.faceCenter) ? f.faceCenter : [50, 22];
      const x = Math.max(0, Math.min(100, Number(fc[0]))), y = Math.max(0, Math.min(100, Number(fc[1])));
      out.faceCenter = [isNaN(x) ? 50 : Math.round(x), isNaN(y) ? 22 : Math.round(y)];
    }
    return out;
  }

  function saveImage(id, b64) {
    if (typeof b64 !== 'string' || !b64) throw new ShopError('Choose an image file.');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw new ShopError('That image is empty.');
    if (buf.length > MAX_IMAGE_BYTES) throw new ShopError('Image is too big (max 5 MB).', 413);
    const ext = sniffImage(buf);
    if (!ext) throw new ShopError('Use a PNG, JPG or WEBP image.');
    const name = id + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(artDir, name), buf);
    return 'art/' + name;
  }
  function removeImage(rel) {
    if (typeof rel !== 'string' || !/^art\/[a-z0-9._-]+$/.test(rel)) return;
    try { fs.unlinkSync(path.join(dir, rel)); } catch (e) { /* already gone */ }
  }

  function addItem(f) {
    const fields = cleanFields(f, false);
    let id = slug(fields.name), n = 1;
    while (items.some((it) => it.id === id)) id = slug(fields.name).slice(0, 24) + '-' + (++n);
    const image = saveImage(id, f.image);
    const item = Object.assign({ id: id }, fields, { image: image, added: Date.now() });
    items.push(item);
    save();
    return item;
  }

  function updateItem(id, f) {
    const it = items.find((x) => x.id === id);
    if (!it) throw new ShopError('No such skin.', 404);
    const fields = cleanFields(f, true);
    if (f.image) { const old = it.image; it.image = saveImage(it.id, f.image); removeImage(old); }
    Object.assign(it, fields);
    save();
    return it;
  }

  function deleteItem(id) {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) throw new ShopError('No such skin.', 404);
    const [it] = items.splice(i, 1);
    removeImage(it.image);
    save();
    return it;
  }

  load();
  if (!fs.existsSync(jsonFile) || !fs.existsSync(jsFile)) save();
  return { PIECES, list: () => items.slice(), addItem, updateItem, deleteItem, reload: load, ShopError };
}

module.exports = { createShop, PIECES, ShopError };
