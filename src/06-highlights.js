  // ---------------------------------------------------------------------------
  // 6. Highlight rendering
  // ---------------------------------------------------------------------------
  var currentArticleId = null;
  var unresolvedIds = {}; // runtime set of highlights that failed to anchor

  function renderArticle(url) {
    var article = findArticleByUrl(url);
    currentArticleId = article ? article.id : null;
    unresolvedIds = {};

    clearHighlightsDOM();
    clearNotesDOM();
    applyVisibility(article);

    if (article) {
      renderArticleHighlights(article);
      renderArticleNotes(article);
    }
  }

  function renderArticleHighlights(article) {
    var hs = highlightsOfArticle(article.id);
    if (hs.length === 0) return;
    var index = buildIndex(document.body);
    hs.forEach(function (h) {
      var found = findRange(index, h.anchor);
      if (found) {
        wrapRange(found.range, h);
      } else {
        unresolvedIds[h.id] = true;
      }
    });
  }

  function renderArticleNotes(article) {
    if (article.articleNote) renderNote(article.articleNote, { articleId: article.id, highlightId: null });
    highlightsOfArticle(article.id).forEach(function (h) {
      if (h.note) renderNote(h.note, { articleId: article.id, highlightId: h.id });
    });
  }

  // Highlight creation from a selection.
  function createHighlightFromSelection(style, color, opts) {
    opts = opts || {};
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var exact = sel.toString();
    if (!normalizeWS(exact)) return null;

    var article = ensureArticle(location.href, document.title);

    var anchor = anchorFromRange(range, exact);
    if (!anchor) { toast('Cannot annotate this selection (unsupported content).'); return null; }

    var hl = {
      id: uid('hl'),
      articleId: article.id,
      url: article.url,
      title: article.title,
      text: exact,
      style: style,
      color: color,
      note: null,
      tags: [],
      favorite: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      anchor: anchor,
      notePosition: null
    };
    db.highlights.push(hl);
    touchArticle(article.id);
    saveDB();
    wrapRange(range, hl);
    if (opts.withNote) attachNoteToHighlight(hl.id, opts.noteColor);
    return hl;
  }

  function updateHighlightStyle(id, style, color) {
    var h = highlightById(id);
    if (!h) return;
    h.style = style;
    h.color = color;
    h.updatedAt = nowIso();
    saveDB();
    renderArticle(location.href);
  }

  function findOverlappingHighlightIds(range) {
    var ids = [];
    var seen = {};
    // A simple scan of the page's existing highlight spans is cheap (highlights
    // are few) and correctly catches both descendants *and* ancestor spans that
    // a common-ancestor walker would miss.
    var spans = document.querySelectorAll('.marginalia-hl');
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      var id = el.getAttribute('data-marginalia-id');
      if (seen[id]) continue;
      if (range.intersectsNode(el)) { seen[id] = true; ids.push(id); }
    }
    return ids;
  }
