  // ---------------------------------------------------------------------------
  // 3. Compatibility layer
  // ---------------------------------------------------------------------------
  var compat = {
    storage: {
      get: function (key, def) {
        try {
          if (typeof GM_getValue === 'function') {
            var v = GM_getValue(key, undefined);
            if (v !== undefined) return v;
            return def;
          }
        } catch (e) { /* fall through */ }
        try {
          var raw = localStorage.getItem('marginalia:' + key);
          return raw == null ? def : JSON.parse(raw);
        } catch (e) { return def; }
      },
      set: function (key, val) {
        try {
          if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
        } catch (e) { /* fall through */ }
        try { localStorage.setItem('marginalia:' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
      },
      del: function (key) {
        try { if (typeof GM_deleteValue === 'function') { GM_deleteValue(key); return; } } catch (e) { /* fall through */ }
        try { localStorage.removeItem('marginalia:' + key); } catch (e) { /* ignore */ }
      }
    },
    clipboard: function (text) {
      if (typeof GM_setClipboard === 'function') {
        try { GM_setClipboard(text); return Promise.resolve(true); } catch (e) { /* fall through */ }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
      // Last-resort fallback.
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve(ok);
      } catch (e) { return Promise.resolve(false); }
    },
    menu: function (label, fn) {
      try {
        if (typeof GM_registerMenuCommand === 'function') {
          GM_registerMenuCommand(label, fn);
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    },
    addStyle: function (css) {
      try {
        if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
      } catch (e) { /* ignore */ }
      var s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  };
