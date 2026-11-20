/* runtime error boundary */
window.addEventListener('unhandledrejection', (event) => {
    if (event && event.reason && (event.reason.name === 'AbortError' || event.reason.name === 'NotAllowedError')) {
        event.preventDefault();
        return;
    }
});

let currentActiveView = 'home';
window.currentActiveView = currentActiveView;


// Theme toggle logic
const themeToggleButton = document.getElementById('theme-toggle');
const body = document.body;

/**
 * Blackletter P — calligraphy inking on entrance, magnetism, 3D spin.
 */
function initBrandMark() {
    const mark = document.getElementById('brand-mark');
    if (!mark) return;

    const stage = mark.querySelector('.logo-stage');
    const path = mark.querySelector('.logo-mark path');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // GPU-composited logo entrance (avoids non-composited SVG stroke-dashoffset/fill-opacity warnings)
    if (stage && !reduced) {
        stage.style.opacity = '0';
        stage.style.transform = 'scale3d(0.9, 0.9, 1) translate3d(0, -4px, 0)';
        requestAnimationFrame(() => {
            stage.style.transition = 'opacity 520ms var(--ease-velvet, cubic-bezier(0.22, 1, 0.36, 1)), transform 520ms var(--ease-velvet, cubic-bezier(0.22, 1, 0.36, 1))';
            stage.style.opacity = '1';
            stage.style.transform = 'scale3d(1, 1, 1) translate3d(0, 0, 0)';
        });
        window.setTimeout(() => {
            stage.style.transition = '';
            stage.style.opacity = '';
            stage.style.transform = '';
        }, 560);
    }

    let pulsing = false;
    mark.addEventListener('click', (e) => {
        if (e.detail > 0) mark.blur();

        if (reduced || pulsing) return;
        pulsing = true;
        mark.classList.remove('is-pulsing', 'is-spinning');
        void mark.offsetWidth;
        mark.classList.add('is-pulsing', 'is-spinning');

        let settled = false;
        const onEnd = () => {
            if (settled) return;
            settled = true;
            mark.removeEventListener('animationend', onEnd);
            mark.classList.remove('is-pulsing', 'is-spinning');
            pulsing = false;
        };
        mark.addEventListener('animationend', onEnd, { once: true });
        window.setTimeout(onEnd, 980);
    });

    mark.addEventListener('mouseup', () => mark.blur());
    mark.addEventListener('pointerup', () => mark.blur());

    if (reduced || !stage || window.matchMedia('(pointer: coarse)').matches) return;

    const maxTilt = 7;
    let markRect = null;
    mark.addEventListener('pointerenter', () => {
        markRect = mark.getBoundingClientRect();
    });
    mark.addEventListener('pointermove', (e) => {
        if (!markRect) markRect = mark.getBoundingClientRect();
        const x = (e.clientX - markRect.left) / (markRect.width || 1) - 0.5;
        const y = (e.clientY - markRect.top) / (markRect.height || 1) - 0.5;
        mark.style.setProperty('--logo-rx', `${(-y * maxTilt).toFixed(2)}deg`);
        mark.style.setProperty('--logo-ry', `${(x * maxTilt).toFixed(2)}deg`);
    });

    mark.addEventListener('pointerleave', () => {
        markRect = null;
        mark.style.setProperty('--logo-rx', '0deg');
        mark.style.setProperty('--logo-ry', '0deg');
    });
}

function initSpecularSheenAndTitleCrystallization() {
    const pixelTitle = document.querySelector('.pixel-text');
    const pixelChars = pixelTitle ? Array.from(pixelTitle.querySelectorAll('.pixel-char')) : [];

    function triggerTitleCrystallize() {
        if (pixelChars.length === 0) return false;
        pixelChars.forEach(ch => {
            if (ch.dataset.char) ch.textContent = ch.dataset.char;
        });
        return true;
    }

    window.__triggerTitleCrystallize = triggerTitleCrystallize;
}

/**
 * Apply theme to body and update particle colors
 * @param {string} theme - Theme to apply ('light' or 'dark').
 * @param {boolean} isInitialLoad - Whether this is the initial page load.
 * @param {boolean} isViewTransition - Whether transitioning via View Transitions API.
 */
