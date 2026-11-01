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
