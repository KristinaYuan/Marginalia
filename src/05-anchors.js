  // ---------------------------------------------------------------------------
  // 5. Text anchor engine
  // ---------------------------------------------------------------------------
  function isSensitive(el) {
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' ||
        tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION' ||
        tag === 'BUTTON') return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute && el.hasAttribute('data-marginalia-ui')) return true;
    return false;
  }

  function isSensitiveTextNode(node) {
    var el = node.parentElement;
    while (el && el !== document.documentElement) {
      if (isSensitive(el)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Normalize a whole string, returning { text, map, rawToNorm }.
  //   map[normIndex]    -> rawIndex of that character
  //   rawToNorm[rawIdx] -> normIndex (nearest) of that raw offset
  function normalizeWithMap(raw) {
    var chars = [];
    var map = [];
    var rawToNorm = new Array(raw.length + 1);
    var i = 0;
    var len = raw.length;
    while (i < len) {
      var ch = raw[i];
      if (/\s/.test(ch)) {
        if (chars.length > 0 && chars[chars.length - 1] !== ' ') {
          chars.push(' ');
          map.push(i);
        }
        i++;
      } else {
        chars.push(ch);
        map.push(i);
        i++;
      }
    }
    var text = chars.join('');
    var last = 0;
    for (var n = 0; n < map.length; n++) rawToNorm[map[n]] = n;
    for (var r = 0; r <= raw.length; r++) {
      if (rawToNorm[r] !== undefined) last = rawToNorm[r];
      else rawToNorm[r] = last;
    }
    return { text: text, map: map, rawToNorm: rawToNorm };
  }

  function buildIndex(root) {
    root = root || document.body;
    var nodes = [];
    var rawFull = '';
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (isSensitiveTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var val = n.nodeValue;
      if (!val) continue;
      nodes.push({ node: n, start: rawFull.length, end: rawFull.length + val.length });
      rawFull += val;
    }
    var nm = normalizeWithMap(rawFull);
    return { nodes: nodes, rawFull: rawFull, normText: nm.text, map: nm.map, rawToNorm: nm.rawToNorm };
  }

  // Locate the text node (and offset within it) for a raw offset into rawFull.
  function locateRaw(index, rawOffset) {
    var nodes = index.nodes;
    if (nodes.length === 0) return null;
    if (rawOffset <= nodes[0].start) return { node: nodes[0].node, offset: 0 };
    if (rawOffset >= nodes[nodes.length - 1].end) {
      var lastn = nodes[nodes.length - 1];
      return { node: lastn.node, offset: lastn.node.nodeValue.length };
    }
    var lo = 0, hi = nodes.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (nodes[mid].end <= rawOffset) lo = mid + 1;
      else hi = mid;
    }
    return { node: nodes[lo].node, offset: rawOffset - nodes[lo].start };
  }

  function rawOffsetOf(index, node, offset) {
    var nodes = index.nodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].node === node) return nodes[i].start + offset;
    }
    return -1;
  }

  // Search the index for an anchor; return { range, confidence } or null.
  function findRange(index, anchor) {
    if (!anchor || !anchor.exact) return null;
    var needle = normalizeWS(anchor.exact);
    if (!needle) return null;
    var text = index.normText;

    var starts = [];
    var from = 0;
    var pos;
    while ((pos = text.indexOf(needle, from)) !== -1) {
      starts.push(pos);
      from = pos + 1;
      if (starts.length > 200) break; // safety
    }
    if (starts.length === 0) return null;

    var best = starts[0];
    var bestScore = -1;
    var prefix = normalizeWS(anchor.prefix);
    var suffix = normalizeWS(anchor.suffix);

    for (var i = 0; i < starts.length; i++) {
      var s = starts[i];
      var e = s + needle.length;
      var p = normalizeWS(text.slice(Math.max(0, s - (prefix ? prefix.length + 4 : 0)), s));
      var su = normalizeWS(text.slice(e, e + (suffix ? suffix.length + 4 : 0)));
      var score = 0;
      if (prefix && p === prefix) score += 3;
      if (suffix && su === suffix) score += 3;
      if (typeof anchor.offset === 'number' && Math.abs(s - anchor.offset) <= 40) score += 1;
      if (score > bestScore) { bestScore = score; best = s; }
    }

    var confidence = starts.length === 1 ? 'high' : (bestScore >= 3 ? 'high' : 'low');
    // When several identical passages exist and none matched its surrounding
    // context, refuse to guess rather than attaching to the wrong one.
    if (starts.length > 1 && bestScore < 3) return null;

    var rawStart = index.map[best];
    var rawEnd = index.map[best + needle.length - 1] + 1;
    var start = locateRaw(index, rawStart);
    var end = locateRaw(index, rawEnd);
    if (!start || !end) return null;

    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (e) { return null; }
    return { range: range, confidence: confidence };
  }

  // Wrap the text nodes in `range` with a highlight span, returning the spans.
  function wrapRange(range, hl) {
    var spans = [];
    if (!range || range.collapsed) return spans;
    var sc = range.startContainer, so = range.startOffset;
    var ec = range.endContainer, eo = range.endOffset;

    var root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var ok = false;
        try { ok = range.intersectsNode(node); } catch (e) { ok = false; }
        return ok ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    var cur;
    while ((cur = walker.nextNode())) nodes.push(cur);

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var s = 0, e = node.nodeValue.length;
      if (node === sc) s = so;
      if (node === ec) e = eo;
      if (s >= e) continue;
      var span = splitAndWrap(node, s, e);
      span.className = 'marginalia-hl';
      span.setAttribute('data-marginalia-id', hl.id);
      span.setAttribute('data-style', hl.style);
      span.setAttribute('data-color', hl.color);
      span.style.cssText = hlStyle(hl.style, hl.color);
      spans.push(span);
    }
    return spans;
  }

  function splitAndWrap(node, s, e) {
    var length = node.nodeValue.length;
    var span = document.createElement('span');
    var target;
    if (s === 0 && e === length) {
      target = node;
    } else if (s === 0) {
      node.splitText(e);
      target = node;
    } else if (e === length) {
      target = node.splitText(s);
    } else {
      target = node.splitText(s);
      target.splitText(e - s);
    }
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
    return span;
  }

  function hlStyle(style, color) {
    var hex = COLORS[color] || color || COLORS.butter;
    if (style === 'marker') {
      return 'background:' + hexToRgba(hex, 0.42) + ';border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;';
    }
    var dstyle = style === 'wavy' ? 'wavy' : style === 'dotted' ? 'dotted' : 'solid';
    return 'text-decoration:underline ' + dstyle + ' ' + hex + ' 2px;text-underline-offset:2px;';
  }

  function clearHighlightsDOM() {
    var spans = Array.prototype.slice.call(document.querySelectorAll('span.marginalia-hl'));
    var parents = [];
    spans.forEach(function (s) {
      var parent = s.parentNode;
      if (!parent) return;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      parent.removeChild(s);
      if (parents.indexOf(parent) === -1) parents.push(parent);
    });
    parents.forEach(function (p) {
      try { p.normalize(); } catch (e) { /* ignore */ }
    });
  }

  // Build a highlight's anchor from the current selection/range.
  function anchorFromRange(range, rawExact) {
    var index = buildIndex(document.body);
    var sc = range.startContainer, so = range.startOffset;
    var ec = range.endContainer, eo = range.endOffset;
    var rStart = rawOffsetOf(index, sc, so);
    var rEnd = rawOffsetOf(index, ec, eo);
    if (rStart < 0 || rEnd < 0) return null;

    var nStart = index.rawToNorm[rStart];
    var nEnd = index.rawToNorm[rEnd];

    var prefix = normalizeWS(index.normText.slice(Math.max(0, nStart - 80), nStart));
    var suffix = normalizeWS(index.normText.slice(nEnd, nEnd + 80));

    return {
      exact: rawExact != null ? rawExact : normalizeWS(index.normText.slice(nStart, nEnd)),
      prefix: prefix,
      suffix: suffix,
      offset: nStart
    };
  }
