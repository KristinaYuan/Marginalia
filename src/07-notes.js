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
