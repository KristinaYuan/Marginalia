  // ---------------------------------------------------------------------------
  // 1. Constants
  // ---------------------------------------------------------------------------
  var COLORS = {
    butter: '#F5D978',
    sky: '#A9C9EE',
    lilac: '#C5B1E8',
    rose: '#ECAEBB',
    sage: '#A9D4B5'
  };
  var COLOR_ORDER = ['butter', 'sky', 'lilac', 'rose', 'sage'];
  var STYLES = ['marker', 'underline', 'wavy', 'dotted'];
  var STYLE_LABELS = { marker: 'Marker', underline: 'Underline', wavy: 'Wavy', dotted: 'Dotted' };

  var DATA_KEY = 'marginalia.data.v1';
  var SETTINGS_KEY = 'marginalia.settings.v1';

  var DB_DEFAULT = { schemaVersion: 1, articles: [], highlights: [], tags: [] };
  var SETTINGS_DEFAULT = {
    theme: 'system',                                   // 'system' | 'light' | 'dark'
    visibility: { highlights: true, notes: true, toolbar: true },
    contextMenu: { enabled: true, nativeModifier: 'Alt' }, // '' | 'Alt' | 'Ctrl' | 'Meta' | 'Shift'
    shortcut: 'Alt+Shift+M'
  };
