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
