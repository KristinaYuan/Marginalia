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
