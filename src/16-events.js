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
