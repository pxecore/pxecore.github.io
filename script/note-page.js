/* Route /notes/<slug>/ directly into the main site's Notes Reader view. */
(function () {
    'use strict';
    var root = document.documentElement;
    var THEME_CORE = {
        dark: { bg: '#0E0D0C', accent: '#D8B278', rgb: '216, 178, 120' },
        light: { bg: '#E2DBD0', accent: '#84321A', rgb: '132, 50, 26' }
    };
    try {
        var t = localStorage.getItem('pxecore_theme') || localStorage.getItem('theme') || 'dark';
        var cfg = THEME_CORE[t] || THEME_CORE.dark;
        root.className = t === 'light' ? 'light' : 'dark';
        root.style.backgroundColor = cfg.bg;
        root.style.colorScheme = t === 'light' ? 'light' : 'dark';
    } catch (_) {}

    try {
        var pathParts = (window.location.pathname || '').replace(/\/index\.html$/, '').replace(/\/+$/, '').split('/').filter(Boolean);
        var notesIdx = pathParts.lastIndexOf('notes');
        var slug = (notesIdx !== -1 && pathParts[notesIdx + 1]) ? pathParts[notesIdx + 1] : (pathParts[pathParts.length - 1] || '');
        if (slug && slug !== 'notes') {
            var rootPrefix = notesIdx > 0 ? '/' + pathParts.slice(0, notesIdx).join('/') + '/' : '/';
            if (window.location.protocol === 'file:') {
                window.location.replace('../../index.html#notes?p=' + encodeURIComponent(slug));
            } else {
                window.location.replace(rootPrefix + '#notes?p=' + encodeURIComponent(slug));
            }
        } else {
            window.location.replace('../../#notes');
        }
    } catch (_) {
        window.location.replace('../../#notes');
    }
})();