function applyTheme(theme, isInitialLoad = false, isViewTransition = false) {
    const targetClass = theme === 'light' ? 'light' : 'dark';
    const targetBodyClass = theme === 'light' ? 'light-theme' : 'dark-mode-active';

    if (!isInitialLoad && !isViewTransition) {
        document.documentElement.classList.add('theme-in-transition');
        setTimeout(() => {
            document.documentElement.classList.remove('theme-in-transition');
        }, 240);
    }

    if (!document.documentElement.classList.contains(targetClass)) {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(targetClass);
    }
    document.documentElement.style.backgroundColor = theme === 'light' ? '#E2DBD0' : '#0E0D0C';
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    if (!body.classList.contains(targetBodyClass)) {
        body.classList.remove('light-theme', 'dark-mode-active');
        body.classList.add(targetBodyClass);
    }

    if (themeToggleButton) {
        themeToggleButton.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
        themeToggleButton.removeAttribute('title');
        themeToggleButton.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
    if (window.__pxecoreThemeBoot && typeof window.__pxecoreThemeBoot.writeSavedTheme === 'function') {
        window.__pxecoreThemeBoot.writeSavedTheme(theme);
    }

    const themeMeta = document.getElementById('meta-theme-color');
    if (themeMeta) {
        const core = window.__pxecoreThemeBoot?.THEME_CORE;
        const contentColor = core?.[theme]?.bg || (theme === 'light' ? '#E2DBD0' : '#0E0D0C');
        themeMeta.setAttribute('content', contentColor);
    }

    // Performance optimization & theme synchronization for particles.js
    const pJS = window.pJSDom?.[0]?.pJS;
    if (pJS) {
        if (theme === 'light') {
            if (pJS.particles?.move) {
                pJS.particles.move.enable = false;
            }
            if (pJS.fn?.drawAnimFrame) {
                cancelRequestAnimFrame(pJS.fn.drawAnimFrame);
                pJS.fn.drawAnimFrame = null;
            }
        } else {
            // Restore dark accent color and viewport-scaled particle count
            const darkHex = window.SKY?.dark?.hex || '#D8B278';
            if (typeof initializeParticles === 'function') {
                initializeParticles(darkHex, false);
            } else if (typeof window.tintParticles === 'function') {
                window.tintParticles(pJS, darkHex);
            }
            if (pJS.particles?.move) {
                pJS.particles.move.enable = true;
            }
            if (pJS.fn) {
                if (pJS.fn.drawAnimFrame) {
                    cancelRequestAnimFrame(pJS.fn.drawAnimFrame);
                    pJS.fn.drawAnimFrame = null;
                }
                if (typeof pJS.fn.vendors?.draw === 'function') {
                    pJS.fn.vendors.draw();
                }
            }
        }
    } else if (!isInitialLoad && theme === 'dark' && typeof initializeParticles === 'function') {
        initializeParticles(getSky().hex, false);
    }

    // Dispatch global theme change event for dynamic charts, mindmap graph, and svg components
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}
window.applyTheme = applyTheme;

// Theme toggle button listener
if (themeToggleButton) {
    let lastThemeToggle = 0;
    let activeThemeTransition = null;
    themeToggleButton.addEventListener('click', (e) => {
        const now = Date.now();
        if (now - lastThemeToggle < 60) return; // Ignore hardware double-bounce within same frame window
        lastThemeToggle = now;

        if (activeThemeTransition) {
            try { activeThemeTransition.skipTransition(); } catch (_) { }
            document.documentElement.classList.remove('theme-instant-sync');
            activeThemeTransition = null;
        }

        let currentTheme = 'dark';
        if (body.classList.contains('light-theme') || document.documentElement.classList.contains('light')) currentTheme = 'light';

        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

        // Origin coordinates for radial theme reveal
        const rect = themeToggleButton.getBoundingClientRect();
        const originX = rect.width ? rect.left + rect.width / 2 : window.innerWidth - 30;
        const originY = rect.height ? rect.top + rect.height / 2 : 30;

        // Circular theme reveal transition on desktop; fast direct transition on touch/low-tier hardware
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isMobileOrLowTier = (typeof window.isCoarsePointer === 'function' && window.isCoarsePointer()) ||
            window.matchMedia('(pointer: coarse)').matches ||
            (window.HardwareProfiler && window.HardwareProfiler.getTier() <= 1);
        if (!document.startViewTransition || reducedMotion || isMobileOrLowTier) {
            applyTheme(nextTheme, false);
        } else {
            const endRadius = Math.hypot(
                Math.max(originX, window.innerWidth - originX),
                Math.max(originY, window.innerHeight - originY)
            );
            document.documentElement.classList.add('theme-instant-sync');
            const transition = document.startViewTransition(() => {
                applyTheme(nextTheme, false, true);
            });
            activeThemeTransition = transition;
            transition.ready.then(() => {
                if (activeThemeTransition !== transition) return;
                document.documentElement.animate(
                    {
                        clipPath: [
                            `circle(0px at ${originX}px ${originY}px)`,
                            `circle(${endRadius}px at ${originX}px ${originY}px)`
                        ]
                    },
                    {
                        duration: 460,
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                        pseudoElement: '::view-transition-new(root)'
                    }
                );
            }).catch(() => { });
            transition.finished.finally(() => {
                if (activeThemeTransition === transition) {
                    activeThemeTransition = null;
                    document.documentElement.classList.remove('theme-instant-sync');
                }
            });
        }

        if (e.detail > 0) {
            themeToggleButton.blur();
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
        }
    });
}



// page lifecycle & bfcache
let lastResumeTime = 0;
function resumeAllVisualPipelines() {
    const now = performance.now();
    if (now - lastResumeTime < 80) return;
    lastResumeTime = now;

    if (typeof window.__resizeStarfield === 'function') {
        window.__resizeStarfield(false);
    }
    if (typeof window.__resumeStarfield === 'function') {
        window.__resumeStarfield();
    }
    const currentTheme = (document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'))) ? 'light' : 'dark';
    if (currentTheme === 'dark') {
        if (typeof window.__resumeParticles === 'function') {
            window.__resumeParticles();
        }
    } else if (typeof window.__pauseParticles === 'function') {
        window.__pauseParticles();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.title = 'System Offline!';
        if (typeof window.__pauseParticles === 'function') {
            window.__pauseParticles();
        }
        if (typeof window.__pauseStarfield === 'function') {
            window.__pauseStarfield();
        }
    } else {
        try {
            const titleMap = {
                home: 'pxecore',
                notes: 'pxecore · notes',
                resume: 'pxecore · resume',
                shelf: window.location.hash === '#cinema' ? 'pxecore · cinema' : 'pxecore · books'
            };
            const notesReaderEl = document.getElementById('notes-reader-view');
            const isReaderActive = document.body.classList.contains('reader-focused') ||
                Boolean(notesReaderEl && notesReaderEl.style.display !== 'none');
            const activeView = (typeof currentActiveView !== 'undefined' && currentActiveView) || window.currentActiveView || 'home';
            if (activeView === 'notes' && isReaderActive) {
                const rTitle = document.getElementById('reader-title')?.textContent?.trim();
                document.title = rTitle ? `${rTitle} · pxecore` : 'pxecore · notes';
            } else {
                document.title = titleMap[activeView] || 'pxecore';
            }
        } catch (_) { }
        window.pxecore?.audio?.resumeVisualizerIfPlaying?.();
        resumeAllVisualPipelines();
    }
});

let mainBootstrapTime = 0;
let mainHandledInitialPageshow = false;

window.addEventListener('pageshow', (event) => {
    if (!event.persisted && !mainHandledInitialPageshow) {
        mainHandledInitialPageshow = true;
        if (mainBootstrapTime && performance.now() - mainBootstrapTime < 1500) return;
    }
    // When returning from iOS BFCache / background hibernation
    resumeAllVisualPipelines();
});

window.addEventListener('focus', () => {
    resumeAllVisualPipelines();
});

/**
 * Debounce helper to limit how often a function can run.
 * @param {function} func
 * @param {number} wait
 * @param {boolean} immediate
 * @returns {function}
 */
function debounce(func, wait, immediate) {
    let timeout;
    return function (...args) {
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        }, wait);
        if (callNow) func.apply(this, args);
    };
}

