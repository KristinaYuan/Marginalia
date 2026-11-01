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
