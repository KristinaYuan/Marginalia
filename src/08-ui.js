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
