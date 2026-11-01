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
