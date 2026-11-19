(function () {
    'use strict';
    var THEME_CORE = {
        dark: { bg: '#0E0D0C', accent: '#D8B278', rgb: '216, 178, 120' },
        light: { bg: '#E2DBD0', accent: '#84321A', rgb: '132, 50, 26' }
    };

    function readSavedTheme() {
        var t = null;
        try { t = localStorage.getItem('pxecore_theme') || localStorage.getItem('theme'); } catch (_) {}
        if (!t) {
            try { t = sessionStorage.getItem('pxecore_theme') || sessionStorage.getItem('theme'); } catch (_) {}
        }
        if (!t && document.cookie) {
            try {
                var m = document.cookie.match(/(?:^|;\s*)pxecore_theme=([^;]+)/);
                if (m) t = decodeURIComponent(m[1]);
            } catch (_) {}
        }
        return (t === 'light' || t === 'dark') ? t : null;
    }

    function writeSavedTheme(theme) {
        var normalized = theme === 'light' ? 'light' : 'dark';
        try {
            localStorage.setItem('theme', normalized);
            localStorage.setItem('pxecore_theme', normalized);
        } catch (_) {}
        try {
            sessionStorage.setItem('theme', normalized);
            sessionStorage.setItem('pxecore_theme', normalized);
        } catch (_) {}
        try {
            document.cookie = 'pxecore_theme=' + encodeURIComponent(normalized) + '; path=/; max-age=31536000; SameSite=Lax';
        } catch (_) {}
    }

    function applyCriticalThemeVars(theme) {
        var normalized = theme === 'light' ? 'light' : 'dark';
        var cfg = THEME_CORE[normalized];
        var root = document.documentElement;
        root.className = normalized;
        root.style.backgroundColor = cfg.bg;
        root.style.colorScheme = normalized;
        root.style.setProperty('--accent', cfg.accent);
        root.style.setProperty('--accent-rgb', cfg.rgb);
        root.style.setProperty('--terminal-prompt', cfg.accent);
        var metaTh = document.getElementById('meta-theme-color');
        if (metaTh) metaTh.setAttribute('content', cfg.bg);
    }

    window.__pxecoreThemeBoot = {
        THEME_CORE: THEME_CORE,
        readSavedTheme: readSavedTheme,
        writeSavedTheme: writeSavedTheme,
        applyCriticalThemeVars: applyCriticalThemeVars
    };

    try {
        var root = document.documentElement;
        var t = readSavedTheme();
        var isLight = t === 'light';
        applyCriticalThemeVars(isLight ? 'light' : 'dark');

        var bgHref = isLight ? 'media/bg_light.webp' : 'media/bg_dark.webp';
        var link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = bgHref;
        link.type = 'image/webp';
        link.fetchPriority = 'high';
        document.head.appendChild(link);

        if (window.location.protocol !== 'file:') {
            var fontLink = document.createElement('link');
            fontLink.rel = 'preload';
            fontLink.as = 'font';
            fontLink.type = 'font/woff2';
            fontLink.href = 'fonts/outfit-latin.woff2';
            fontLink.crossOrigin = 'anonymous';
            document.head.appendChild(fontLink);
        }

        var rawHash = (window.location.hash || '').replace('#', '');
        var hash = rawHash.split('?')[0].split('/')[0];
        var params = new URLSearchParams(window.location.search);
        var initialView = 'home';
        if (hash === 'notes' || rawHash.indexOf('?p=') !== -1 || params.has('p')) {
            initialView = 'notes';
        } else if (hash === 'resume') {
            initialView = 'resume';
        }
        root.setAttribute('data-initial-view', initialView);

        var activateDeferredCss = function (onlyView) {
            var links = document.querySelectorAll('link[data-defer-view]');
            for (var i = 0; i < links.length; i++) {
                var target = links[i].getAttribute('data-defer-view');
                if (!onlyView || target === onlyView) {
                    links[i].media = 'all';
                    links[i].removeAttribute('data-defer-view');
                }
            }
        };
        if (initialView !== 'home') {
            document.addEventListener('readystatechange', function () {
                activateDeferredCss(initialView);
            });
        }
        window.addEventListener('DOMContentLoaded', function () {
            activateDeferredCss(null);
        }, { once: true });
    } catch (_) {}
})();