// Debounced viewport settle — adapts particles & starfield smoothly across breakpoints.
let settledViewport = { w: 0, h: 0, area: 0 };

function settleSkyViewport(force = false) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const area = w * h;
    const prev = settledViewport;

    // avoid reinit on address bar height changes
    const widthDiff = Math.abs(w - prev.w);
    const heightDiff = Math.abs(h - prev.h);
    const widthChanged = widthDiff >= 32; // True window dimension change (not scrollbar 15-17px)
    const heightChanged = heightDiff >= 200; // True orientation change / major resize (not address bar ~60-90px)

    if (!force && prev.w && !widthChanged && !heightChanged) {
        // Soft sync without resetting astronomical bodies or particle state
        if (typeof window.__resizeStarfield === 'function') {
            window.__resizeStarfield(false);
        }
        return;
    }

    settledViewport = { w, h, area };

    if (document.documentElement.classList.contains('dark')) {
        initializeParticles(getSky().hex, false);
    }
    if (typeof window.__resizeStarfield === 'function') {
        window.__resizeStarfield(false); // Adaptive repositioning without destroying stars!
    }
}

const handleResize = debounce(function () {
    settleSkyViewport(false);
}, 160);

window.addEventListener('resize', handleResize, { passive: true });



// session id & handles
const PXE_SESSION_ID = '0500d49ca2b7d6e4149e53e8eba080f0b3795af952810f19bc21882121a7a4e760';
let sessionCopiedTimeout = null;

