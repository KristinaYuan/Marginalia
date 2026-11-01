// ==UserScript==
// @name         Marginalia
// @namespace    https://github.com/KristinaYuan/Marginalia
// @version      0.1.0
// @description  Highlight, annotate, and revisit the web — a local-first reading companion. Highlight text, attach sticky notes, and browse everything in a unified Library.
// @author       Kristina
// @homepageURL  https://github.com/KristinaYuan/Marginalia
// @supportURL   https://github.com/KristinaYuan/Marginalia
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSIxMiIgZmlsbD0iI2Y1ZDk3OCIvPjxwYXRoIGQ9Ik0yMCAyMGgyNHYyNEgyMHoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9Ii45Ii8+PHBhdGggZD0iTTI4IDI2aDhsMyAwdjEybC0zLTRoLThsLTMtNHoiIGZpbGw9IiMyYzJhMjYiLz48L3N2Zz4=
// ==/UserScript==

/**
 * Marginalia — a cross-browser web highlighting & annotation tool.
 *
 * Layered architecture (per the project brief):
 *   - Compat layer   : storage / menu / clipboard / style-injection abstraction.
 *   - Data model     : Article, Highlight, Note (embedded), Tag.
 *   - Storage layer  : GM_getValue/GM_setValue with a localStorage fallback.
 *   - Annotation eng.: text anchors (quote + prefix/suffix), DOM wrapping, restore.
 *   - UI layer       : selection toolbar, sticky notes, context menu, Library,
 *                      import/export, settings.
 *
 * The UI chrome (toolbar, Library, context menu, floating button) lives inside a
 * Shadow DOM so page styles cannot leak into it. Highlights and sticky notes live
 * in the light DOM because they must anchor to real page content/document
 * coordinates. All app-owned elements are namespaced with `marginalia-`.
 */
