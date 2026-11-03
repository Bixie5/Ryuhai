/* Ryuhai - piece artwork. Each piece uses its own illustration (web/art/<piece>.webp).
   art/<piece>_face.webp are the square face crops used for the small chips. */
(function (root) {
  'use strict';

  var META = {
    dragon:  { color: '#ff4b32', glow: '#ffb347', kanji: '竜', title: 'Crimson Sovereign' },
    monarch: { color: '#f0b73c', glow: '#ffe08a', kanji: '王', title: 'The Crowned' },
    knight:  { color: '#9cc4ff', glow: '#e3efff', kanji: '騎', title: 'Silver Vanguard' },
    wizard:  { color: '#a56bff', glow: '#dcc2ff', kanji: '魔', title: 'Star Weaver' },
    knave:   { color: '#e23a5c', glow: '#ff9bb0', kanji: '賊', title: 'Shadow Blade' },
    fool:    { color: '#ffb02e', glow: '#ffe28a', kanji: '愚', title: 'Lucky Jester' },
    empress: { color: '#ff5fa2', glow: '#ffc2dd', kanji: '后', title: 'Rose Empress' },
    joker:   { color: '#e0304a', glow: '#ff8a9b', kanji: '笑', title: 'Wild Card' }
  };

  // ---- shop catalog: alternate artwork ("skins"), one piece per skin ----
  var catalog = { items: [], base: '' }, byId = {};
  function setCatalog(cat, base) {
    catalog.items = (cat && Array.isArray(cat.items)) ? cat.items : [];
    catalog.base = base || '';
    byId = {};
    catalog.items.forEach(function (it) { if (it && it.id && META[it.piece]) byId[it.id] = it; });
  }
  function skinItem(type, id) { var it = id ? byId[id] : null; return it && it.piece === type ? it : null; }
  function imageUrl(it) { return catalog.base + it.image; }

  function img(type, cls, skinId) {
    var it = skinItem(type, skinId);
    if (it) return '<img class="art ' + cls + ' skin" src="' + imageUrl(it) + '" alt="' + type + '" draggable="false" onerror="this.onerror=null;this.src=\'art/' + type + '.webp\'">';
    return '<img class="art ' + cls + '" src="art/' + type + '.webp" alt="' + type + '" draggable="false">';
  }
  // Round face icon. Default art has a ready-made crop; a skin is cropped around its faceCenter
  // (works for any image shape: the point is moved to the middle of the circle, then zoomed).
  function faceHtml(type, skinId) {
    var it = skinItem(type, skinId);
    if (!it) return '<img class="art face" src="art/' + type + '_face.webp" alt="' + type + '" draggable="false">';
    var fc = it.faceCenter || [50, 22];
    return '<span class="art face fcrop"><img src="' + imageUrl(it) + '" alt="' + type + '" draggable="false" style="width:240%;transform:translate(-' + Number(fc[0]) + '%,-' + Number(fc[1]) + '%)"></span>';
  }

  root.HCArt = {
    META: META,
    color: function (t) { return META[t].color; },
    glow: function (t) { return META[t].glow; },
    kanji: function (t) { return META[t].kanji; },
    title: function (t) { return META[t].title; },
    setCatalog: setCatalog,
    items: function () { return catalog.items.filter(function (it) { return byId[it.id]; }); },
    item: function (id) { return byId[id] || null; },
    imageUrl: imageUrl,
    portrait: function (t, skinId) { return img(t, 'full', skinId); },
    face: faceHtml,
    // Warm the cache so reveals never show a half-loaded card.
    preload: function () { Object.keys(META).forEach(function (t) { var i = new Image(); i.src = 'art/' + t + '.webp'; var f = new Image(); f.src = 'art/' + t + '_face.webp'; }); }
  };
  if (typeof Image !== 'undefined') root.HCArt.preload();
})(typeof self !== 'undefined' ? self : this);
