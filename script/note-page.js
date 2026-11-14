/* Standalone note pages: math, code copy, progress bar, theme toggle, share. */
(function () {
    'use strict';
    var doc = document;
    var root = doc.documentElement;

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).catch(function () { return execCopy(text); });
        }
        return execCopy(text);
    }

    function execCopy(text) {
        return new Promise(function (resolve, reject) {
            try {
                var ta = doc.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
                doc.body.appendChild(ta);
                ta.focus();
                ta.select();
                var ok = doc.execCommand('copy');
                doc.body.removeChild(ta);
                if (ok) resolve();
                else reject(new Error('Copy failed'));
            } catch (err) {
                reject(err);
            }
        });
    }

    // KaTeX (script is only included on pages that contain math)
    if (window.katex) {
        doc.querySelectorAll('.katex-math').forEach(function (el) {
            try {
                el.innerHTML = window.katex.renderToString(el.getAttribute('data-math') || '', {
                    displayMode: el.getAttribute('data-display') === 'true',
                    throwOnError: false
                });
            } catch (_) { /* keep raw source */ }
        });
    }

    // Framed code blocks with fixed header & copy button
    doc.querySelectorAll('.markdown-body pre').forEach(function (pre) {
        if (pre.closest('.notes-code-frame') || pre.querySelector('.notes-code-copy-btn')) return;
        var codeNode = pre.querySelector('code');
        var rawText = (codeNode || pre).textContent;
        var langMatch = ((codeNode && codeNode.className) || '').match(/language-([a-zA-Z0-9_+-]+)/);
        var langLabel = (langMatch && langMatch[1] && langMatch[1] !== 'text' && langMatch[1] !== 'plaintext')
            ? langMatch[1].toUpperCase()
            : 'CODE';

        var frame = doc.createElement('div');
        frame.className = 'notes-code-frame notranslate';
        frame.setAttribute('translate', 'no');

        var header = doc.createElement('div');
        header.className = 'notes-code-header';

        var langSpan = doc.createElement('span');
        langSpan.className = 'notes-code-lang font-mono';
        langSpan.textContent = langLabel;

        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'notes-code-copy-btn font-mono';
        btn.setAttribute('aria-label', 'Copy code snippet');
        btn.textContent = 'Copy';
        btn.addEventListener('click', function () {
            var code = codeNode ? codeNode.textContent : rawText;
            copyText(code).then(function () {
                btn.classList.add('is-copied');
                btn.textContent = 'Copied';
                setTimeout(function () {
                    btn.classList.remove('is-copied');
                    btn.textContent = 'Copy';
                }, 1800);
            }, function () {});
        });

        header.appendChild(langSpan);
        header.appendChild(btn);
        pre.parentNode.insertBefore(frame, pre);
        frame.appendChild(header);
        frame.appendChild(pre);
    });

    // Reading progress
    var bar = doc.getElementById('note-progress');
    if (bar) {
        window.addEventListener('scroll', function () {
            var max = root.scrollHeight - window.innerHeight;
            var pct = max > 0 ? Math.max(0, Math.min(100, (window.scrollY / max) * 100)) : 0;
            bar.style.width = pct + '%';
        }, { passive: true });
    }

    // Theme toggle (same storage key, palette, and View Transitions reveal as the main site)
    var THEME_CORE = {
        dark: { bg: '#0E0D0C', accent: '#D8B278', rgb: '216, 178, 120' },
        light: { bg: '#E2DBD0', accent: '#84321A', rgb: '132, 50, 26' }
    };
    var toggle = doc.getElementById('note-theme');
    function label() {
        if (toggle) toggle.textContent = root.classList.contains('light') ? 'Dark' : 'Light';
    }
    function readSavedNoteTheme() {
        var t = null;
        try { t = localStorage.getItem('pxecore_theme') || localStorage.getItem('theme'); } catch (_) {}
        if (!t) {
            try { t = sessionStorage.getItem('pxecore_theme') || sessionStorage.getItem('theme'); } catch (_) {}
        }
        if (!t && doc.cookie) {
            try {
                var m = doc.cookie.match(/(?:^|;\s*)pxecore_theme=([^;]+)/);
                if (m) t = decodeURIComponent(m[1]);
            } catch (_) {}
        }
        return (t === 'light' || t === 'dark') ? t : null;
    }
    function applyNoteTheme(next) {
        var cfg = THEME_CORE[next] || THEME_CORE.dark;
        root.classList.remove('light', 'dark');
        root.classList.add(next);
        root.style.backgroundColor = cfg.bg;
        root.style.colorScheme = next;
        root.style.setProperty('--accent', cfg.accent);
        root.style.setProperty('--accent-rgb', cfg.rgb);
        var metaTheme = doc.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute('content', cfg.bg);
        try {
            localStorage.setItem('pxecore_theme', next);
            localStorage.setItem('theme', next);
        } catch (_) {}
        try {
            sessionStorage.setItem('pxecore_theme', next);
            sessionStorage.setItem('theme', next);
        } catch (_) {}
        try {
            doc.cookie = 'pxecore_theme=' + encodeURIComponent(next) + '; path=/; max-age=31536000; SameSite=Lax';
        } catch (_) {}
        label();
    }
    var savedInitTheme = readSavedNoteTheme();
    if (savedInitTheme && !root.classList.contains(savedInitTheme)) {
        applyNoteTheme(savedInitTheme);
    } else {
        label();
    }
    if (toggle) {
        toggle.addEventListener('click', function () {
            var next = root.classList.contains('light') ? 'dark' : 'light';
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!doc.startViewTransition || reduced) {
                applyNoteTheme(next);
                return;
            }
            var rect = toggle.getBoundingClientRect();
            var ox = rect.width ? rect.left + rect.width / 2 : window.innerWidth - 30;
            var oy = rect.height ? rect.top + rect.height / 2 : 30;
            var endR = Math.hypot(Math.max(ox, window.innerWidth - ox), Math.max(oy, window.innerHeight - oy));
            root.classList.add('theme-instant-sync');
            var vt = doc.startViewTransition(function () { applyNoteTheme(next); });
            vt.ready.then(function () {
                root.animate(
                    { clipPath: ['circle(0px at ' + ox + 'px ' + oy + 'px)', 'circle(' + endR + 'px at ' + ox + 'px ' + oy + 'px)'] },
                    { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
                );
            }).catch(function () {});
            vt.finished.finally(function () {
                root.classList.remove('theme-instant-sync');
            });
        });
    }

    // Share
    var share = doc.getElementById('note-share');
    if (share) {
        share.addEventListener('click', function () {
            var url = location.href;
            if (navigator.share) {
                navigator.share({ title: doc.title, url: url }).catch(function () {});
            } else {
                copyText(url).then(function () {
                    share.textContent = 'Copied';
                    setTimeout(function () { share.textContent = 'Share'; }, 1800);
                }, function () {});
            }
        });
    }
})();