(function () {
  'use strict';

  // Guard against double injection (duplicated install, SPA re-injection, iframes).
  if (window.__marginaliaLoaded) return;
  window.__marginaliaLoaded = true;

  // ---------------------------------------------------------------------------
  // 1. Constants
  // ---------------------------------------------------------------------------
  var COLORS = {
    butter: '#F5D978',
    sky: '#A9C9EE',
    lilac: '#C5B1E8',
    rose: '#ECAEBB',
    sage: '#A9D4B5'
  };
  var COLOR_ORDER = ['butter', 'sky', 'lilac', 'rose', 'sage'];
  var STYLES = ['marker', 'underline', 'wavy', 'dotted'];
  var STYLE_LABELS = { marker: 'Marker', underline: 'Underline', wavy: 'Wavy', dotted: 'Dotted' };

  var DATA_KEY = 'marginalia.data.v1';
  var SETTINGS_KEY = 'marginalia.settings.v1';

  var DB_DEFAULT = { schemaVersion: 1, articles: [], highlights: [], tags: [] };
  var SETTINGS_DEFAULT = {
    theme: 'system',                                   // 'system' | 'light' | 'dark'
    visibility: { highlights: true, notes: true, toolbar: true },
    contextMenu: { enabled: true, nativeModifier: 'Alt' }, // '' | 'Alt' | 'Ctrl' | 'Meta' | 'Shift'
    shortcut: 'Alt+Shift+M'
  };

  // ---------------------------------------------------------------------------
  // 2. Small utilities
  // ---------------------------------------------------------------------------
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function nowIso() { return new Date().toISOString(); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function hexToRgba(hex, alpha) {
    var h = (hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) || 0;
    var g = parseInt(h.slice(2, 4), 16) || 0;
    var b = parseInt(h.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function normalizeWS(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function downloadBlob(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // 3. Compatibility layer
  // ---------------------------------------------------------------------------
  var compat = {
    storage: {
      get: function (key, def) {
        try {
          if (typeof GM_getValue === 'function') {
            var v = GM_getValue(key, undefined);
            if (v !== undefined) return v;
            return def;
          }
        } catch (e) { /* fall through */ }
        try {
          var raw = localStorage.getItem('marginalia:' + key);
          return raw == null ? def : JSON.parse(raw);
        } catch (e) { return def; }
      },
      set: function (key, val) {
        try {
          if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
        } catch (e) { /* fall through */ }
        try { localStorage.setItem('marginalia:' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
      },
      del: function (key) {
        try { if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); return; } } catch (e) { /* fall through */ }
        try { localStorage.removeItem('marginalia:' + key); } catch (e) { /* ignore */ }
      }
    },
    clipboard: function (text) {
      if (typeof GM_setClipboard === 'function') {
        try { GM_setClipboard(text); return Promise.resolve(true); } catch (e) { /* fall through */ }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
      // Last-resort fallback.
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve(ok);
      } catch (e) { return Promise.resolve(false); }
    },
    menu: function (label, fn) {
      try {
        if (typeof GM_registerMenuCommand === 'function') {
          GM_registerMenuCommand(label, fn);
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    },
    addStyle: function (css) {
      try {
        if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
      } catch (e) { /* ignore */ }
      var s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  };

  // ---------------------------------------------------------------------------
  // 4. Data model + store
  // ---------------------------------------------------------------------------
  var db = loadDB();
  var settings = loadSettings();
  sanitizeDB();

  function loadDB() {
    var d = compat.storage.get(DATA_KEY, null);
    if (!d || typeof d !== 'object' || !Array.isArray(d.articles)) return clone(DB_DEFAULT);
    d.schemaVersion = d.schemaVersion || 1;
    d.articles = d.articles || [];
    d.highlights = d.highlights || [];
    d.tags = d.tags || [];
    return d;
  }

  function loadSettings() {
    var s = compat.storage.get(SETTINGS_KEY, null);
    var out = clone(SETTINGS_DEFAULT);
    if (s && typeof s === 'object') {
      out.theme = s.theme || out.theme;
      out.visibility = Object.assign({}, out.visibility, s.visibility);
      out.contextMenu = Object.assign({}, out.contextMenu, s.contextMenu);
      out.shortcut = s.shortcut || out.shortcut;
    }
    return out;
  }

  // Fill in any missing/optional fields on records loaded from storage or import.
  function sanitizeDB() {
    db.articles = db.articles || [];
    db.highlights = db.highlights || [];
    db.tags = db.tags || [];
    db.highlights.forEach(function (h) {
      h.tags = Array.isArray(h.tags) ? h.tags : [];
      if (!h.anchor || typeof h.anchor !== 'object') h.anchor = { exact: h.text || '', prefix: '', suffix: '' };
    });
    db.articles.forEach(function (a) {
      a.visibilitySettings = a.visibilitySettings || null;
    });
    // Drop empty article shells left behind by previous deletions.
    db.articles = db.articles.filter(function (a) {
      var hasHl = db.highlights.some(function (h) { return h.articleId === a.id; });
      return hasHl || a.articleNote || a.favorite;
    });
  }

  var saveDB = debounce(function () { compat.storage.set(DATA_KEY, db); }, 150);
  var saveSettings = debounce(function () { compat.storage.set(SETTINGS_KEY, settings); }, 150);

  function flush() {
    compat.storage.set(DATA_KEY, db);
    compat.storage.set(SETTINGS_KEY, settings);
  }

  // --- URL normalization -----------------------------------------------------
  var TRACKING_RE = /^(utm_|fbclid$|gclid$|dclid$|gclsrc$|wbraid$|gbraid$|msclkid$|mc_cid$|mc_eid$|igshid$|spm$)/i;
  function normalizeUrl(raw) {
    try {
      var u = new URL(raw, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
      var keys = Array.from(u.searchParams.keys());
      for (var i = 0; i < keys.length; i++) {
        if (TRACKING_RE.test(keys[i])) u.searchParams.delete(keys[i]);
      }
      u.hash = '';
      return u.href;
    } catch (e) { return raw; }
  }

  function faviconOf() {
    try {
      var link = document.querySelector('link[rel~="icon"]');
      if (link && link.href) return link.href;
      return location.origin + '/favicon.ico';
    } catch (e) { return ''; }
  }

  // --- CRUD helpers ----------------------------------------------------------
  function findArticleByUrl(url) {
    var n = normalizeUrl(url);
    for (var i = 0; i < db.articles.length; i++) {
      if (db.articles[i].url === n) return db.articles[i];
    }
    return null;
  }

  function ensureArticle(url, title) {
    var n = normalizeUrl(url);
    var a = findArticleByUrl(n);
    if (a) return a;
    a = {
      id: uid('art'),
      url: n,
      title: title || document.title || n,
      domain: (function () { try { return new URL(n).hostname; } catch (e) { return ''; } })(),
      favicon: faviconOf(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      articleNote: null,
      favorite: false,
      visibilitySettings: null
    };
    db.articles.push(a);
    saveDB();
    return a;
  }

  function articleById(id) {
    for (var i = 0; i < db.articles.length; i++) if (db.articles[i].id === id) return db.articles[i];
    return null;
  }

  function highlightById(id) {
    for (var i = 0; i < db.highlights.length; i++) if (db.highlights[i].id === id) return db.highlights[i];
    return null;
  }

  function highlightsOfArticle(articleId) {
    return db.highlights.filter(function (h) { return h.articleId === articleId; });
  }

  function deleteHighlight(id) {
    var h = highlightById(id);
    db.highlights = db.highlights.filter(function (x) { return x.id !== id; });
    if (h) pruneArticle(h.articleId); else saveDB();
  }

  function deleteArticle(id) {
    db.articles = db.articles.filter(function (x) { return x.id !== id; });
    db.highlights = db.highlights.filter(function (h) { return h.articleId !== id; });
    saveDB();
  }

  // Remove an article that no longer carries any content, so the Library doesn't
  // show empty "0 highlights" shells after its last highlight/note is deleted.
  function pruneArticle(articleId) {
    var a = articleById(articleId);
    if (a) {
      var hasHl = db.highlights.some(function (h) { return h.articleId === articleId; });
      if (!hasHl && !a.articleNote && !a.favorite) {
        db.articles = db.articles.filter(function (x) { return x.id !== articleId; });
      }
    }
    saveDB();
  }

  function touchArticle(articleId) {
    var a = articleById(articleId);
    if (a) { a.updatedAt = nowIso(); }
  }

  // --- Tags ------------------------------------------------------------------
  function tagById(id) { for (var i = 0; i < db.tags.length; i++) if (db.tags[i].id === id) return db.tags[i]; return null; }
  function tagByName(name) {
    var n = normalizeWS(name).toLowerCase();
    for (var i = 0; i < db.tags.length; i++) if (db.tags[i].name.toLowerCase() === n) return db.tags[i];
    return null;
  }
  function ensureTag(name) {
    var clean = normalizeWS(name);
    if (!clean) return null;
    var t = tagByName(clean);
    if (t) return t;
    t = { id: uid('tag'), name: clean, createdAt: nowIso() };
    db.tags.push(t);
    saveDB();
    return t;
  }
  function deleteTag(id) {
    db.tags = db.tags.filter(function (t) { return t.id !== id; });
    db.highlights.forEach(function (h) {
      if (h.tags) h.tags = h.tags.filter(function (tid) { return tid !== id; });
    });
    saveDB();
  }

  // ---------------------------------------------------------------------------
  // 5. Text anchor engine
  // ---------------------------------------------------------------------------
  function isSensitive(el) {
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' ||
        tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION' ||
        tag === 'BUTTON') return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute && el.hasAttribute('data-marginalia-ui')) return true;
    return false;
  }

  function isSensitiveTextNode(node) {
    var el = node.parentElement;
    while (el && el !== document.documentElement) {
      if (isSensitive(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Normalize a whole string, returning { text, map, rawToNorm }.
  //   map[normIndex]    -> rawIndex of that character
  //   rawToNorm[rawIdx] -> normIndex (nearest) of that raw offset
  function normalizeWithMap(raw) {
    var chars = [];
    var map = [];
    var rawToNorm = new Array(raw.length + 1);
    var i = 0;
    var len = raw.length;
    while (i < len) {
      var ch = raw[i];
      if (/\s/.test(ch)) {
        if (chars.length > 0 && chars[chars.length - 1] !== ' ') {
          chars.push(' ');
          map.push(i);
        }
        i++;
      } else {
        chars.push(ch);
        map.push(i);
        i++;
      }
    }
    var text = chars.join('');
    var last = 0;
    for (var n = 0; n < map.length; n++) rawToNorm[map[n]] = n;
    for (var r = 0; r <= raw.length; r++) {
      if (rawToNorm[r] !== undefined) last = rawToNorm[r];
      else rawToNorm[r] = last;
    }
    return { text: text, map: map, rawToNorm: rawToNorm };
  }

  function buildIndex(root) {
    root = root || document.body;
    var nodes = [];
    var rawFull = '';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (isSensitiveTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var val = n.nodeValue;
      if (!val) continue;
      nodes.push({ node: n, start: rawFull.length, end: rawFull.length + val.length });
      rawFull += val;
    }
    var nm = normalizeWithMap(rawFull);
    return { nodes: nodes, rawFull: rawFull, normText: nm.text, map: nm.map, rawToNorm: nm.rawToNorm };
  }

  // Locate the text node (and offset within it) for a raw offset into rawFull.
  function locateRaw(index, rawOffset) {
    var nodes = index.nodes;
    if (nodes.length === 0) return null;
    if (rawOffset <= nodes[0].start) return { node: nodes[0].node, offset: 0 };
    if (rawOffset >= nodes[nodes.length - 1].end) {
      var lastn = nodes[nodes.length - 1];
      return { node: lastn.node, offset: lastn.node.nodeValue.length };
    }
    var lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (nodes[mid].end <= rawOffset) lo = mid + 1;
      else hi = mid;
    }
    return { node: nodes[lo].node, offset: rawOffset - nodes[lo].start };
  }

  function rawOffsetOf(index, node, offset) {
    var nodes = index.nodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].node === node) return nodes[i].start + offset;
    }
    return -1;
  }

  // Search the index for an anchor; return { range, confidence } or null.
  function findRange(index, anchor) {
    if (!anchor || !anchor.exact) return null;
    var needle = normalizeWS(anchor.exact);
    if (!needle) return null;
    var text = index.normText;

    var starts = [];
    var from = 0;
    var pos;
    while ((pos = text.indexOf(needle, from)) !== -1) {
      starts.push(pos);
      from = pos + 1;
      if (starts.length > 200) break; // safety
    }
    if (starts.length === 0) return null;

    var best = starts[0];
    var bestScore = -1;
    var prefix = normalizeWS(anchor.prefix);
    var suffix = normalizeWS(anchor.suffix);

    for (var i = 0; i < starts.length; i++) {
      var s = starts[i];
      var e = s + needle.length;
      var p = normalizeWS(text.slice(Math.max(0, s - (prefix ? prefix.length + 4 : 0)), s));
      var su = normalizeWS(text.slice(e, e + (suffix ? suffix.length + 4 : 0)));
      var score = 0;
      if (prefix && p === prefix) score += 3;
      if (suffix && su === suffix) score += 3;
      if (typeof anchor.offset === 'number' && Math.abs(s - anchor.offset) <= 40) score += 1;
      if (score > bestScore) { bestScore = score; best = s; }
    }

    var confidence = starts.length === 1 ? 'high' : (bestScore >= 3 ? 'high' : 'low');
    // When several identical passages exist and none matched its surrounding
    // context, refuse to guess rather than attaching to the wrong one.
    if (starts.length > 1 && bestScore < 3) return null;

    var rawStart = index.map[best];
    var rawEnd = index.map[best + needle.length - 1] + 1;
    var start = locateRaw(index, rawStart);
    var end = locateRaw(index, rawEnd);
    if (!start || !end) return null;

    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (e) { return null; }
    return { range: range, confidence: confidence };
  }

  // Wrap the text nodes in `range` with a highlight span, returning the spans.
  function wrapRange(range, hl) {
    var spans = [];
    if (!range || range.collapsed) return spans;
    var sc = range.startContainer, so = range.startOffset;
    var ec = range.endContainer, eo = range.endOffset;

    var root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var ok = false;
        try { ok = range.intersectsNode(node); } catch (e) { ok = false; }
        return ok ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    var cur;
    while ((cur = walker.nextNode())) nodes.push(cur);

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var s = 0, e = node.nodeValue.length;
      if (node === sc) s = so;
      if (node === ec) e = eo;
      if (s >= e) continue;
      var span = splitAndWrap(node, s, e);
      span.className = 'marginalia-hl';
      span.setAttribute('data-marginalia-id', hl.id);
      span.setAttribute('data-style', hl.style);
      span.setAttribute('data-color', hl.color);
      span.style.cssText = hlStyle(hl.style, hl.color);
      spans.push(span);
    }
    return spans;
  }

  function splitAndWrap(node, s, e) {
    var length = node.nodeValue.length;
    var span = document.createElement('span');
    var target;
    if (s === 0 && e === length) {
      target = node;
    } else if (s === 0) {
      node.splitText(e);
      target = node;
    } else if (e === length) {
      target = node.splitText(s);
    } else {
      target = node.splitText(s);
      target.splitText(e - s);
    }
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
    return span;
  }

  function hlStyle(style, color) {
    var hex = COLORS[color] || color || COLORS.butter;
    if (style === 'marker') {
      return 'background:' + hexToRgba(hex, 0.42) + ';border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;';
    }
    var dstyle = style === 'wavy' ? 'wavy' : style === 'dotted' ? 'dotted' : 'solid';
    return 'text-decoration:underline ' + dstyle + ' ' + hex + ' 2px;text-underline-offset:2px;';
  }

  function clearHighlightsDOM() {
    var spans = Array.prototype.slice.call(document.querySelectorAll('span.marginalia-hl'));
    var parents = [];
    spans.forEach(function (s) {
      var parent = s.parentNode;
      if (!parent) return;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      parent.removeChild(s);
      if (parents.indexOf(parent) === -1) parents.push(parent);
    });
    parents.forEach(function (p) {
      try { p.normalize(); } catch (e) { /* ignore */ }
    });
  }

  // Build a highlight's anchor from the current selection/range.
  function anchorFromRange(range, rawExact) {
    var index = buildIndex(document.body);
    var sc = range.startContainer, so = range.startOffset;
    var ec = range.endContainer, eo = range.endOffset;
    var rStart = rawOffsetOf(index, sc, so);
    var rEnd = rawOffsetOf(index, ec, eo);
    if (rStart < 0 || rEnd < 0) return null;

    var nStart = index.rawToNorm[rStart];
    var nEnd = index.rawToNorm[rEnd];

    var prefix = normalizeWS(index.normText.slice(Math.max(0, nStart - 80), nStart));
    var suffix = normalizeWS(index.normText.slice(nEnd, nEnd + 80));

    return {
      exact: rawExact != null ? rawExact : normalizeWS(index.normText.slice(nStart, nEnd)),
      prefix: prefix,
      suffix: suffix,
      offset: nStart
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Highlight rendering
  // ---------------------------------------------------------------------------
  var currentArticleId = null;
  var unresolvedIds = {}; // runtime set of highlights that failed to anchor

  function renderArticle(url) {
    var article = findArticleByUrl(url);
    currentArticleId = article ? article.id : null;
    unresolvedIds = {};

    clearHighlightsDOM();
    clearNotesDOM();
    applyVisibility(article);

    if (article) {
      renderArticleHighlights(article);
      renderArticleNotes(article);
    }
  }

  function renderArticleHighlights(article) {
    var hs = highlightsOfArticle(article.id);
    if (hs.length === 0) return;
    var index = buildIndex(document.body);
    hs.forEach(function (h) {
      var found = findRange(index, h.anchor);
      if (found) {
        wrapRange(found.range, h);
      } else {
        unresolvedIds[h.id] = true;
      }
    });
  }

  function renderArticleNotes(article) {
    if (article.articleNote) renderNote(article.articleNote, { articleId: article.id, highlightId: null });
    highlightsOfArticle(article.id).forEach(function (h) {
      if (h.note) renderNote(h.note, { articleId: article.id, highlightId: h.id });
    });
  }

  // Highlight creation from a selection.
  function createHighlightFromSelection(style, color, opts) {
    opts = opts || {};
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var exact = sel.toString();
    if (!normalizeWS(exact)) return null;

    var article = ensureArticle(location.href, document.title);

    var anchor = anchorFromRange(range, exact);
    if (!anchor) { toast('Cannot annotate this selection (unsupported content).'); return null; }

    var hl = {
      id: uid('hl'),
      articleId: article.id,
      url: article.url,
      title: article.title,
      text: exact,
      style: style,
      color: color,
      note: null,
      tags: [],
      favorite: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      anchor: anchor,
      notePosition: null
    };
    db.highlights.push(hl);
    touchArticle(article.id);
    saveDB();
    wrapRange(range, hl);
    if (opts.withNote) attachNoteToHighlight(hl.id, opts.noteColor);
    return hl;
  }

  function updateHighlightStyle(id, style, color) {
    var h = highlightById(id);
    if (!h) return;
    h.style = style;
    h.color = color;
    h.updatedAt = nowIso();
    saveDB();
    renderArticle(location.href);
  }

  function findOverlappingHighlightIds(range) {
    var ids = [];
    var seen = {};
    // A simple scan of the page's existing highlight spans is cheap (highlights
    // are few) and correctly catches both descendants *and* ancestor spans that
    // a common-ancestor walker would miss.
    var spans = document.querySelectorAll('.marginalia-hl');
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      var id = el.getAttribute('data-marginalia-id');
      if (seen[id]) continue;
      if (range.intersectsNode(el)) { seen[id] = true; ids.push(id); }
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // 7. Sticky notes
  // ---------------------------------------------------------------------------
  var notesLayer = null;

  function ensureNotesLayer() {
    if (notesLayer) return notesLayer;
    notesLayer = document.createElement('div');
    notesLayer.id = 'marginalia-notes-layer';
    notesLayer.setAttribute('data-marginalia-ui', '1');
    document.body.appendChild(notesLayer);
    return notesLayer;
  }

  function clearNotesDOM() {
    if (notesLayer) notesLayer.innerHTML = '';
  }

  function noteDefaults(mode, x, y) {
    return {
      text: '',
      color: 'butter',
      mode: mode || 'anchored',
      x: x || 40,
      y: y || 40,
      collapsed: false,
      updatedAt: nowIso()
    };
  }

  function renderNote(note, ctx) {
    if (!note) return;
    var layer = ensureNotesLayer();
    var div = document.createElement('div');
    div.className = 'marginalia-note' + (note.collapsed ? ' mn-collapsed' : '');
    div.setAttribute('data-note-highlight', ctx.highlightId || '');
    div.setAttribute('data-note-article', ctx.articleId || '');
    applyNotePosition(div, note);

    div.innerHTML =
      '<div class="mn-head">' +
        '<button class="mn-btn mn-collapse" title="Collapse / expand">▾</button>' +
        '<div class="mn-grip" title="Drag to move">⋮⋮</div>' +
        '<button class="mn-btn mn-menu" title="More">⋯</button>' +
      '</div>' +
      '<div class="mn-body" contenteditable="true" data-placeholder="Write a note…"></div>';

    div.style.background = COLORS[note.color] || COLORS.butter;
    div.style.setProperty('--note-color', COLORS[note.color] || COLORS.butter);
    layer.appendChild(div);

    var body = div.querySelector('.mn-body');
    body.textContent = note.text || '';
    if (!note.text) body.classList.add('is-empty');

    wireNote(div, note, ctx);
    return div;
  }

  function applyNotePosition(div, note) {
    if (note.mode === 'floating') {
      div.style.position = 'fixed';
    } else {
      div.style.position = 'absolute';
    }
    div.style.left = Math.round(note.x) + 'px';
    div.style.top = Math.round(note.y) + 'px';
  }

  function wireNote(div, note, ctx) {
    var body = div.querySelector('.mn-body');
    var dragged = false;

    div.querySelector('.mn-collapse').addEventListener('click', function (e) {
      e.stopPropagation();
      if (dragged) { dragged = false; return; }
      note.collapsed = !note.collapsed;
      note.updatedAt = nowIso();
      saveNote(note, ctx);
      renderArticle(location.href);
    });

    div.querySelector('.mn-menu').addEventListener('click', function (e) {
      e.stopPropagation();
      showNoteMenu(div, note, ctx);
    });

    var persist = debounce(function () {
      note.text = body.textContent;
      note.updatedAt = nowIso();
      saveNote(note, ctx);
    }, 200);

    // Hide the placeholder the moment the note is focused or typed into, so the
    // caret doesn't appear to sit after "Write a note…". Toggling is synchronous
    // (not debounced) to avoid a visible lag followed by a text jump.
    function refreshPlaceholder() {
      if (body.textContent) body.classList.remove('is-empty'); else body.classList.add('is-empty');
    }
    body.addEventListener('focus', function () {
      if (!body.textContent) body.classList.remove('is-empty');
    });
    body.addEventListener('blur', refreshPlaceholder);
    body.addEventListener('input', function () {
      refreshPlaceholder();
      persist();
    });

    body.addEventListener('keydown', function (e) { e.stopPropagation(); });

    // Dragging via the head/grip.
    var head = div.querySelector('.mn-head');
    head.addEventListener('pointerdown', function (e) {
      var onBtn = e.target.closest('.mn-btn');
      // Expanded: the ▾/⋯ buttons act as buttons, not drag handles.
      // Collapsed: the whole head (incl. the ▾ button) is a drag handle.
      if (onBtn && !note.collapsed) return;
      e.preventDefault();
      dragged = false;
      var startX = e.clientX, startY = e.clientY;
      var origX = note.x, origY = note.y;
      function onMove(ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
        note.x = origX + dx;
        note.y = origY + dy;
        div.style.left = Math.round(note.x) + 'px';
        div.style.top = Math.round(note.y) + 'px';
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        note.updatedAt = nowIso();
        saveNote(note, ctx);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  function saveNote(note, ctx) {
    if (ctx.highlightId) {
      var h = highlightById(ctx.highlightId);
      if (h) { h.note = note; h.updatedAt = nowIso(); }
    } else if (ctx.articleId) {
      var a = articleById(ctx.articleId);
      if (a) { a.articleNote = note; a.updatedAt = nowIso(); }
    }
    saveDB();
  }

  function showNoteMenu(div, note, ctx) {
    var menu = document.createElement('div');
    menu.className = 'marginalia-note-menu';
    menu.setAttribute('data-marginalia-ui', '1');

    var swatches = COLOR_ORDER.map(function (c) {
      return '<button class="nm-swatch" data-color="' + c + '" style="background:' + COLORS[c] + '" title="' + c + '"></button>';
    }).join('');

    var modeLabel = note.mode === 'floating' ? 'Anchor to page' : 'Float (fixed)';
    var goHtml = ctx.highlightId ? '<button class="nm-item" data-act="go">Go to highlight</button>' : '';

    menu.innerHTML =
      '<div class="nm-swatches">' + swatches + '</div>' +
      '<button class="nm-item" data-act="toggle-mode">' + esc(modeLabel) + '</button>' +
      goHtml +
      '<button class="nm-item nm-danger" data-act="delete">Delete note</button>';

    document.body.appendChild(menu);
    var rect = div.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';
    menu.style.top = (rect.top + 28) + 'px';

    function onDoc(e) { if (!menu.contains(e.target) && !div.contains(e.target)) close(); }
    function close() { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); }

    menu.addEventListener('click', function (e) {
      var sw = e.target.closest('.nm-swatch');
      if (sw) {
        note.color = sw.getAttribute('data-color');
        div.style.background = COLORS[note.color];
        div.style.setProperty('--note-color', COLORS[note.color]);
        note.updatedAt = nowIso();
        saveNote(note, ctx);
        return;
      }
      var act = e.target.closest('.nm-item');
      if (!act) return;
      var kind = act.getAttribute('data-act');
      if (kind === 'toggle-mode') {
        if (note.mode === 'floating') {
          note.mode = 'anchored';
          note.x = note.x + window.scrollX;
          note.y = note.y + window.scrollY;
        } else {
          note.mode = 'floating';
          note.x = note.x - window.scrollX;
          note.y = note.y - window.scrollY;
        }
        applyNotePosition(div, note);
        saveNote(note, ctx);
      } else if (kind === 'go' && ctx.highlightId) {
        scrollToHighlight(ctx.highlightId);
      } else if (kind === 'delete') {
        if (ctx.highlightId) { var h = highlightById(ctx.highlightId); if (h) { h.note = null; pruneArticle(h.articleId); } }
        else if (ctx.articleId) { var a = articleById(ctx.articleId); if (a) { a.articleNote = null; pruneArticle(ctx.articleId); } }
        renderArticle(location.href);
      }
      close();
    });

    setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0);
  }

  function attachNoteToHighlight(hlId, color) {
    var h = highlightById(hlId);
    if (!h) return;
    var rect = firstHighlightRect(hlId);
    var pos;
    if (rect) {
      pos = { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 10 };
    } else {
      pos = { x: 60, y: window.scrollY + 200 };
    }
    h.note = noteDefaults('anchored', pos.x, pos.y);
    h.note.color = color || 'butter';
    saveDB();
    // Render the note in place instead of re-rendering the whole article: a full
    // render clears + re-anchors highlights, which can drop a just-created highlight
    // when its text is ambiguous to relocate.
    renderNote(h.note, { articleId: h.articleId, highlightId: h.id });
  }

  function firstHighlightRect(hlId) {
    var el = document.querySelector('.marginalia-hl[data-marginalia-id="' + hlId + '"]');
    return el ? el.getBoundingClientRect() : null;
  }

  function addArticleNote() {
    var article = ensureArticle(location.href, document.title);
    if (!article.articleNote) {
      var x = Math.max(40, window.innerWidth - 240);
      article.articleNote = noteDefaults('anchored', x, 40);
    }
    saveDB();
    renderArticle(location.href);
  }

  // ---------------------------------------------------------------------------
  // 8. Shadow UI shell
  // ---------------------------------------------------------------------------
  var host = null;
  var root = null;
  var ui = {};

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'marginalia-host';
    host.setAttribute('data-marginalia-ui', '1');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    root.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'm-root';
    wrap.innerHTML =
      '<div class="m-toolbar" id="m-toolbar"></div>' +
      '<div class="m-popover" id="m-hl-popover"></div>' +
      '<div class="m-ctx" id="m-ctx"></div>' +
      '<div class="m-library" id="m-library"></div>' +
      '<div class="m-modal-back" id="m-modal"></div>' +
      '<div class="m-toast-wrap" id="m-toast"></div>' +
      '<button class="m-fab" id="m-fab" title="Open Marginalia Library">M</button>';
    root.appendChild(wrap);

    ui.toolbar = wrap.querySelector('#m-toolbar');
    ui.hlPopover = wrap.querySelector('#m-hl-popover');
    ui.ctx = wrap.querySelector('#m-ctx');
    ui.library = wrap.querySelector('#m-library');
    ui.modal = wrap.querySelector('#m-modal');
    ui.toast = wrap.querySelector('#m-toast');
    ui.fab = wrap.querySelector('#m-fab');
    ui.rootEl = wrap;

    buildToolbar();
    buildLibrary();
    wireFab();
    applyTheme();
    applyVisibilityClasses();
  }

  function wireFab() {
    ui.fab.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLibrary();
    });
  }

  function toast(msg) {
    ensureUI();
    var t = document.createElement('div');
    t.className = 'm-toast';
    t.textContent = msg;
    ui.toast.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  // ---------------------------------------------------------------------------
  // 9. Selection toolbar + highlight popover
  // ---------------------------------------------------------------------------
  var activeColor = 'butter';
  var currentSelectionHlId = null; // highlight created for the *current* selection
  var activeHlId = null;

  function buildToolbar() {
    var colors = COLOR_ORDER.map(function (c) {
      return '<button class="m-dot" data-color="' + c + '" style="background:' + COLORS[c] + '" title="' + c + '"></button>';
    }).join('');
    var styles = STYLES.map(function (s) {
      return '<button class="m-style" data-style="' + s + '" title="' + STYLE_LABELS[s] + '"><span class="m-style-glyph" style="' + stylePreview(s, 'butter') + '">A</span></button>';
    }).join('');

    ui.toolbar.innerHTML =
      '<div class="m-tb-colors">' + colors + '</div>' +
      '<div class="m-tb-sep"></div>' +
      '<div class="m-tb-styles">' + styles + '</div>' +
      '<div class="m-tb-sep"></div>' +
      '<button class="m-tb-btn" id="m-tb-note" title="Add note">✎</button>' +
      '<button class="m-tb-btn" id="m-tb-more" title="More">⋯</button>';

    setActiveColorUI('butter');

    ui.toolbar.querySelector('.m-tb-colors').addEventListener('click', function (e) {
      var d = e.target.closest('.m-dot');
      if (!d) return;
      var c = d.getAttribute('data-color');
      setActiveColorUI(c);
      if (currentSelectionHlId) {
        var h = highlightById(currentSelectionHlId);
        if (h) { updateHighlightStyle(h.id, h.style, c); currentSelectionHlId = h.id; }
      }
    });

    ui.toolbar.querySelector('.m-tb-styles').addEventListener('click', function (e) {
      var b = e.target.closest('.m-style');
      if (!b) return;
      var style = b.getAttribute('data-style');
      if (currentSelectionHlId) {
        var h = highlightById(currentSelectionHlId);
        if (h) { updateHighlightStyle(h.id, style, activeColor); currentSelectionHlId = h.id; }
      } else {
        attemptHighlight(style, activeColor);
      }
    });

    ui.toolbar.querySelector('#m-tb-note').addEventListener('click', function () {
      var hl = currentSelectionHlId ? highlightById(currentSelectionHlId) : null;
      if (hl) {
        if (!hl.note) attachNoteToHighlight(hl.id, activeColor);
      } else {
        attemptHighlight('marker', activeColor, { withNote: true, noteColor: activeColor });
      }
      hideToolbar();
    });

    ui.toolbar.querySelector('#m-tb-more').addEventListener('click', function (e) {
      e.stopPropagation();
      showMoreMenu(e.target);
    });
  }

  // Create a highlight from the current selection, but first resolve overlaps.
  function attemptHighlight(style, color, opts) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    if (!normalizeWS(sel.toString())) return null;

    var overlaps = findOverlappingHighlightIds(range);
    if (overlaps.length === 0) {
      var hl = createHighlightFromSelection(style, color, opts);
      if (hl) currentSelectionHlId = hl.id;
      return hl;
    }
    showOverlapDialog(overlaps, style, color, opts);
    return null;
  }

  function showOverlapDialog(overlaps, style, color, opts) {
    var buttons = overlaps.map(function (id) {
      var h = highlightById(id);
      var label = h ? normalizeWS(h.text) : id;
      if (label.length > 40) label = label.slice(0, 40) + '…';
      return '<button class="m-modal-btn" data-act="mod:' + id + '">Modify: “' + esc(label) + '”</button>';
    }).join('');

    modal(
      '<div class="m-modal-title">Overlapping highlight</div>' +
      '<p class="m-modal-msg">This selection overlaps existing annotation' + (overlaps.length > 1 ? 's' : '') + '. Choose how to proceed.</p>' +
      buttons +
      '<button class="m-modal-btn" data-act="create">Create separate highlight</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>',
      function (act) {
        if (act === 'create') {
          var hl = createHighlightFromSelection(style, color, opts);
          if (hl) currentSelectionHlId = hl.id;
        } else if (act.indexOf('mod:') === 0) {
          var id = act.slice(4);
          if (highlightById(id)) updateHighlightStyle(id, style, color);
        }
      }
    );
  }

  function stylePreview(style, color) {
    var hex = COLORS[color];
    if (style === 'marker') return 'background:' + hexToRgba(hex, 0.5) + ';';
    var d = style === 'wavy' ? 'wavy' : style === 'dotted' ? 'dotted' : 'solid';
    return 'text-decoration:underline ' + d + ' ' + hex + ' 2px;';
  }

  function setActiveColorUI(c) {
    activeColor = c;
    ui.toolbar.querySelectorAll('.m-dot').forEach(function (d) {
      d.classList.toggle('active', d.getAttribute('data-color') === c);
    });
  }

  function showMoreMenu(anchor) {
    var menu = document.createElement('div');
    menu.className = 'm-popover-menu';
    var sel = window.getSelection();
    var hasSel = sel && !sel.isCollapsed && normalizeWS(sel.toString());
    var hasHl = !!currentSelectionHlId;

    menu.innerHTML =
      (hasSel ? '<button class="m-pm-item" data-act="copy">Copy text</button>' : '') +
      (hasHl ? '<button class="m-pm-item" data-act="fav">Toggle favorite</button>' : '') +
      (hasHl ? '<button class="m-pm-item m-pm-danger" data-act="del">Delete highlight</button>' : '') +
      '<button class="m-pm-item" data-act="lib">Open Library</button>';

    ui.toolbar.appendChild(menu);
    menu.style.display = 'block';

    function onDoc(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); } }

    menu.addEventListener('click', function (e) {
      var it = e.target.closest('.m-pm-item');
      if (!it) return;
      var act = it.getAttribute('data-act');
      if (act === 'copy') {
        compat.clipboard(sel.toString()).then(function () { toast('Copied'); });
      } else if (act === 'fav') {
        var h = highlightById(currentSelectionHlId);
        if (h) { h.favorite = !h.favorite; saveDB(); toast(h.favorite ? 'Added to favorites' : 'Removed from favorites'); }
      } else if (act === 'del') {
        var h2 = highlightById(currentSelectionHlId);
        if (h2) { deleteHighlight(h2.id); currentSelectionHlId = null; renderArticle(location.href); }
      } else if (act === 'lib') {
        openLibrary();
      }
      hideToolbar();
    });

    setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0);
  }

  function showToolbarAt(rect) {
    ensureUI();
    ui.toolbar.style.display = 'flex';
    var tw = ui.toolbar.offsetWidth || 320;
    var left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    var top = rect.top - 48;
    if (top < 8) top = rect.bottom + 12;
    ui.toolbar.style.left = Math.round(left) + 'px';
    ui.toolbar.style.top = Math.round(top) + 'px';
  }

  function hideToolbar() {
    if (ui.toolbar) ui.toolbar.style.display = 'none';
  }

  function showHlPopover(hlId, rect) {
    ensureUI();
    activeHlId = hlId;
    var h = highlightById(hlId);
    if (!h) return;

    var colors = COLOR_ORDER.map(function (c) {
      return '<button class="m-dot" data-color="' + c + '" style="background:' + COLORS[c] + '"></button>';
    }).join('');
    var styles = STYLES.map(function (s) {
      return '<button class="m-style" data-style="' + s + '"><span class="m-style-glyph" style="' + stylePreview(s, 'butter') + '">A</span></button>';
    }).join('');

    ui.hlPopover.innerHTML =
      '<div class="m-tb-colors">' + colors + '</div>' +
      '<div class="m-tb-styles">' + styles + '</div>' +
      '<div class="m-tb-sep"></div>' +
      '<button class="m-tb-btn" data-act="note">✎</button>' +
      '<button class="m-tb-btn" data-act="fav">' + (h.favorite ? '★' : '☆') + '</button>' +
      '<button class="m-tb-btn m-danger" data-act="del">✕</button>';

    ui.hlPopover.style.display = 'flex';
    var tw = ui.hlPopover.offsetWidth || 300;
    var left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    var top = rect.top - 48;
    if (top < 8) top = rect.bottom + 12;
    ui.hlPopover.style.left = Math.round(left) + 'px';
    ui.hlPopover.style.top = Math.round(top) + 'px';

    ui.hlPopover.onclick = function (e) {
      var dot = e.target.closest('.m-dot');
      if (dot) { updateHighlightStyle(hlId, h.style, dot.getAttribute('data-color')); hideHlPopover(); return; }
      var st = e.target.closest('.m-style');
      if (st) { updateHighlightStyle(hlId, st.getAttribute('data-style'), h.color); hideHlPopover(); return; }
      var btn = e.target.closest('.m-tb-btn');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'note') { if (!h.note) attachNoteToHighlight(hlId, h.color); hideHlPopover(); }
      else if (act === 'fav') { h.favorite = !h.favorite; saveDB(); hideHlPopover(); }
      else if (act === 'del') { deleteHighlight(hlId); renderArticle(location.href); hideHlPopover(); }
    };
  }

  function hideHlPopover() {
    if (ui.hlPopover) ui.hlPopover.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 10. Custom context menu (Article Note)
  // ---------------------------------------------------------------------------
  function modifierPressed(ev) {
    var m = settings.contextMenu.nativeModifier;
    if (!m) return false;
    if (m === 'Alt') return ev.altKey;
    if (m === 'Ctrl') return ev.ctrlKey;
    if (m === 'Meta') return ev.metaKey;
    if (m === 'Shift') return ev.shiftKey;
    return false;
  }

  function onContextMenu(ev) {
    if (!settings.contextMenu.enabled) return;
    if (modifierPressed(ev)) return; // let the native menu through

    var target = ev.target;
    if (target && target.closest) {
      if (target.closest('#marginalia-host')) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target.closest('.marginalia-note')) return; // notes have their own menu
    }
    // If the click is over a live selection, defer to the selection toolbar (so
    // the native copy/paste menu stays available for the selection).
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      var r = sel.getRangeAt(0);
      if (r.intersectsNode(target)) return;
    }

    ev.preventDefault();
    ensureUI();
    ui.ctx.innerHTML =
      '<button class="m-ctx-item" data-act="page-note">Add Page Note</button>' +
      '<button class="m-ctx-item" data-act="lib">Open Library</button>' +
      '<div class="m-ctx-hint">hold ' + esc(settings.contextMenu.nativeModifier || 'Alt') + ' for native menu</div>';

    ui.ctx.style.display = 'block';
    ui.ctx.style.left = Math.min(ev.clientX, window.innerWidth - 190) + 'px';
    ui.ctx.style.top = Math.min(ev.clientY, window.innerHeight - 100) + 'px';

    ui.ctx.onclick = function (e) {
      var it = e.target.closest('.m-ctx-item');
      if (!it) return;
      var act = it.getAttribute('data-act');
      if (act === 'page-note') addArticleNote();
      else if (act === 'lib') openLibrary();
      hideCtx();
    };
  }

  function hideCtx() {
    if (ui.ctx) ui.ctx.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // 11. Library
  // ---------------------------------------------------------------------------
  var libState = { view: 'all', query: '', tagFilter: null, colorFilter: null, styleFilter: null, expanded: {} };

  function buildLibrary() {
    ui.library.innerHTML =
      '<div class="m-lib-head">' +
        '<div class="m-lib-brand">Marginalia</div>' +
        '<div class="m-lib-head-actions">' +
          '<button class="m-lib-btn" id="m-lib-clean" title="Toggle Clean View">◐</button>' +
          '<button class="m-lib-btn" id="m-lib-settings" title="Settings">⚙</button>' +
          '<button class="m-lib-btn" id="m-lib-close" title="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="m-lib-search"><input id="m-lib-query" type="search" placeholder="Search highlights, notes, titles, tags…"></div>' +
      '<div class="m-lib-nav" id="m-lib-nav"></div>' +
      '<div class="m-lib-filters" id="m-lib-filters"></div>' +
      '<div class="m-lib-body" id="m-lib-body"></div>' +
      '<div class="m-lib-foot">' +
        '<button class="m-lib-btn" id="m-export">Export ▾</button>' +
        '<button class="m-lib-btn" id="m-import">Import</button>' +
      '</div>';

    var navDefs = [
      ['all', 'Everything'], ['articles', 'Articles'], ['highlights', 'Highlights'],
      ['notes', 'Notes'], ['favorites', 'Favorites'], ['tags', 'Tags']
    ];
    var nav = ui.library.querySelector('#m-lib-nav');
    nav.innerHTML = navDefs.map(function (n) {
      return '<button class="m-nav-btn" data-view="' + n[0] + '">' + n[1] + '</button>';
    }).join('');

    nav.addEventListener('click', function (e) {
      var b = e.target.closest('.m-nav-btn');
      if (!b) return;
      setView(b.getAttribute('data-view'));
    });

    ui.library.querySelector('#m-lib-query').addEventListener('input', debounce(function (e) {
      libState.query = e.target.value;
      renderLib();
    }, 120));

    ui.library.querySelector('#m-lib-close').addEventListener('click', closeLibrary);
    ui.library.querySelector('#m-lib-settings').addEventListener('click', openSettings);
    ui.library.querySelector('#m-lib-clean').addEventListener('click', toggleCleanView);
    ui.library.querySelector('#m-export').addEventListener('click', showExportMenu);
    ui.library.querySelector('#m-import').addEventListener('click', openImportPicker);

    buildFilters();
    setView('all');
  }

  function setView(v) {
    libState.view = v;
    ui.library.querySelectorAll('.m-nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    var filters = ui.library.querySelector('#m-lib-filters');
    if (filters) filters.style.display = (v === 'all' || v === 'highlights' || v === 'favorites') ? '' : 'none';
    renderLib();
  }

  function renderLib() {
    var body = ui.library.querySelector('#m-lib-body');
    var html = '';
    if (libState.view === 'all') html = viewAll();
    else if (libState.view === 'articles') html = viewArticles();
    else if (libState.view === 'highlights') html = viewHighlights();
    else if (libState.view === 'notes') html = viewNotes();
    else if (libState.view === 'favorites') html = viewFavorites();
    else if (libState.view === 'tags') html = viewTags();
    body.innerHTML = html || '<div class="m-empty">Nothing here yet. Select some text on any page to highlight it.</div>';
    wireBody();
  }

  function matchesQuery() {
    var q = normalizeWS(libState.query).toLowerCase();
    if (!q) return function () { return true; };
    return function (texts) {
      return texts.some(function (t) { return String(t || '').toLowerCase().indexOf(q) !== -1; });
    };
  }

  function tagName(tid) { var t = tagById(tid); return t ? t.name : ''; }

  function sortedHighlights(list) {
    return list.slice().sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  }

  function highlightMatchesFilters(h) {
    if (libState.colorFilter && h.color !== libState.colorFilter) return false;
    if (libState.styleFilter && h.style !== libState.styleFilter) return false;
    return true;
  }

  function buildFilters() {
    var bar = ui.library.querySelector('#m-lib-filters');
    var colors = COLOR_ORDER.map(function (c) {
      return '<button class="m-filt-dot" data-color="' + c + '" style="background:' + COLORS[c] + '" title="' + c + '"></button>';
    }).join('');
    var styles = STYLES.map(function (s) {
      return '<button class="m-filt-style" data-style="' + s + '">' + STYLE_LABELS[s] + '</button>';
    }).join('');
    bar.innerHTML =
      '<div class="m-filt-colors">' + colors + '</div>' +
      '<div class="m-filt-sep"></div>' +
      '<div class="m-filt-styles">' + styles + '</div>' +
      '<button class="m-filt-clear" title="Clear filters">✕</button>';

    bar.querySelector('.m-filt-colors').addEventListener('click', function (e) {
      var d = e.target.closest('.m-filt-dot');
      if (!d) return;
      var c = d.getAttribute('data-color');
      libState.colorFilter = libState.colorFilter === c ? null : c;
      refreshFilters();
      renderLib();
    });
    bar.querySelector('.m-filt-styles').addEventListener('click', function (e) {
      var b = e.target.closest('.m-filt-style');
      if (!b) return;
      var s = b.getAttribute('data-style');
      libState.styleFilter = libState.styleFilter === s ? null : s;
      refreshFilters();
      renderLib();
    });
    bar.querySelector('.m-filt-clear').addEventListener('click', function () {
      libState.colorFilter = null;
      libState.styleFilter = null;
      refreshFilters();
      renderLib();
    });

    refreshFilters();
  }

  function refreshFilters() {
    var bar = ui.library.querySelector('#m-lib-filters');
    if (!bar) return;
    bar.querySelectorAll('.m-filt-dot').forEach(function (d) {
      d.classList.toggle('active', d.getAttribute('data-color') === libState.colorFilter);
    });
    bar.querySelectorAll('.m-filt-style').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-style') === libState.styleFilter);
    });
    var clearBtn = bar.querySelector('.m-filt-clear');
    if (clearBtn) clearBtn.style.display = (libState.colorFilter || libState.styleFilter) ? '' : 'none';
  }

  function viewAll() {
    var test = matchesQuery();
    var items = [];

    // Highlights (their attached notes render inline in each highlight card).
    db.highlights.forEach(function (h) {
      if (libState.tagFilter && h.tags.indexOf(libState.tagFilter) === -1) return;
      if (!highlightMatchesFilters(h)) return;
      var a = articleById(h.articleId);
      if (!test([h.text, h.note && h.note.text, a && a.title, h.tags.map(tagName).join(' ')])) return;
      items.push({ ts: h.updatedAt, html: highlightCard(h) });
    });

    // Standalone page notes (article-level annotations, no highlight parent).
    db.articles.forEach(function (a) {
      if (a.articleNote && test([a.articleNote.text, a.title])) {
        items.push({ ts: a.articleNote.updatedAt || a.updatedAt, html: noteCard(a.articleNote, a.title, a.url, 'Page note', { articleId: a.id }).html });
      }
    });

    items.sort(function (x, y) { return (y.ts || '').localeCompare(x.ts || ''); });
    if (items.length === 0) return '<div class="m-empty">Nothing here yet. Select text to highlight or add a note.</div>';
    return items.map(function (it) { return it.html; }).join('');
  }

  function viewHighlights() {
    var test = matchesQuery();
    var items = sortedHighlights(db.highlights).filter(function (h) {
      if (libState.tagFilter && h.tags.indexOf(libState.tagFilter) === -1) return false;
      if (!highlightMatchesFilters(h)) return false;
      return test([h.text, h.note && h.note.text, h.tags.map(tagName).join(' ')]);
    });
    if (items.length === 0) return '<div class="m-empty">No highlights match.</div>';
    return items.map(highlightCard).join('');
  }

  function viewNotes() {
    var test = matchesQuery();
    var cards = [];
    db.articles.forEach(function (a) {
      if (a.articleNote && test([a.articleNote.text, a.title])) {
        cards.push(noteCard(a.articleNote, a.title, a.url, 'Article note', { articleId: a.id }));
      }
    });
    db.highlights.forEach(function (h) {
      if (h.note && test([h.note.text, h.text])) {
        var a = articleById(h.articleId);
        cards.push(noteCard(h.note, a ? a.title : h.title, h.url, 'Highlight note', { hlId: h.id }));
      }
    });
    cards.sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
    return cards.length ? cards.map(function (c) { return c.html; }).join('') : '<div class="m-empty">No notes yet.</div>';
  }

  function noteCard(note, title, url, kind, ref) {
    var fav = false;
    if (ref && ref.hlId) { var fh = highlightById(ref.hlId); fav = !!(fh && fh.favorite); }
    else if (ref && ref.articleId) { var fa = articleById(ref.articleId); fav = !!(fa && fa.favorite); }
    var favStar = fav ? '★' : '☆';
    var hlAttr = (ref && ref.hlId) ? ' data-hl="' + esc(ref.hlId) + '"' : '';
    var artAttr = (ref && ref.articleId) ? ' data-art="' + esc(ref.articleId) + '"' : '';
    var html =
      '<div class="mc mc-note" style="border-left-color:' + (COLORS[note.color] || COLORS.butter) + '">' +
        '<div class="mc-note-text">' + esc(note.text || '(empty note)') + '</div>' +
        '<div class="mc-meta">' + esc(kind) + ' · ' + esc(title) + '</div>' +
        '<div class="mc-actions">' +
          '<button class="m-act" data-act="open" data-url="' + esc(url) + '"' + hlAttr + '>Open in page</button>' +
          '<button class="m-act m-fav" data-act="fav-note"' + hlAttr + artAttr + '>' + favStar + '</button>' +
          '<button class="m-act m-danger" data-act="del-note"' + hlAttr + artAttr + '>Delete</button>' +
        '</div>' +
      '</div>';
    return { html: html, ts: note.updatedAt };
  }

  function viewArticles() {
    var test = matchesQuery();
    var articles = db.articles.slice().sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); })
      .filter(function (a) {
        return test([a.title, a.domain, a.articleNote && a.articleNote.text]);
      });
    if (articles.length === 0) return '<div class="m-empty">No articles saved yet.</div>';
    return articles.map(articleCard).join('');
  }

  function articleCard(a) {
    var hs = highlightsOfArticle(a.id);
    var expanded = libState.expanded[a.id];
    var favStar = a.favorite ? '★' : '☆';
    var html =
      '<div class="mc mc-art" data-art="' + a.id + '">' +
        '<div class="mc-title">' + esc(a.title) + '</div>' +
        '<div class="mc-meta">' + esc(a.domain) + ' · ' + hs.length + ' highlight' + (hs.length === 1 ? '' : 's') + '</div>' +
        (a.articleNote ? '<div class="mc-note-text" style="border-left-color:' + (COLORS[a.articleNote.color] || COLORS.butter) + '">' + esc(a.articleNote.text || '(empty)') + '</div>' : '') +
        '<div class="mc-actions">' +
          '<button class="m-act" data-act="open" data-url="' + esc(a.url) + '">Open in page</button>' +
          '<button class="m-act" data-act="expand" data-id="' + a.id + '">' + (expanded ? 'Collapse' : 'Expand') + '</button>' +
          '<button class="m-act m-fav" data-act="fav-art" data-id="' + a.id + '">' + favStar + '</button>' +
          '<button class="m-act m-danger" data-act="del-art" data-id="' + a.id + '">Delete</button>' +
        '</div>';
    if (expanded) {
      html += '<div class="mc-art-children">';
      if (hs.length) html += hs.map(highlightCard).join('');
      else html += '<div class="m-empty-small">No highlights in this article.</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function highlightCard(h) {
    var a = articleById(h.articleId);
    var title = a ? a.title : h.title;
    var expanded = libState.expanded[h.id];
    var favStar = h.favorite ? '★' : '☆';
    var tagsHtml = (h.tags || []).map(function (tid) {
      return '<span class="m-tag-chip" data-tag="' + tid + '">' + esc(tagName(tid)) + '</span>';
    }).join(' ');
    var unresolved = unresolvedIds[h.id] ? '<span class="m-badge" title="Original text could not be located on this page">unresolved</span>' : '';

    var html =
      '<div class="mc mc-hl" data-hl="' + h.id + '">' +
        '<div class="mc-hl-row">' +
          '<span class="mc-swatch" style="' + swatchStyle(h) + '"></span>' +
          '<div class="mc-quote">“' + esc(h.text) + '”</div>' +
        '</div>' +
        '<div class="mc-meta">' + esc(STYLE_LABELS[h.style]) + ' · ' + esc(title) + ' · ' + fmtDate(h.updatedAt) + ' ' + unresolved + '</div>' +
        (h.note && h.note.text ? '<div class="mc-note-text" style="border-left-color:' + (COLORS[h.note.color] || COLORS.butter) + '">' + esc(h.note.text) + '</div>' : '') +
        (tagsHtml ? '<div class="mc-tags">' + tagsHtml + '</div>' : '') +
        '<div class="mc-actions">' +
          '<button class="m-act" data-act="open" data-url="' + esc(h.url) + '" data-hl="' + h.id + '">Open in page</button>' +
          '<button class="m-act" data-act="expand" data-id="' + h.id + '">' + (expanded ? 'Collapse' : 'Details') + '</button>' +
          '<button class="m-act" data-act="fav-hl" data-id="' + h.id + '">' + favStar + '</button>' +
          '<button class="m-act m-danger" data-act="del-hl" data-id="' + h.id + '">Delete</button>' +
        '</div>';

    if (expanded) {
      html += '<div class="mc-detail">' + highlightDetail(h) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function swatchStyle(h) {
    var hex = COLORS[h.color] || h.color;
    if (h.style === 'marker') return 'background:' + hexToRgba(hex, 0.6) + ';';
    var d = h.style === 'wavy' ? 'wavy' : h.style === 'dotted' ? 'dotted' : 'solid';
    return 'border-bottom:3px ' + d + ' ' + hex + ';background:transparent;';
  }

  function highlightDetail(h) {
    var tagOptions = db.tags.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('');
    return '<div class="mc-detail-inner">' +
      '<div class="m-field"><label>Note</label><textarea data-hl="' + h.id + '" data-field="note">' + esc(h.note ? h.note.text : '') + '</textarea></div>' +
      '<div class="m-field"><label>Tags</label>' +
        '<div class="m-tag-editor" data-hl="' + h.id + '">' +
          (h.tags || []).map(function (tid) { return '<span class="m-tag-chip m-tag-rm" data-tag="' + tid + '" data-hl="' + h.id + '">' + esc(tagName(tid)) + ' ×</span>'; }).join(' ') +
          '<input class="m-tag-input" list="m-tag-list" placeholder="Add tag…" data-hl="' + h.id + '">' +
          '<datalist id="m-tag-list">' + tagOptions + '</datalist>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function viewFavorites() {
    var favArts = db.articles.filter(function (a) { return a.favorite; });
    var favHls = db.highlights.filter(function (h) { return h.favorite && highlightMatchesFilters(h); });
    var html = '';
    if (favArts.length) {
      html += '<div class="m-section-title">Favorite Articles</div>';
      html += favArts.map(articleCard).join('');
    }
    if (favHls.length) {
      html += '<div class="m-section-title">Favorite Highlights</div>';
      html += favHls.map(highlightCard).join('');
    }
    if (!favArts.length && !favHls.length) return '<div class="m-empty">No favorites yet. Tap the ★ on any card.</div>';
    return html;
  }

  function viewTags() {
    if (libState.tagFilter) {
      var tag = tagById(libState.tagFilter);
      var items = db.highlights.filter(function (h) { return h.tags.indexOf(libState.tagFilter) !== -1; });
      var head = '<div class="m-tag-filter-bar">Filtering by <strong>' + esc(tag ? tag.name : '') + '</strong> <button class="m-act" data-act="clear-tag">✕ clear</button></div>';
      return head + (items.length ? items.map(highlightCard).join('') : '<div class="m-empty">No highlights with this tag.</div>');
    }

    if (db.tags.length === 0) return '<div class="m-empty">No tags yet. Add tags from any highlight.</div>';
    return db.tags.map(function (t) {
      var count = db.highlights.filter(function (h) { return h.tags.indexOf(t.id) !== -1; }).length;
      return '<div class="mc mc-tag">' +
        '<span class="m-tag-chip" data-tag="' + t.id + '">' + esc(t.name) + '</span>' +
        '<span class="mc-meta">' + count + ' highlight' + (count === 1 ? '' : 's') + '</span>' +
        '<button class="m-act" data-act="rename-tag" data-id="' + t.id + '">Rename</button>' +
        '<button class="m-act m-danger" data-act="del-tag" data-id="' + t.id + '">Delete</button>' +
      '</div>';
    }).join('');
  }

  function wireBody() {
    var body = ui.library.querySelector('#m-lib-body');
    body.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = b.getAttribute('data-act');
        var id = b.getAttribute('data-id');
        var url = b.getAttribute('data-url');
        var hl = b.getAttribute('data-hl');
        var art = b.getAttribute('data-art');

        if (act === 'open') {
          openInPage(url, hl || null);
        } else if (act === 'expand') {
          libState.expanded[id] = !libState.expanded[id];
          renderLib();
        } else if (act === 'fav-art') {
          var a = articleById(id); if (a) { a.favorite = !a.favorite; saveDB(); renderLib(); }
        } else if (act === 'fav-hl') {
          var h = highlightById(id); if (h) { h.favorite = !h.favorite; saveDB(); renderLib(); }
        } else if (act === 'fav-note') {
          if (hl) { var fnH = highlightById(hl); if (fnH) { fnH.favorite = !fnH.favorite; saveDB(); renderLib(); } }
          else if (art) { var fnA = articleById(art); if (fnA) { fnA.favorite = !fnA.favorite; saveDB(); renderLib(); } }
        } else if (act === 'del-note') {
          if (hl) { var dnH = highlightById(hl); if (dnH) { dnH.note = null; pruneArticle(dnH.articleId); } }
          else if (art) { var dnA = articleById(art); if (dnA) { dnA.articleNote = null; pruneArticle(art); } }
          renderArticle(location.href); renderLib();
        } else if (act === 'del-hl') {
          confirmModal('Delete this highlight?', function () { deleteHighlight(id); renderArticle(location.href); renderLib(); });
        } else if (act === 'del-art') {
          confirmModal('Delete this article and all its highlights and notes?', function () { deleteArticle(id); renderArticle(location.href); renderLib(); });
        } else if (act === 'del-tag') {
          confirmModal('Delete this tag? (Highlights are kept.)', function () { deleteTag(id); renderLib(); });
        } else if (act === 'rename-tag') {
          renameTag(id);
        } else if (act === 'clear-tag') {
          libState.tagFilter = null; renderLib();
        }
      });
    });

    body.querySelectorAll('.m-tag-chip[data-tag]').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var tid = chip.getAttribute('data-tag');
        if (chip.classList.contains('m-tag-rm')) {
          var h = highlightById(chip.getAttribute('data-hl'));
          if (h) { h.tags = h.tags.filter(function (t) { return t !== tid; }); saveDB(); renderLib(); }
        } else {
          libState.tagFilter = tid;
          setView('tags');
        }
      });
    });

    body.querySelectorAll('textarea[data-field="note"]').forEach(function (ta) {
      ta.addEventListener('input', debounce(function () {
        var h = highlightById(ta.getAttribute('data-hl'));
        if (!h) return;
        if (ta.value) {
          if (!h.note) h.note = noteDefaults('anchored', 60, window.scrollY + 200);
          h.note.text = ta.value;
          h.note.updatedAt = nowIso();
        } else if (h.note) {
          h.note.text = '';
        }
        saveDB();
      }, 200));
    });

    body.querySelectorAll('.m-tag-input').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var h = highlightById(inp.getAttribute('data-hl'));
        if (!h || !inp.value.trim()) return;
        var t = ensureTag(inp.value);
        if (t && h.tags.indexOf(t.id) === -1) { h.tags.push(t.id); saveDB(); }
        inp.value = '';
        renderLib();
      });
    });
  }

  function renameTag(id) {
    var t = tagById(id);
    if (!t) return;
    promptModal('Rename tag', t.name, function (val) {
      val = normalizeWS(val);
      if (!val) return;
      var existing = tagByName(val);
      if (existing && existing.id !== id) { toast('A tag with that name already exists.'); return; }
      t.name = val; saveDB(); renderLib();
    });
  }

  function openLibrary() {
    ensureUI();
    ui.library.classList.add('open');
    renderLib();
  }

  function closeLibrary() {
    ui.library.classList.remove('open');
  }

  function toggleLibrary() {
    if (ui.library.classList.contains('open')) closeLibrary();
    else openLibrary();
  }

  // ---------------------------------------------------------------------------
  // 12. Import / Export
  // ---------------------------------------------------------------------------
  function showExportMenu() {
    var menu = document.createElement('div');
    menu.className = 'm-popover-menu m-export-menu';
    menu.innerHTML =
      '<button class="m-pm-item" data-act="json">JSON (full backup)</button>' +
      '<button class="m-pm-item" data-act="md">Markdown</button>' +
      '<button class="m-pm-item" data-act="csv">CSV</button>' +
      '<button class="m-pm-item" data-act="html">HTML archive</button>';
    ui.library.querySelector('.m-lib-foot').appendChild(menu);
    menu.style.display = 'block';
    menu.style.top = 'auto';
    menu.style.right = 'auto';
    menu.style.bottom = '46px';
    menu.style.left = '8px';

    function onDoc(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); } }

    menu.addEventListener('click', function (e) {
      var it = e.target.closest('.m-pm-item');
      if (!it) return;
      var act = it.getAttribute('data-act');
      if (act === 'json') exportJSON();
      else if (act === 'md') exportMarkdown();
      else if (act === 'csv') exportCSV();
      else if (act === 'html') exportHTML();
      menu.remove();
    });

    setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0);
  }

  function exportJSON() {
    var payload = {
      schema: 'marginalia',
      schemaVersion: 1,
      exportedAt: nowIso(),
      articles: db.articles,
      highlights: db.highlights,
      tags: db.tags
    };
    downloadBlob('marginalia-backup.json', 'application/json', JSON.stringify(payload, null, 2));
    toast('Exported JSON backup.');
  }

  function exportMarkdown() {
    var lines = ['# Marginalia — reading notes', ''];
    db.articles.forEach(function (a) {
      lines.push('## ' + (a.title || a.url));
      lines.push('');
      lines.push('- URL: ' + a.url);
      lines.push('- Saved: ' + fmtDate(a.createdAt));
      if (a.articleNote && a.articleNote.text) {
        lines.push('');
        lines.push('### Page note');
        lines.push('');
        lines.push(a.articleNote.text);
      }
      var hs = highlightsOfArticle(a.id);
      if (hs.length) {
        lines.push('');
        lines.push('### Highlights');
        lines.push('');
      }
      hs.forEach(function (h) {
        lines.push('> ' + h.text.replace(/\n+/g, ' '));
        if (h.note && h.note.text) lines.push('- Note: ' + h.note.text.replace(/\n+/g, ' '));
        var meta = [];
        if (h.style && h.style !== 'marker') meta.push(h.style);
        if (h.color) meta.push(h.color);
        if (h.tags && h.tags.length) meta.push(h.tags.map(tagName).join(', '));
        if (h.createdAt) meta.push(fmtDate(h.createdAt));
        if (meta.length) lines.push('- ' + meta.join(' · '));
        lines.push('');
      });
      lines.push('---');
      lines.push('');
    });
    downloadBlob('marginalia-notes.md', 'text/markdown', lines.join('\n'));
    toast('Exported Markdown.');
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    var header = ['id', 'article_title', 'url', 'text', 'style', 'color', 'note', 'tags', 'favorite', 'created_at', 'updated_at'];
    var rows = [header.map(csvEscape).join(',')];
    db.highlights.forEach(function (h) {
      var a = articleById(h.articleId);
      rows.push([
        h.id, a ? a.title : h.title, h.url, h.text, h.style, h.color,
        h.note ? h.note.text : '', (h.tags || []).map(tagName).join(' | '),
        h.favorite ? 'yes' : 'no', h.createdAt, h.updatedAt
      ].map(csvEscape).join(','));
    });
    downloadBlob('marginalia-highlights.csv', 'text/csv', '﻿' + rows.join('\r\n'));
    toast('Exported CSV.');
  }

  function exportHTML() {
    var cards = '';
    db.articles.forEach(function (a) {
      cards += '<article class="art"><h2>' + esc(a.title) + '</h2><div class="meta">' + esc(a.domain) + '</div>';
      if (a.articleNote && a.articleNote.text) cards += '<div class="note">' + esc(a.articleNote.text) + '</div>';
      highlightsOfArticle(a.id).forEach(function (h) {
        cards += '<blockquote>' + esc(h.text) + '</blockquote>';
        if (h.note && h.note.text) cards += '<div class="note">' + esc(h.note.text) + '</div>';
        if (h.tags && h.tags.length) cards += '<div class="tags">' + esc(h.tags.map(tagName).join(', ')) + '</div>';
      });
      cards += '<p class="src"><a href="' + esc(a.url) + '">' + esc(a.url) + '</a></p></article>';
    });
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Marginalia archive</title><style>' +
      'body{font-family:Georgia,serif;max-width:720px;margin:0 auto;padding:40px 24px;background:#faf7f0;color:#2c2a26;}' +
      'h1{font-family:Georgia,serif;}h2{border-bottom:1px solid #e5e0d5;padding-bottom:6px;}' +
      'blockquote{margin:12px 0;padding:10px 16px;background:#f5d978;border-radius:4px;}' +
      '.note{border-left:3px solid #a9c9ee;padding:4px 12px;margin:8px 0;}.meta{color:#8a857a;font-size:14px;}' +
      '.tags{color:#8a857a;font-size:13px;}.src{font-size:13px;overflow-wrap:break-word;}' +
      '</style></head><body><h1>Marginalia archive</h1>' + cards + '</body></html>';
    downloadBlob('marginalia-archive.html', 'text/html', html);
    toast('Exported HTML archive.');
  }

  function openImportPicker() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = function () {
      var f = input.files && input.files[0];
      document.body.removeChild(input);
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); }
        catch (e) { toast('Invalid JSON file.'); return; }
        showImportMode(data);
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function showImportMode(data) {
    if (!data || !Array.isArray(data.articles) || !Array.isArray(data.highlights)) {
      toast('Not a valid Marginalia backup.');
      return;
    }
    var content =
      '<div class="m-import-title">Import backup</div>' +
      '<p class="m-import-sub">Found ' + data.articles.length + ' articles and ' + data.highlights.length + ' highlights.</p>' +
      '<button class="m-modal-btn" data-act="replace">Replace All</button>' +
      '<button class="m-modal-btn" data-act="merge">Merge</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>';
    modal(content, function (act) {
      if (act === 'cancel') return;
      if (act === 'replace') {
        confirmModal('Replace your entire Library with this backup? This cannot be undone.', function () {
          db.articles = data.articles || [];
          db.highlights = data.highlights || [];
          db.tags = data.tags || [];
          db.schemaVersion = data.schemaVersion || 1;
          sanitizeDB();
          saveDB();
          renderArticle(location.href);
          renderLib();
          toast('Library replaced.');
        });
      } else if (act === 'merge') {
        var conflicts = mergeData(data);
        sanitizeDB();
        saveDB();
        renderArticle(location.href);
        renderLib();
        toast(conflicts ? 'Merged, ' + conflicts + ' conflicting record(s) skipped.' : 'Merged successfully.');
      }
    });
  }

  function mergeData(data) {
    var conflicts = 0;
    var byId = {};
    db.articles.forEach(function (a) { byId['a_' + a.id] = a; });
    db.highlights.forEach(function (h) { byId['h_' + h.id] = h; });
    db.tags.forEach(function (t) { byId['t_' + t.id] = t; });

    function mergeOne(kind, record) {
      var key = kind + '_' + record.id;
      if (!byId[key]) {
        db[kind].push(record);
        byId[key] = record;
        return;
      }
      if (JSON.stringify(byId[key]) !== JSON.stringify(record)) conflicts++;
    }

    (data.articles || []).forEach(function (r) { mergeOne('articles', r); });
    (data.highlights || []).forEach(function (r) { mergeOne('highlights', r); });
    (data.tags || []).forEach(function (r) { mergeOne('tags', r); });
    return conflicts;
  }

  // ---------------------------------------------------------------------------
  // 13. Modal dialogs (confirm / prompt)
  // ---------------------------------------------------------------------------
  function modal(contentHtml, onAction) {
    ensureUI();
    ui.modal.innerHTML = '<div class="m-modal">' + contentHtml + '</div>';
    ui.modal.style.display = 'flex';
    ui.modal.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        ui.modal.style.display = 'none';
        if (onAction) onAction(act);
      });
    });
  }

  function confirmModal(message, onConfirm) {
    modal(
      '<div class="m-modal-title">Are you sure?</div>' +
      '<p class="m-modal-msg">' + esc(message) + '</p>' +
      '<button class="m-modal-btn m-modal-danger" data-act="ok">Confirm</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>',
      function (act) { if (act === 'ok') onConfirm(); }
    );
  }

  function promptModal(title, initial, onDone) {
    modal(
      '<div class="m-modal-title">' + esc(title) + '</div>' +
      '<input class="m-modal-input" type="text" value="' + esc(initial || '') + '">' +
      '<button class="m-modal-btn" data-act="ok">OK</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>',
      function (act) {
        if (act === 'ok') {
          var v = ui.modal.querySelector('.m-modal-input').value;
          onDone(v);
        }
      }
    );
  }

  // ---------------------------------------------------------------------------
  // 14. Settings + theme + visibility + clean view
  // ---------------------------------------------------------------------------
  function openSettings() {
    ensureUI();
    var vis = settings.visibility;
    var mod = settings.contextMenu.nativeModifier;
    var html =
      '<div class="m-modal-title">Settings</div>' +
      '<div class="m-set-group"><label>Theme</label>' +
        themeRadio('system', 'System', settings.theme) +
        themeRadio('light', 'Light', settings.theme) +
        themeRadio('dark', 'Dark', settings.theme) +
      '</div>' +
      '<div class="m-set-group"><label>Visibility</label>' +
        visCheck('highlights', 'Highlights', vis.highlights) +
        visCheck('notes', 'Sticky notes', vis.notes) +
        visCheck('toolbar', 'Selection toolbar', vis.toolbar) +
      '</div>' +
      '<div class="m-set-group"><label>Context menu</label>' +
        '<label class="m-set-row"><input type="checkbox" id="s-cm-enabled"' + (settings.contextMenu.enabled ? ' checked' : '') + '> Enable custom menu</label>' +
        '<label class="m-set-row">Native menu modifier <select id="s-cm-mod">' +
          ['', 'Alt', 'Ctrl', 'Meta', 'Shift'].map(function (m) {
            return '<option value="' + m + '"' + (mod === m ? ' selected' : '') + '>' + (m || 'None') + '</option>';
          }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="m-set-group"><label>Clean View shortcut</label>' +
        '<button class="m-modal-btn" id="s-shortcut">' + esc(settings.shortcut) + ' (click to record)</button>' +
      '</div>' +
      '<div class="m-set-group m-danger-zone"><label>Danger zone</label>' +
        '<button class="m-modal-btn" data-act="export-json">Export all data (JSON)</button>' +
        '<button class="m-modal-btn" data-act="import">Import data</button>' +
        '<button class="m-modal-btn m-modal-danger" data-act="wipe">Delete all data</button>' +
      '</div>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="close">Close</button>';

    modal(html, function (act) {
      if (act === 'export-json') exportJSON();
      if (act === 'import') openImportPicker();
      if (act === 'wipe') {
        confirmModal('Delete ALL Marginalia data permanently?', function () {
          db.articles = []; db.highlights = []; db.tags = [];
          saveDB(); renderArticle(location.href); renderLib(); toast('All data deleted.');
        });
      }
    });

    ui.modal.querySelectorAll('input[name="m-theme"]').forEach(function (r) {
      r.addEventListener('change', function () {
        settings.theme = r.value; saveSettings(); applyTheme();
      });
    });
    ui.modal.querySelectorAll('input[name="m-vis"]').forEach(function (c) {
      c.addEventListener('change', function () {
        settings.visibility[c.value] = c.checked;
        saveSettings();
        applyVisibilityToCurrent();
      });
    });
    ui.modal.querySelector('#s-cm-enabled').addEventListener('change', function (e) {
      settings.contextMenu.enabled = e.target.checked; saveSettings();
    });
    ui.modal.querySelector('#s-cm-mod').addEventListener('change', function (e) {
      settings.contextMenu.nativeModifier = e.target.value; saveSettings();
    });
    ui.modal.querySelector('#s-shortcut').addEventListener('click', function () {
      recordShortcut();
    });
  }

  function themeRadio(val, label, cur) {
    return '<label class="m-set-row"><input type="radio" name="m-theme" value="' + val + '"' + (cur === val ? ' checked' : '') + '> ' + label + '</label>';
  }
  function visCheck(key, label, val) {
    return '<label class="m-set-row"><input type="checkbox" name="m-vis" value="' + key + '"' + (val ? ' checked' : '') + '> ' + label + '</label>';
  }

  function recordShortcut() {
    var btn = ui.modal.querySelector('#s-shortcut');
    var old = btn.textContent;
    btn.textContent = 'Press keys…';
    function handler(e) {
      e.preventDefault();
      e.stopPropagation();
      var parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.metaKey) parts.push('Meta');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      var k = keyName(e);
      if (!k || k === 'Control' || k === 'Meta' || k === 'Alt' || k === 'Shift') return;
      if (k.length === 1) k = k.toUpperCase();
      parts.push(k);
      if (parts.length < 2) return;
      settings.shortcut = parts.join('+');
      saveSettings();
      document.removeEventListener('keydown', handler, true);
      btn.textContent = settings.shortcut;
    }
    document.addEventListener('keydown', handler, true);
    setTimeout(function () {
      if (btn.textContent === 'Press keys…') { btn.textContent = old; document.removeEventListener('keydown', handler, true); }
    }, 5000);
  }

  // --- Theme -----------------------------------------------------------------
  function applyTheme() {
    ensureUI();
    var dark = settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    ui.rootEl.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  // --- Visibility -------------------------------------------------------------
  function effectiveVisibility(article) {
    var def = settings.visibility;
    var av = article && article.visibilitySettings;
    return {
      highlights: av ? av.highlights : def.highlights,
      notes: av ? av.notes : def.notes,
      toolbar: av ? av.toolbar : def.toolbar
    };
  }

  function applyVisibility(article) {
    var v = effectiveVisibility(article);
    var de = document.documentElement;
    de.classList.toggle('marginalia-hide-hl', !v.highlights);
    de.classList.toggle('marginalia-hide-notes', !v.notes);
    if (notesLayer) notesLayer.style.display = v.notes ? '' : 'none';
  }

  function applyVisibilityClasses() {
    applyVisibility(articleById(currentArticleId) || findArticleByUrl(location.href));
  }

  function applyVisibilityToCurrent() {
    var a = findArticleByUrl(location.href);
    if (a) {
      a.visibilitySettings = { highlights: settings.visibility.highlights, notes: settings.visibility.notes, toolbar: settings.visibility.toolbar };
      saveDB();
    }
    applyVisibility(a);
  }

  function setCleanView(clean) {
    settings.visibility = clean
      ? { highlights: false, notes: false, toolbar: false }
      : { highlights: true, notes: true, toolbar: true };
    var a = findArticleByUrl(location.href);
    if (a) {
      a.visibilitySettings = { highlights: settings.visibility.highlights, notes: settings.visibility.notes, toolbar: settings.visibility.toolbar };
      saveDB();
    }
    saveSettings();
    applyVisibility(a);
    toast(clean ? 'Clean View' : 'Full View');
  }

  function toggleCleanView() {
    var a = findArticleByUrl(location.href);
    var v = effectiveVisibility(a);
    // All three visible = currently in "full" view → switch to clean; otherwise → full.
    setCleanView(v.highlights && v.notes && v.toolbar);
  }

  // ---------------------------------------------------------------------------
  // 15. Navigation ("Open in page") + emphasis + SPA detection
  // ---------------------------------------------------------------------------
  function openInPage(url, hlId) {
    var jump = hlId ? ('#marginalia-hl-' + hlId) : '';
    window.open(url + jump, '_blank');
  }

  function scrollToHighlight(hlId) {
    var el = document.querySelector('.marginalia-hl[data-marginalia-id="' + hlId + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(el);
    } else {
      toast('Original text not found on this page.');
    }
  }

  function scrollToNote(hlId) {
    var el = document.querySelector('.marginalia-note[data-note-highlight="' + hlId + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(el);
    } else {
      toast('Note not found on this page.');
    }
  }

  function flash(el) {
    var orig = el.style.boxShadow;
    el.style.boxShadow = '0 0 0 4px rgba(245,217,120,0.85)';
    el.style.transition = 'box-shadow 0.2s';
    setTimeout(function () {
      el.style.transition = 'box-shadow 0.8s';
      el.style.boxShadow = orig;
    }, 600);
  }

  function handleJumpHash() {
    var m = location.hash.match(/marginalia-hl-([A-Za-z0-9_]+)/);
    if (m) {
      setTimeout(function () { scrollToHighlight(m[1]); }, 500);
      return true;
    }
    m = location.hash.match(/marginalia-note-([A-Za-z0-9_]+)/);
    if (m) {
      setTimeout(function () { scrollToNote(m[1]); }, 500);
      return true;
    }
    return false;
  }

  // --- SPA navigation ---------------------------------------------------------
  var lastHref = location.href;
  var renderTimer = null;

  function onNavigate() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    scheduleRender();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderArticle(location.href);
      handleJumpHash();
    }, 120);
  }

  function installSpaHooks() {
    var pushState = history.pushState, replaceState = history.replaceState;
    function wrap(fn) {
      return function () {
        var r = fn.apply(this, arguments);
        onNavigate();
        return r;
      };
    }
    try { history.pushState = wrap(pushState); } catch (e) { /* ignore */ }
    try { history.replaceState = wrap(replaceState); } catch (e) { /* ignore */ }
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    setInterval(onNavigate, 2500);
  }

  // ---------------------------------------------------------------------------
  // 16. Global event wiring + keyboard shortcuts
  // ---------------------------------------------------------------------------
  var __selLogged = false;

  function selectionInsideUI(sel) {
    if (!sel || sel.rangeCount === 0) return false;
    var node = sel.anchorNode;
    if (!node) return false;
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== document.body) {
      if (el.id === 'marginalia-host' || el.classList.contains('marginalia-note')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function onMouseUp(e) {
    if (e.target && e.target.closest && e.target.closest('#marginalia-host')) return;

    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      // A click without a selection: maybe a click on an existing highlight.
      if (e.target.closest && e.target.closest('.marginalia-hl')) {
        var span = e.target.closest('.marginalia-hl');
        showHlPopover(span.getAttribute('data-marginalia-id'), span.getBoundingClientRect());
      } else {
        hideHlPopover();
      }
      return;
    }
    if (selectionInsideUI(sel)) return;

    var text = sel.toString();
    if (!normalizeWS(text)) return;

    var anchorEl = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
    if (anchorEl && anchorEl.closest && anchorEl.closest('input, textarea, [contenteditable="true"]')) return;

    if (!effectiveVisibility(findArticleByUrl(location.href)).toolbar) return;

    currentSelectionHlId = null;
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      if (!__selLogged) { __selLogged = true; console.info('[Marginalia] selection detected but empty rect'); }
      return;
    }
    if (!__selLogged) { __selLogged = true; console.info('[Marginalia] selection detected, showing toolbar', Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)); }
    showToolbarAt(rect);
  }

  function onSelectionChange() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (ui.toolbar && ui.toolbar.style.display !== 'none' && !currentSelectionHlId) {
        // Delay so mouseup can still act on the just-made selection.
        setTimeout(function () {
          var s2 = window.getSelection();
          if ((!s2 || s2.isCollapsed) && !currentSelectionHlId) hideToolbar();
        }, 200);
      }
    }
  }

  function keyName(e) {
    var c = e.code;
    if (c && c.indexOf('Key') === 0) return c.slice(3);
    if (c && c.indexOf('Digit') === 0) return c.slice(5);
    return e.key;
  }

  function canonicalShortcut(e) {
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    var k = keyName(e);
    if (!k) return null;
    if (k === 'Control' || k === 'Meta' || k === 'Alt' || k === 'Shift') return null;
    if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  }

  function matchesShortcut(e, shortcut) {
    return canonicalShortcut(e) === shortcut;
  }

  function onKeyDown(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (matchesShortcut(e, settings.shortcut)) {
      e.preventDefault();
      toggleCleanView();
    }
  }

  function onDocumentClick(e) {
    if (ui.toolbar && ui.toolbar.style.display !== 'none' && e.target && !e.target.closest('#marginalia-host')) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) hideToolbar();
    }
    if (e.target && e.target.closest && !e.target.closest('#marginalia-host')) hideCtx();
  }

  // ---------------------------------------------------------------------------
  // 17. Stylesheets
  // ---------------------------------------------------------------------------
  var LIGHT_CSS = [
    'span.marginalia-hl { cursor: pointer; }',
    '#marginalia-notes-layer { position:absolute; top:0; left:0; pointer-events:none; z-index:2147482000; }',
    '.marginalia-note {',
      'pointer-events:auto; width:200px; min-height:96px; box-sizing:border-box;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
      'color:#2c2a26; border-radius:4px; box-shadow:0 4px 14px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12);',
      'display:flex; flex-direction:column; overflow:hidden;',
    '}',
    '.marginalia-note .mn-head { display:flex; align-items:center; height:22px; padding:2px 4px; cursor:grab; user-select:none; background:rgba(0,0,0,0.04); }',
    '.marginalia-note .mn-grip { flex:1; text-align:center; color:rgba(0,0,0,0.4); font-size:12px; letter-spacing:1px; }',
    '.marginalia-note .mn-btn { border:0; background:transparent; color:rgba(0,0,0,0.55); cursor:pointer; font-size:13px; padding:0 4px; line-height:1; }',
    '.marginalia-note .mn-btn:hover { color:rgba(0,0,0,0.85); }',
    '.marginalia-note .mn-body { flex:1; padding:8px 10px; font-size:13px; line-height:1.45; outline:none; overflow:auto; white-space:pre-wrap; word-wrap:break-word; }',
    '.marginalia-note .mn-body.is-empty::before { content:attr(data-placeholder); color:rgba(0,0,0,0.35); }',
    '.marginalia-note.mn-collapsed { width:64px; min-height:18px; height:18px; border-radius:0; overflow:visible; }',
    '.marginalia-note.mn-collapsed .mn-body, .marginalia-note.mn-collapsed .mn-grip, .marginalia-note.mn-collapsed .mn-menu { display:none; }',
    '.marginalia-note.mn-collapsed .mn-head { justify-content:center; height:18px; padding:0; background:transparent; }',
    '.marginalia-note.mn-collapsed .mn-collapse { transform:rotate(-90deg); font-size:12px; }',
    '.marginalia-note.mn-collapsed::before { content:""; position:absolute; top:50%; left:-12px; transform:translateY(-50%); width:0; height:0; border:6px solid transparent; border-right:6px solid var(--note-color, #F5D978); }',
    '.marginalia-note-menu {',
      'position:fixed; z-index:2147483000; width:150px; background:#faf7f0; border:1px solid #e5e0d5; border-radius:6px;',
      'box-shadow:0 8px 24px rgba(0,0,0,0.2); padding:6px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#2c2a26;',
    '}',
    '.marginalia-note-menu .nm-swatches { display:flex; gap:6px; padding:4px; }',
    '.marginalia-note-menu .nm-swatch { width:20px; height:20px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); cursor:pointer; }',
    '.marginalia-note-menu .nm-item { display:block; width:100%; text-align:left; border:0; background:transparent; padding:7px 8px; font-size:13px; cursor:pointer; border-radius:4px; color:#2c2a26; }',
    '.marginalia-note-menu .nm-item:hover { background:rgba(0,0,0,0.06); }',
    '.marginalia-note-menu .nm-danger { color:#b0413e; }',
    'html.marginalia-hide-hl span.marginalia-hl { background:none !important; text-decoration:none !important; }',
    'html.marginalia-hide-notes #marginalia-notes-layer { display:none !important; }'
  ].join('\n');

  var SHADOW_CSS = [
    ':host { all: initial; display: block; }',
    '.m-root {',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
      'color:var(--ink); --paper:#faf7f0; --ink:#2c2a26; --muted:#8a857a; --line:#e5e0d5;',
      '--surface:#fffdf7; --accent:#c9b037;',
    '}',
    '.m-root[data-theme=dark] { --paper:#23211d; --ink:#e8e4da; --muted:#9a958a; --line:#3a3730; --surface:#2b2924; }',
    '.m-root button { font-family:inherit; }',
    // Toolbar
    '.m-toolbar {',
      'position:fixed; z-index:2147483500; display:none; align-items:center; gap:8px; padding:6px 8px;',
      'background:var(--surface); border:1px solid var(--line); border-radius:10px;',
      'box-shadow:0 6px 20px rgba(0,0,0,0.25);',
    '}',
    '.m-tb-colors, .m-tb-styles { display:flex; gap:4px; align-items:center; }',
    '.m-dot { width:18px; height:18px; border-radius:50%; border:1px solid rgba(0,0,0,0.2); cursor:pointer; padding:0; }',
    '.m-dot.active { outline:2px solid var(--ink); outline-offset:1px; }',
    '.m-tb-sep { width:1px; align-self:stretch; background:var(--line); }',
    '.m-style { border:0; background:transparent; cursor:pointer; padding:2px 5px; border-radius:6px; color:var(--ink); }',
    '.m-style:hover { background:rgba(0,0,0,0.06); }',
    '.m-style-glyph { font-size:15px; padding:0 2px; }',
    '.m-tb-btn { border:0; background:transparent; cursor:pointer; font-size:16px; color:var(--ink); padding:4px 7px; border-radius:6px; }',
    '.m-tb-btn:hover { background:rgba(0,0,0,0.08); }',
    '.m-tb-btn.m-danger { color:#b0413e; }',
    '.m-popover-menu { position:absolute; top:110%; right:0; min-width:160px; background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.2); padding:4px; display:none; z-index:10; }',
    '.m-pm-item { display:block; width:100%; text-align:left; border:0; background:transparent; padding:8px 10px; font-size:13px; cursor:pointer; border-radius:5px; color:var(--ink); }',
    '.m-pm-item:hover { background:rgba(0,0,0,0.06); }',
    '.m-pm-danger { color:#b0413e; }',
    // Highlight popover
    '#m-hl-popover { position:fixed; z-index:2147483500; display:none; align-items:center; gap:8px; padding:6px 8px; background:var(--surface); border:1px solid var(--line); border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,0.25); }',
    // Context menu
    '.m-ctx { position:fixed; z-index:2147483500; display:none; width:180px; background:var(--surface); border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.22); padding:4px; }',
    '.m-ctx-item { display:block; width:100%; text-align:left; border:0; background:transparent; padding:9px 10px; font-size:13px; cursor:pointer; border-radius:5px; color:var(--ink); }',
    '.m-ctx-item:hover { background:rgba(0,0,0,0.06); }',
    '.m-ctx-hint { font-size:11px; color:var(--muted); padding:6px 10px 4px; border-top:1px solid var(--line); margin-top:2px; }',
    // Floating button
    '.m-fab { position:fixed; right:18px; bottom:18px; z-index:2147483600; width:42px; height:42px; border-radius:50%; border:1px solid var(--line); background:var(--surface); color:var(--ink); font-size:18px; font-family:Georgia,serif; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,0.22); }',
    '.m-fab:hover { transform:translateY(-1px); }',
    // Library
    '.m-library { position:fixed; top:0; right:0; bottom:0; z-index:2147483600; width:380px; max-width:92vw; background:var(--paper); border-left:1px solid var(--line); box-shadow:-8px 0 30px rgba(0,0,0,0.18); transform:translateX(100%); transition:transform 0.22s ease; display:flex; flex-direction:column; }',
    '.m-library.open { transform:translateX(0); }',
    '.m-lib-head { display:flex; align-items:center; justify-content:space-between; padding:16px 18px 10px; }',
    '.m-lib-brand { font-family:Georgia,"Times New Roman",serif; font-size:22px; letter-spacing:-0.01em; color:var(--ink); }',
    '.m-lib-head-actions { display:flex; gap:4px; }',
    '.m-lib-btn { border:0; background:transparent; cursor:pointer; color:var(--ink); font-size:15px; padding:6px 9px; border-radius:6px; }',
    '.m-lib-btn:hover { background:rgba(0,0,0,0.07); }',
    '.m-lib-search { padding:0 18px 12px; }',
    '.m-lib-search input { width:100%; box-sizing:border-box; padding:9px 12px; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); outline:none; }',
    '.m-lib-search input:focus { border-color:var(--accent); }',
    '.m-lib-nav { display:flex; flex-wrap:wrap; gap:2px; padding:0 12px 8px; border-bottom:1px solid var(--line); }',
    '.m-nav-btn { border:0; background:transparent; cursor:pointer; font-size:13px; color:var(--muted); padding:7px 9px; border-radius:6px; }',
    '.m-nav-btn:hover { color:var(--ink); }',
    '.m-nav-btn.active { color:var(--ink); background:rgba(0,0,0,0.06); font-weight:600; }',
    '.m-lib-filters { display:flex; align-items:center; gap:6px; padding:8px 18px 10px; flex-wrap:nowrap; }',
    '.m-filt-colors, .m-filt-styles { display:flex; gap:4px; align-items:center; }',
    '.m-filt-dot { width:14px; height:14px; border-radius:50%; border:1px solid rgba(0,0,0,0.2); cursor:pointer; padding:0; flex:0 0 auto; }',
    '.m-filt-dot.active { outline:2px solid var(--ink); outline-offset:1px; }',
    '.m-filt-style { border:1px solid var(--line); background:transparent; cursor:pointer; font-size:10px; color:var(--muted); padding:2px 6px; border-radius:5px; white-space:nowrap; flex:0 0 auto; }',
    '.m-filt-style.active { color:var(--ink); border-color:var(--accent); background:rgba(0,0,0,0.05); }',
    '.m-filt-sep { width:1px; align-self:stretch; background:var(--line); }',
    '.m-filt-clear { border:0; background:transparent; cursor:pointer; color:var(--muted); font-size:11px; padding:1px 3px; border-radius:4px; display:none; }',
    '.m-filt-clear:hover { color:var(--ink); background:rgba(0,0,0,0.06); }',
    '.m-lib-body { flex:1; overflow-y:auto; padding:14px 18px 20px; }',
    '.m-lib-foot { display:flex; gap:8px; padding:10px 18px; border-top:1px solid var(--line); position:relative; }',
    '.m-empty { color:var(--muted); font-size:14px; text-align:center; padding:40px 10px; font-family:Georgia,serif; }',
    '.m-empty-small { color:var(--muted); font-size:12px; padding:8px 4px; }',
    '.m-section-title { font-family:Georgia,serif; font-size:15px; margin:18px 0 8px; color:var(--ink); }',
    // Cards
    '.mc { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin-bottom:10px; }',
    '.mc-hl-row { display:flex; gap:8px; align-items:flex-start; }',
    '.mc-swatch { flex:0 0 auto; width:14px; height:16px; border-radius:3px; margin-top:2px; }',
    '.mc-quote { font-family:Georgia,"Times New Roman",serif; font-size:15px; line-height:1.45; color:var(--ink); }',
    '.mc-title { font-family:Georgia,serif; font-size:16px; color:var(--ink); line-height:1.3; }',
    '.mc-meta { font-size:12px; color:var(--muted); margin-top:5px; line-height:1.4; }',
    '.mc-note-text { border-left:3px solid; padding:4px 10px; margin-top:8px; font-size:13px; line-height:1.45; color:var(--ink); }',
    '.mc-tags { margin-top:6px; display:flex; flex-wrap:wrap; gap:4px; }',
    '.m-tag-chip { display:inline-block; font-size:11px; background:rgba(0,0,0,0.06); color:var(--ink); padding:2px 8px; border-radius:10px; cursor:pointer; }',
    '.m-tag-chip:hover { background:rgba(0,0,0,0.12); }',
    '.m-tag-rm { cursor:pointer; }',
    '.mc-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:9px; }',
    '.m-act { border:1px solid var(--line); background:transparent; cursor:pointer; font-size:12px; color:var(--ink); padding:4px 9px; border-radius:6px; }',
    '.m-act:hover { background:rgba(0,0,0,0.05); }',
    '.m-act.m-danger { color:#b0413e; }',
    '.m-act.m-fav { border:none; font-size:15px; }',
    '.m-badge { font-size:10px; background:rgba(0,0,0,0.08); color:var(--muted); padding:1px 6px; border-radius:8px; }',
    '.mc-detail { margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); }',
    '.mc-detail-inner .m-field { margin-bottom:10px; }',
    '.m-field label { display:block; font-size:11px; color:var(--muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.03em; }',
    '.m-field textarea { width:100%; box-sizing:border-box; min-height:60px; padding:8px; font-size:13px; border:1px solid var(--line); border-radius:6px; background:var(--paper); color:var(--ink); resize:vertical; }',
    '.m-tag-editor { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }',
    '.m-tag-input { border:1px solid var(--line); border-radius:6px; padding:4px 8px; font-size:12px; width:110px; background:var(--paper); color:var(--ink); }',
    '.mc-art-children { margin-top:10px; padding-left:8px; border-left:2px solid var(--line); }',
    '.mc-tag { display:flex; align-items:center; gap:8px; }',
    '.mc-tag .mc-meta { flex:1; margin-top:0; }',
    '.m-tag-filter-bar { margin-bottom:10px; font-size:13px; color:var(--ink); }',
    // Modal
    '.m-modal-back { position:fixed; inset:0; z-index:2147484000; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.35); }',
    '.m-modal { background:var(--paper); border:1px solid var(--line); border-radius:12px; padding:22px; width:340px; max-width:90vw; max-height:86vh; overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.3); }',
    '.m-modal-title { font-family:Georgia,serif; font-size:18px; color:var(--ink); margin-bottom:10px; }',
    '.m-modal-msg { font-size:14px; color:var(--ink); margin-bottom:16px; line-height:1.5; }',
    '.m-modal-input { width:100%; box-sizing:border-box; padding:9px 12px; font-size:14px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); margin-bottom:14px; }',
    '.m-modal-btn { display:inline-block; border:1px solid var(--line); background:var(--surface); cursor:pointer; font-size:13px; color:var(--ink); padding:7px 12px; border-radius:7px; margin-right:6px; }',
    '.m-modal-btn:hover { background:rgba(0,0,0,0.05); }',
    '.m-modal-danger { color:#b0413e; border-color:#d9a8a4; }',
    '.m-modal-cancel { color:var(--muted); }',
    '.m-set-group { margin-bottom:16px; }',
    '.m-set-group label.m-set-row { display:block; font-size:13px; color:var(--ink); padding:4px 0; }',
    '.m-set-group > label:first-child { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px; }',
    '.m-set-group select { margin-left:6px; padding:3px 6px; border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--ink); }',
    '.m-danger-zone { border-top:1px solid var(--line); padding-top:12px; }',
    '.m-import-title { font-family:Georgia,serif; font-size:18px; color:var(--ink); margin-bottom:6px; }',
    '.m-import-sub { font-size:13px; color:var(--muted); margin-bottom:16px; }',
    // Toasts
    '.m-toast-wrap { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:2147485000; display:flex; flex-direction:column; gap:8px; align-items:center; }',
    '.m-toast { background:var(--ink); color:var(--paper); padding:9px 16px; border-radius:8px; font-size:13px; opacity:0; transform:translateY(8px); transition:all 0.25s ease; box-shadow:0 6px 18px rgba(0,0,0,0.3); }',
    '.m-toast.show { opacity:1; transform:translateY(0); }',
    '.m-export-menu { position:absolute; }'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // 18. Bootstrap
  // ---------------------------------------------------------------------------
  function boot() {
    compat.addStyle(LIGHT_CSS);
    ensureNotesLayer();
    ensureUI();
    applyTheme();

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick);

    // Late-content retries for anchor restoration.
    (function retry() {
      var retries = 0;
      var timer = setInterval(function () {
        if (Object.keys(unresolvedIds).length === 0 || retries >= 3) { clearInterval(timer); return; }
        renderArticle(location.href);
        retries++;
      }, 1800);
    })();

    renderArticle(location.href);
    handleJumpHash();
    installSpaHooks();

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });

    compat.menu('Marginalia: Open Library', openLibrary);
    compat.menu('Marginalia: Toggle Clean View', toggleCleanView);

    applyThemeListener();
  }

  function applyThemeListener() {
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var fn = function () { if (settings.theme === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', fn);
      else if (mq.addListener) mq.addListener(fn);
    } catch (e) { /* ignore */ }
  }

  function safeBoot() {
    try {
      boot();
      console.info('[Marginalia] ready (v0.1.0)');
    } catch (err) {
      console.error('[Marginalia] boot failed:', err);
    }
  }

  window.addEventListener('error', function (e) {
    try {
      console.error('[Marginalia] runtime error:', (e && (e.error || e.message)) || e);
    } catch (ignore) { /* noop */ }
  });

  if (document.body) safeBoot();
  else document.addEventListener('DOMContentLoaded', safeBoot);
})();