function copySessionID() {
    const btn = document.querySelector('.session-btn');

    function showFeedback() {
        if (!btn) return;
        if (!btn.dataset.origHtml) {
            btn.dataset.origHtml = btn.innerHTML;
        }
        btn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--accent);margin-right:0.4em;"></i> <span>copied!</span>';
        if (sessionCopiedTimeout) clearTimeout(sessionCopiedTimeout);
        sessionCopiedTimeout = setTimeout(() => {
            if (btn.dataset.origHtml) {
                btn.innerHTML = btn.dataset.origHtml;
                delete btn.dataset.origHtml;
            }
            sessionCopiedTimeout = null;
        }, 2000);
    }

    safeCopyToClipboard(PXE_SESSION_ID, showFeedback);
}

function safeCopyToClipboard(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (cb) cb();
        }).catch(() => {
            showFallbackCopy(text, cb);
        });
    } else {
        showFallbackCopy(text, cb);
    }
}
window.safeCopyToClipboard = safeCopyToClipboard;

function showFallbackCopy(text, cb) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { }
    document.body.removeChild(textArea);
    if (copied && cb) cb();
}

// copy feedback
function showCopyBadgeFeedback(el) {
    if (!el || el.dataset.copying) return;
    el.dataset.copying = 'true';
    const origHTML = el.innerHTML;
    el.innerHTML = '<i class="fa-solid fa-check" style="color:var(--accent);"></i> copied!';
    setTimeout(() => {
        if (el) {
            el.innerHTML = origHTML;
            delete el.dataset.copying;
        }
    }, 1800);
}

// discord handle copy
function copyDiscord(el) {
    safeCopyToClipboard('pxecore', () => showCopyBadgeFeedback(el));
}

// session handle copy
function copySessionHandle(el) {
    safeCopyToClipboard(PXE_SESSION_ID, () => showCopyBadgeFeedback(el));
}

// badge snippet copy
function copyMyButton(el) {
    if (!el || el.dataset.copying) return;
    const snippet = '<a href="https://pxecore.github.io" target="_blank" rel="noopener noreferrer"><img src="https://pxecore.github.io/media/badges/pxecore.webp" alt="pxecore" width="88" height="31" /></a>';

    function onSuccess() {
        el.dataset.copying = 'true';
        const prevText = el.textContent;
        el.textContent = 'copied!';
        el.style.borderColor = 'var(--accent)';
        el.style.color = 'var(--accent)';
        setTimeout(() => {
            el.textContent = prevText;
            el.style.borderColor = '';
            el.style.color = '';
            delete el.dataset.copying;
        }, 2000);
    }

    safeCopyToClipboard(snippet, onSuccess);
}
window.copySessionID = copySessionID;
window.copyDiscord = copyDiscord;
window.copySessionHandle = copySessionHandle;
window.copyMyButton = copyMyButton;


