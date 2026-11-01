  // ---------------------------------------------------------------------------
  // 12. Import / Export
  // ---------------------------------------------------------------------------
  function showExportMenu() {
    var menu = document.createElement('div');
    menu.className = 'm-popover-menu m-export-menu';
    menu.innerHTML =
      '<button class="m-pm-item" data-act="json">JSON (full backup)</button>' +
      '<button class="m-pm-item" data-act="md">Markdown</button>' +
      '<button class="m-pm-item" data-act="csv">CSV</button>' +
      '<button class="m-pm-item" data-act="html">HTML archive</button>';
    ui.library.querySelector('.m-lib-foot').appendChild(menu);
    menu.style.display = 'block';
    menu.style.top = 'auto';
    menu.style.right = 'auto';
    menu.style.bottom = '46px';
    menu.style.left = '8px';

    function onDoc(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); } }

    menu.addEventListener('click', function (e) {
      var it = e.target.closest('.m-pm-item');
      if (!it) return;
      var act = it.getAttribute('data-act');
      if (act === 'json') exportJSON();
      else if (act === 'md') exportMarkdown();
      else if (act === 'csv') exportCSV();
      else if (act === 'html') exportHTML();
      menu.remove();
    });

    setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0);
  }

  function exportJSON() {
    var payload = {
      schema: 'marginalia',
      schemaVersion: 1,
      exportedAt: nowIso(),
      articles: db.articles,
      highlights: db.highlights,
      tags: db.tags
    };
    downloadBlob('marginalia-backup.json', 'application/json', JSON.stringify(payload, null, 2));
    toast('Exported JSON backup.');
  }

  function exportMarkdown() {
    var lines = ['# Marginalia — reading notes', ''];
    db.articles.forEach(function (a) {
      lines.push('## ' + (a.title || a.url));
      lines.push('');
      lines.push('- URL: ' + a.url);
      lines.push('- Saved: ' + fmtDate(a.createdAt));
      if (a.articleNote && a.articleNote.text) {
        lines.push('');
        lines.push('### Page note');
        lines.push('');
        lines.push(a.articleNote.text);
      }
      var hs = highlightsOfArticle(a.id);
      if (hs.length) {
        lines.push('');
        lines.push('### Highlights');
        lines.push('');
      }
      hs.forEach(function (h) {
        lines.push('> ' + h.text.replace(/\n+/g, ' '));
        if (h.note && h.note.text) lines.push('- Note: ' + h.note.text.replace(/\n+/g, ' '));
        var meta = [];
        if (h.style && h.style !== 'marker') meta.push(h.style);
        if (h.color) meta.push(h.color);
        if (h.tags && h.tags.length) meta.push(h.tags.map(tagName).join(', '));
        if (h.createdAt) meta.push(fmtDate(h.createdAt));
        if (meta.length) lines.push('- ' + meta.join(' · '));
        lines.push('');
      });
      lines.push('---');
      lines.push('');
    });
    downloadBlob('marginalia-notes.md', 'text/markdown', lines.join('\n'));
    toast('Exported Markdown.');
  }

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    var header = ['id', 'article_title', 'url', 'text', 'style', 'color', 'note', 'tags', 'favorite', 'created_at', 'updated_at'];
    var rows = [header.map(csvEscape).join(',')];
    db.highlights.forEach(function (h) {
      var a = articleById(h.articleId);
      rows.push([
        h.id, a ? a.title : h.title, h.url, h.text, h.style, h.color,
        h.note ? h.note.text : '', (h.tags || []).map(tagName).join(' | '),
        h.favorite ? 'yes' : 'no', h.createdAt, h.updatedAt
      ].map(csvEscape).join(','));
    });
    downloadBlob('marginalia-highlights.csv', 'text/csv', '﻿' + rows.join('\r\n'));
    toast('Exported CSV.');
  }

  function exportHTML() {
    var cards = '';
    db.articles.forEach(function (a) {
      cards += '<article class="art"><h2>' + esc(a.title) + '</h2><div class="meta">' + esc(a.domain) + '</div>';
      if (a.articleNote && a.articleNote.text) cards += '<div class="note">' + esc(a.articleNote.text) + '</div>';
      highlightsOfArticle(a.id).forEach(function (h) {
        cards += '<blockquote>' + esc(h.text) + '</blockquote>';
        if (h.note && h.note.text) cards += '<div class="note">' + esc(h.note.text) + '</div>';
        if (h.tags && h.tags.length) cards += '<div class="tags">' + esc(h.tags.map(tagName).join(', ')) + '</div>';
      });
      cards += '<p class="src"><a href="' + esc(a.url) + '">' + esc(a.url) + '</a></p></article>';
    });
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Marginalia archive</title><style>' +
      'body{font-family:Georgia,serif;max-width:720px;margin:0 auto;padding:40px 24px;background:#faf7f0;color:#2c2a26;}' +
      'h1{font-family:Georgia,serif;}h2{border-bottom:1px solid #e5e0d5;padding-bottom:6px;}' +
      'blockquote{margin:12px 0;padding:10px 16px;background:#f5d978;border-radius:4px;}' +
      '.note{border-left:3px solid #a9c9ee;padding:4px 12px;margin:8px 0;}.meta{color:#8a857a;font-size:14px;}' +
      '.tags{color:#8a857a;font-size:13px;}.src{font-size:13px;overflow-wrap:break-word;}' +
      '</style></head><body><h1>Marginalia archive</h1>' + cards + '</body></html>';
    downloadBlob('marginalia-archive.html', 'text/html', html);
    toast('Exported HTML archive.');
  }

  function openImportPicker() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = function () {
      var f = input.files && input.files[0];
      document.body.removeChild(input);
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); }
        catch (e) { toast('Invalid JSON file.'); return; }
        showImportMode(data);
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function showImportMode(data) {
    if (!data || !Array.isArray(data.articles) || !Array.isArray(data.highlights)) {
      toast('Not a valid Marginalia backup.');
      return;
    }
    var content =
      '<div class="m-import-title">Import backup</div>' +
      '<p class="m-import-sub">Found ' + data.articles.length + ' articles and ' + data.highlights.length + ' highlights.</p>' +
      '<button class="m-modal-btn" data-act="replace">Replace All</button>' +
      '<button class="m-modal-btn" data-act="merge">Merge</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>';
    modal(content, function (act) {
      if (act === 'cancel') return;
      if (act === 'replace') {
        confirmModal('Replace your entire Library with this backup? This cannot be undone.', function () {
          db.articles = data.articles || [];
          db.highlights = data.highlights || [];
          db.tags = data.tags || [];
          db.schemaVersion = data.schemaVersion || 1;
          sanitizeDB();
          saveDB();
          renderArticle(location.href);
          renderLib();
          toast('Library replaced.');
        });
      } else if (act === 'merge') {
        var conflicts = mergeData(data);
        sanitizeDB();
        saveDB();
        renderArticle(location.href);
        renderLib();
        toast(conflicts ? 'Merged, ' + conflicts + ' conflicting record(s) skipped.' : 'Merged successfully.');
      }
    });
  }

  function mergeData(data) {
    var conflicts = 0;
    var byId = {};
    db.articles.forEach(function (a) { byId['a_' + a.id] = a; });
    db.highlights.forEach(function (h) { byId['h_' + h.id] = h; });
    db.tags.forEach(function (t) { byId['t_' + t.id] = t; });

    function mergeOne(kind, record) {
      var key = kind + '_' + record.id;
      if (!byId[key]) {
        db[kind].push(record);
        byId[key] = record;
        return;
      }
      if (JSON.stringify(byId[key]) !== JSON.stringify(record)) conflicts++;
    }

    (data.articles || []).forEach(function (r) { mergeOne('articles', r); });
    (data.highlights || []).forEach(function (r) { mergeOne('highlights', r); });
    (data.tags || []).forEach(function (r) { mergeOne('tags', r); });
    return conflicts;
  }
