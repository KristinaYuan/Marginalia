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