// bootstrap
function bootstrapSite() {
    if (window.__pxecoreBootstrapped) return;
    window.__pxecoreBootstrapped = true;
    requestAnimationFrame(() => {
        settledViewport = {
            w: window.innerWidth,
            h: window.innerHeight,
            area: window.innerWidth * window.innerHeight
        };
    });

    // theme
    const savedTheme = (window.__pxecoreThemeBoot && window.__pxecoreThemeBoot.readSavedTheme()) || 'dark';
    applyTheme(savedTheme, true);

    // terminal date (Europe/Istanbul)
    const staticDateElement = document.getElementById('static-date');
    if (staticDateElement) {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(new Date());
            const pMap = {};
            parts.forEach(p => { pMap[p.type] = p.value; });
            staticDateElement.textContent = `${pMap.year}-${pMap.month}-${pMap.day} ${pMap.hour}:${pMap.minute}`;
        } catch (_) {
            const now = new Date();
            const istanbulTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
            const year = istanbulTime.getUTCFullYear();
            const month = String(istanbulTime.getUTCMonth() + 1).padStart(2, '0');
            const day = String(istanbulTime.getUTCDate()).padStart(2, '0');
            const hours = String(istanbulTime.getUTCHours()).padStart(2, '0');
            const minutes = String(istanbulTime.getUTCMinutes()).padStart(2, '0');
            staticDateElement.textContent = `${year}-${month}-${day} ${hours}:${minutes}`;
        }
    }


    // Unobtrusive event listener bindings for interactive utility buttons
    const sessionBtn = document.querySelector('.session-btn');
    if (sessionBtn) sessionBtn.addEventListener('click', () => copySessionID());
    const discordBtn = document.getElementById('copy-discord-btn');
    if (discordBtn) discordBtn.addEventListener('click', function () { copyDiscord(this); });
    const sessionHandleBtn = document.getElementById('copy-session-btn');
    if (sessionHandleBtn) sessionHandleBtn.addEventListener('click', function () { copySessionHandle(this); });
    const badgeBtn = document.getElementById('copy-my-badge-btn');
    if (badgeBtn) badgeBtn.addEventListener('click', function () { copyMyButton(this); });

    window.pxecore?.audio?.init?.();

    // brand mark
    initBrandMark();

    // Title character reset helper
    initSpecularSheenAndTitleCrystallization();

    window.pxecore?._initTerminal?.();

    // Footer year
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
        currentYearElement.textContent = new Date().getFullYear();
    }

    // Release button focus after pointer click
    const sessionCopyBtn = document.querySelector('.session-btn');
    if (sessionCopyBtn) {
        sessionCopyBtn.addEventListener('mouseup', () => sessionCopyBtn.blur());
    }

    // Theme toggle blur management
    if (themeToggleButton) {
        themeToggleButton.addEventListener('mouseup', () => themeToggleButton.blur());
        themeToggleButton.addEventListener('mouseleave', () => themeToggleButton.blur());
    }

    // Tech items tooltips are now handled entirely by CSS :hover

    // In-Place SPA View Routing (Home / Resume / Notes)
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    const viewButtons = document.querySelectorAll('[data-tab]');
    const views = {
        home: document.getElementById('view-home'),
        resume: document.getElementById('view-resume'),
        notes: document.getElementById('view-notes'),
        shelf: document.getElementById('view-shelf')
    };
    currentActiveView = currentActiveView || 'home';

    function switchView(tabName, updateHash = true, isInitial = false) {
        const isShelfRoute = tabName === 'books' || tabName === 'cinema' || tabName === 'shelf' || tabName === 'library';
        const shelfFocus = tabName === 'cinema' ? 'cinema' : 'books';
        const shelfHash = (tabName === 'cinema' || tabName === 'books') ? tabName : 'library';
        const targetView = isShelfRoute ? 'shelf' : (views[tabName] ? tabName : 'home');

        // Guard against redundant switch when already on active tab, but smooth scroll to top if scrolled down
        if (!isInitial && targetView === currentActiveView && !isShelfRoute) {
            if ((window.pageYOffset || document.documentElement.scrollTop || 0) > 20) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            return;
        }

        // On initial page load, if home is already active, preserve its smooth initial entrance animation
        if (isInitial && targetView === 'home' && views.home && views.home.classList.contains('site-view-active')) {
            currentActiveView = 'home';
            document.documentElement.removeAttribute('data-initial-view');
            return;
        }

        currentActiveView = targetView;
        window.currentActiveView = targetView;
        document.documentElement.removeAttribute('data-initial-view');
        if (!isInitial) {
            document.documentElement.classList.add('views-warmed', 'view-in-transition');
            setTimeout(() => {
                document.documentElement.classList.remove('view-in-transition');
            }, 340);
        } else {
            document.documentElement.classList.add('views-warmed');
        }

        // Dynamically synchronize skip-to-content target
        const skipLink = document.getElementById('skip-to-content');
        if (skipLink) {
            skipLink.setAttribute('href', `#view-${targetView}`);
        }

        Object.entries(views).forEach(([name, el]) => {
            if (!el) return;
            if (name === targetView) {
                el.removeAttribute('hidden');
                el.classList.add('site-view-active');
            } else {
                el.classList.remove('site-view-active');
                el.setAttribute('hidden', '');
            }
        });

        // Update Document Title (Browser Tab Title)
        const titleMap = {
            home: 'pxecore',
            notes: 'pxecore · notes',
            resume: 'pxecore · resume',
            shelf: shelfFocus === 'cinema' ? 'pxecore · cinema' : 'pxecore · library'
        };
        if (targetView !== 'notes' || !document.body.classList.contains('reader-focused')) {
            document.title = titleMap[targetView] || 'pxecore';
        }

        // Synchronize URL Hash (#notes, #resume, #home, #library, #books, #cinema) in browser address bar
        if (updateHash) {
            const targetHash = isShelfRoute ? `#${shelfHash}` : `#${targetView}`;
            try {
                if (window.location.protocol === 'file:') {
                    if (window.location.hash !== targetHash) {
                        window.location.hash = targetHash;
                    }
                } else {
                    if (window.location.hash !== targetHash) {
                        history.pushState(null, '', targetHash);
                    }
                }
            } catch (_) {
                try {
                    window.location.hash = targetHash;
                } catch (_) { }
            }
        }

        if (targetView === 'notes') {
            requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('notes-view-activated'));
            });
        } else {
            if (targetView === 'shelf') {
                window.pxecore?.shelf?.mount?.(shelfFocus);
            } else if (targetView === 'home') {
                window.pxecore?.audio?.resumeVisualizerIfPlaying?.();
            }
            if (typeof window.__returnToNotesDeck === 'function') {
                window.__returnToNotesDeck(false);
            }
            document.body.classList.remove('reader-focused');
            const pBar = document.getElementById('notes-reader-progress-bar');
            if (pBar) pBar.style.width = '0%';
            window.dispatchEvent(new CustomEvent('notes-view-deactivated'));
        }

        if (!isInitial && !(targetView === 'shelf' && shelfFocus === 'cinema')) {
            window.scrollTo(0, 0);
        }
    }
    window.switchView = switchView;

    viewButtons.forEach(btn => {
        const tab = btn.getAttribute('data-tab');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (tab === 'notes' && currentActiveView === 'notes') {
                const notesReaderEl = document.getElementById('notes-reader-view');
                const isReaderActive = document.body.classList.contains('reader-focused') ||
                    Boolean(notesReaderEl && notesReaderEl.style.display !== 'none');
                if (isReaderActive) {
                    if (typeof window.__returnToNotesDeck === 'function') {
                        window.__returnToNotesDeck();
                    } else {
                        const returnBtn = document.getElementById('reader-return-btn');
                        if (returnBtn) returnBtn.click();
                    }
                    return;
                }
            }
            switchView(tab, true);
        });
        btn.addEventListener('mouseup', () => btn.blur());
        btn.addEventListener('mouseleave', () => btn.blur());
        btn.addEventListener('touchend', () => btn.blur(), { passive: true });
    });

    // Handle back/forward navigation
    function handleRouting() {
        const rawHash = (window.location.hash || '').replace('#', '');
        const hash = rawHash.split('?')[0].split('/')[0];
        const params = new URLSearchParams(window.location.search);
        if (rawHash.startsWith('notes?p=') || rawHash.startsWith('notes/') || params.has('p')) {
            if (currentActiveView !== 'notes') {
                switchView('notes', false);
            }
            return;
        }
        if (hash === 'books' || hash === 'cinema' || hash === 'shelf' || hash === 'library') {
            switchView(hash, false);
            return;
        }
        if (views[hash]) {
            if (currentActiveView !== hash) {
                switchView(hash, false);
            }
        } else if (!hash) {
            if (currentActiveView !== 'home') {
                switchView('home', false);
            }
        }
    }
    window.addEventListener('hashchange', handleRouting);
    window.addEventListener('popstate', handleRouting);

    // Bind Resume slash index & Shelf jump links
    document.addEventListener('click', (e) => {
        const shelfLink = e.target?.closest?.('.resume-index-link, .shelf-jump-link');
        if (!shelfLink) return;
        const href = shelfLink.getAttribute('href') || '';
        const target = href.replace('#', '');
        if (target === 'books' || target === 'cinema' || target === 'library') {
            e.preventDefault();
            switchView(target, true);
        }
    });

    // Initial routing on load: defaults to home view unless explicit hash #resume, #notes, #library, #books, #cinema or ?p= is provided
    const initialHash = window.location.hash.replace('#', '').split('?')[0].split('/')[0];
    const urlParams = new URLSearchParams(window.location.search);
    if (initialHash === 'notes' || urlParams.has('p')) {
        switchView('notes', false, true);
    } else if (initialHash === 'resume') {
        switchView('resume', false, true);
    } else if (initialHash === 'books' || initialHash === 'cinema' || initialHash === 'shelf' || initialHash === 'library') {
        switchView(initialHash, false, true);
    } else {
        switchView('home', false, true);
    }


    // Independent hover & touch pause for Web Badges rows
    const badgeRows = document.querySelectorAll('.web-badges-row');
    document.querySelectorAll('.web-badges-row a').forEach(link => {
        link.addEventListener('click', () => {
            link.blur();
        });
    });
    badgeRows.forEach(row => {
        row.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            badgeRows.forEach(r => { if (r !== row) r.classList.remove('is-paused'); });
            row.classList.toggle('is-paused');
        }, { passive: true });
    });
    document.addEventListener('touchstart', (e) => {
        if (!e.target.closest('.web-badges-row')) {
            badgeRows.forEach(r => r.classList.remove('is-paused'));
        }
    }, { passive: true });

    // Initialize cosmic starfield (respects prefers-reduced-motion)
    try {
        initCosmicStarfield();
    } catch (err) {
        console.warn('[Effects] Starfield initialization caught:', err);
    }

    if (savedTheme === 'dark' && typeof initializeParticles === 'function') {
        requestAnimationFrame(() => {
            try {
                if (!window.pJSDom?.[0]?.pJS && !document.documentElement.classList.contains('light')) {
                    initializeParticles(getSky().hex, false);
                }
            } catch (err) {
                console.warn('[Particles] Initial mount caught:', err);
            }
        });
    }

    // Initialize native research notes module
    try {
        initResearchNotes();
    } catch (err) {
        console.warn('[Notes] Research notes initialization caught:', err);
    }

    // Print DevTools console banner & helper API
    try {
        initDevToolsConsoleBanner();
    } catch (_) { }

    document.documentElement.classList.add('views-warmed');
    mainBootstrapTime = performance.now();

    // preload alternate wallpaper on toggle hover/focus
    if (themeToggleButton && !navigator.connection?.saveData) {
        let wallpaperWarmed = false;
        const warmOtherWallpaper = () => {
            if (wallpaperWarmed) return;
            wallpaperWarmed = true;
            const isLight = document.documentElement.classList.contains('light');
            const img = new Image();
            img.decoding = 'async';
            img.src = isLight ? 'media/bg_dark.webp' : 'media/bg_light.webp';
        };
        themeToggleButton.addEventListener('pointerenter', warmOtherWallpaper, { once: true, passive: true });
        themeToggleButton.addEventListener('focus', warmOtherWallpaper, { once: true, passive: true });
        themeToggleButton.addEventListener('touchstart', warmOtherWallpaper, { once: true, passive: true });
    }

    // unregister legacy service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => {
            for (const reg of regs) reg.unregister();
        }).catch(() => { });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapSite);
} else {
    bootstrapSite();
}

