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
