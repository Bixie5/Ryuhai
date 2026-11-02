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

  function img(type, cls) {
    return '<img class="art ' + cls + '" src="art/' + type + '.webp" alt="' + type + '" draggable="false">';
  }

  root.HCArt = {
    META: META,
    color: function (t) { return META[t].color; },
    glow: function (t) { return META[t].glow; },
    kanji: function (t) { return META[t].kanji; },
    title: function (t) { return META[t].title; },
    portrait: function (t) { return img(t, 'full'); },
    face: function (t) { return '<img class="art face" src="art/' + t + '_face.webp" alt="' + t + '" draggable="false">'; },
    // Warm the cache so reveals never show a half-loaded card.
    preload: function () { Object.keys(META).forEach(function (t) { var i = new Image(); i.src = 'art/' + t + '.webp'; var f = new Image(); f.src = 'art/' + t + '_face.webp'; }); }
  };
  if (typeof Image !== 'undefined') root.HCArt.preload();
})(typeof self !== 'undefined' ? self : this);