// devtools console banner & helper api
function initDevToolsConsoleBanner() {
    try {
        if (window.__pxecoreDevToolsInit) return;
        window.__pxecoreDevToolsInit = true;

        const bannerArt = [
            '',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡤⢤⣤⣤⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢀⣶⣧⣐⠍⢙⣀⣼⣿⣿⣅⡐⠆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠉⠙⠻⣿⣿⣿⣿⣿⣯⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠠⣶⠆⠀⢀⣺⡃⣀⠀⠀⠀⠈⢿⣿⣿⣿⣿⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⣸⣷⣼⠆⠀⡌⢹⣿⣿⠀⢄⠀⠀⠈⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⢀⣿⣿⣿⠀⠸⣷⣿⣿⣿⣆⣠⣿⡄⠀⣼⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⢸⣿⣿⣿⠂⠀⠹⡿⣿⣿⣿⣿⣿⠀⠀⠟⠈⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⣿⣿⣿⠏⢰⣿⣦⡀⠚⠛⢿⣿⡿⠀⠀⢸⠇⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⢠⢿⣿⣿⠀⢾⣿⣿⡇⢻⡏⠀⠀⠀⠀⠀⡆⢰⣿⣿⡗⢠⣿⣿⣷⣦⣤⣤⣀⣤⣀⣀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠈⠙⠒⠿⠿⣿⣿⠸⠇⠀⠀⠀⠀⠀⣷⠘⣿⠟⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⢆⣠',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢸⣧⠀⠀⠀⠀⠀⠀⣿⠀⣃⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠏⠘⠉',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢸⣧⠀⠀⠀⠀⠀⠀⢄⣸⣿⣿⣿⣿⣭⣭⡉⠉⠉⠉⠈⠉⠀⠉⠉⠁⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢸⠛⢸⡄⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢸⣶⢸⣷⠀⠀⠀⠀⠈⣇⣽⣿⣿⣿⣿⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠸⠛⠈⠉⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠁⢷⡆⠀⠀⠀⠀⠀⠀⠈⣄⣼⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠃⠀⠀⠀⠀⠀⠀⠀⢹⠛⢿⣿⠟⠁⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠚⠀⣴⡀⢰⡆⢀⣤⣄⣒⡉⠀⣶⣀⣎⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⡟⠀⣼⡿⣷⢾⠇⢠⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣉⠛⠛⠁⢴⣽⣷⣧⣼⡄⠸⣽⡿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⣿⣿⣿⣯⣿⣿⣿⣿⣿⣷⡶⣦⣴⡦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡯⢽⢿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣰⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⢾⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠐⠀⠀⠉⠙⠛⠻⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣏⣾⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠛⠻⠿⢿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠈⢰⣶⠀⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⢸⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠘⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
            '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠛⠋⠀⠀⠀⠀⠀⠀⠀⠀',
            ''
        ].join('\n');

        const isNarrowScreen = typeof window !== 'undefined' && window.innerWidth < 640;
        const style = [
            'color: #D8B278',
            'font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            'font-weight: 700',
            `font-size: ${isNarrowScreen ? '10px' : '11px'}`,
            'line-height: 1.15',
            'text-shadow: 0 0 10px rgba(216, 178, 120, 0.40)'
        ].join(';');

        console.log(`%c${bannerArt}`, style);

        window.pxecore = window.pxecore || {};
        window.pxecore.version = '2.5.1';
        window.pxecore.author = 'pxecore';
        window.pxecore.status = function () {
            console.table({
                'Node': 'pxecore',
                'Status': 'ONLINE',
                'Theme': document.documentElement.classList.contains('light') ? 'light' : 'dark',
                'Matrix': window.__pxecoreMatrixRunning ? 'running' : 'idle',
                'Engine': 'canvas2d'
            });
            return 'status logged';
        };
        window.pxecore.help = function () {
            console.log(
                '%c[pxecore terminal guide]\n' +
                'commands : help, fastfetch, matrix, whoami, github, clear\n' +
                'helpers  : pxecore.status(), pxecore.matrix()',
                'color: #D8B278; font-family: monospace;'
            );
            return 'help logged';
        };
        window.pxecore.matrix = function () {
            const inputEl = document.getElementById('terminal-hidden-input');
            if (inputEl) {
                inputEl.value = 'matrix';
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                return 'matrix started';
            }
            return 'terminal input not found';
        };
    } catch (_) { }
}
