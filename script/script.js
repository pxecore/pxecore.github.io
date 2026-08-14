/* ═══════════════════════════════════════════════════════════
 * UNIFIED SKY — one palette, two depths
 *   Far  : starfield pinpricks + rare sparkles (canvas)
 *   Near : constellation nodes + links (particles.js)
 * Same accent family, same tempo, no competing glow blobs.
 * ═══════════════════════════════════════════════════════════ */
const SKY = {
    dark: {
        hex: '#c9a66e',
        rgb: '201, 166, 110',
        rgbBright: '245, 232, 210',
        rgbDim: '170, 140, 95',
        dotOp: 0.72,
        lineOp: 0.38,
        lineW: 1.15,
        grabLineOp: 0.72,
        countScale: 1,
        sizeScale: 1,
        distScale: 1,
        starBgOp: [0.40, 0.90],
        starMedOp: [0.50, 0.95],
        sparkleOp: [0.55, 0.95]
    },
    light: {
        // Warm terracotta (old site #8c4a32) — readable on cream, not muddy ink
        hex: '#8c4a32',
        rgb: '140, 74, 50',
        rgbBright: '112, 56, 38',
        rgbDim: '168, 102, 74',
        dotOp: 0.78,
        lineOp: 0.54,
        lineW: 1.4,
        grabLineOp: 0.65,
        countScale: 1,
        sizeScale: 1,
        distScale: 1,
        starBgOp: [0.50, 0.88],
        starMedOp: [0.55, 0.92],
        sparkleOp: [0.60, 0.95]
    }
};

function getSky() {
    return document.body.classList.contains('light-theme') ? SKY.light : SKY.dark;
}

/** Resolve palette from an explicit ink color (theme-flip safe). */
function skyFromInk(hex) {
    if (hex === SKY.light.hex) return SKY.light;
    if (hex === SKY.dark.hex) return SKY.dark;
    return getSky();
}

/* ═══════════════════════════════════════════════════════════
 * PARTICLES — density locked to screen buckets (no swarm/cap fight)
 *   • density.value_area sized so count ≈ number.value
 *   • width buckets for base count (40–100)
 *   • hard reinit on significant viewport area change
 *   • SKY palette + pointer bridge for grab/click
 * ═══════════════════════════════════════════════════════════ */

const particleConfigBase = {
    particles: {
        number: {
            value: 80,
            density: { enable: false, value_area: 800 }
        },
        shape: { type: 'circle' },
        opacity: {
            value: 0.7,
            random: false,
            anim: { enable: false }
        },
        size: {
            value: 2.2,
            random: true,
            anim: { enable: false }
        },
        line_linked: {
            enable: true,
            distance: 140,
            opacity: 0.40,
            width: 1
        },
        move: {
            enable: true,
            speed: 0.72,
            direction: 'none',
            random: false,
            straight: false,
            out_mode: 'out',
            bounce: false,
            attract: { enable: false, rotateX: 0, rotateY: 0 }
        }
    },
    interactivity: {
        // canvas + pointer-events:none → native listeners never fire; bridge owns coords
        detect_on: 'canvas',
        events: {
            onhover: { enable: true, mode: 'grab' },
            // Native click off — pointer bridge pushes (canvas is pointer-events:none)
            onclick: { enable: false, mode: 'push' },
            resize: false
        },
        modes: {
            grab: { distance: 120, line_linked: { opacity: 0.55 } },
            push: { particles_nb: 1 }
        }
    },
    retina_detect: true,
    fps_limit: 60
};

/**
 * Width buckets only affect count/size/distance — never gate grab/click.
 * (Browser zoom shrinks innerWidth below 768 and used to look like "mobile".)
 */

/**
 * Hardware + viewport particle settings.
 * Width buckets set baseline; area cap keeps zoomed-in / small screens clean.
 */
function getParticleSettingsForScreen(screenWidth) {
    let count = 80;
    let size = 2.2;
    let distance = 110;

    if (screenWidth >= 1920) {
        count = 100; size = 2.4; distance = 120;
    } else if (screenWidth >= 1440) {
        count = 90;  size = 2.3; distance = 110;
    } else if (screenWidth >= 1024) {
        count = 80;  size = 2.2; distance = 100;
    } else if (screenWidth >= 768) {
        count = 70;  size = 2.0; distance = 90;
    } else if (screenWidth >= 480) {
        count = 55;  size = 1.8; distance = 80;
    } else {
        count = 42;  size = 1.55; distance = 70;
    }

    const cores = navigator.hardwareConcurrency;
    const memory = navigator.deviceMemory;
    if (cores && memory) {
        if (cores < 2 && memory < 2) {
            count = Math.floor(count * 0.6);
        } else if (cores < 4 || memory < 4) {
            count = Math.floor(count * 0.8);
        }
    }

    // Area cap — zoom-in / tiny windows must drop count (not just width buckets)
    const area = Math.max(1, (window.innerWidth || screenWidth) * (window.innerHeight || 1));
    const areaCap = Math.max(40, Math.min(100, Math.round(area / 14000)));
    count = Math.min(count, areaCap);

    count = Math.max(40, Math.min(count, 100));
    return { count, size, distance };
}

function hexToRgbSafe(hex) {
    if (typeof hexToRgb === 'function') {
        return hexToRgb(hex);
    }
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 194, g: 159, b: 104 };
}

/**
 * Apply SKY ink to a live instance (colors/opacity/width only).
 */
function tintParticles(pJSInstance, particleColor) {
    const sky = skyFromInk(particleColor);
    const color = particleColor || sky.hex;

    pJSInstance.particles.color.value = color;
    pJSInstance.particles.color.rgb = hexToRgbSafe(color);

    if (pJSInstance.particles.line_linked) {
        pJSInstance.particles.line_linked.color = color;
        pJSInstance.particles.line_linked.color_rgb_line = hexToRgbSafe(color);
        pJSInstance.particles.line_linked.opacity = sky.lineOp;
        pJSInstance.particles.line_linked.width = sky.lineW;
    }

    pJSInstance.particles.opacity.value = sky.dotOp;
    pJSInstance.particles.opacity.random = false;
    if (pJSInstance.particles.opacity.anim) {
        pJSInstance.particles.opacity.anim.enable = false;
    }
    if (pJSInstance.interactivity?.modes?.grab?.line_linked) {
        pJSInstance.interactivity.modes.grab.line_linked.opacity =
            sky.grabLineOp || particleConfigBase.interactivity.modes.grab.line_linked.opacity;
    }

    const arr = pJSInstance.particles.array;
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.color.value = color;
        p.color.rgb = hexToRgbSafe(color);
        p.opacity = sky.dotOp;
    }
}

/**
 * Keep canvas buffer sized to the element (resize:false in particles.js).
 */
function syncParticleCanvasSize(pJSInstance) {
    const el = pJSInstance.canvas && pJSInstance.canvas.el;
    if (!el) return;
    const pxratio = window.devicePixelRatio || 1;
    const w = Math.round(el.offsetWidth * pxratio);
    const h = Math.round(el.offsetHeight * pxratio);
    if (pJSInstance.canvas.w === w && pJSInstance.canvas.h === h && pJSInstance.canvas.pxratio === pxratio) {
        return;
    }
    pJSInstance.canvas.pxratio = pxratio;
    pJSInstance.tmp = pJSInstance.tmp || {};
    pJSInstance.tmp.retina = pxratio > 1;
    pJSInstance.canvas.w = w;
    pJSInstance.canvas.h = h;
    el.width = w;
    el.height = h;
}

/**
 * Map viewport client coords → particles.js canvas buffer pixels.
 * Uses the canvas bitmap size (el.width/height) as source of truth so
 * stale pJS.canvas.w/h cannot create dead click zones.
 */
function clientToParticleCanvas(pJS, clientX, clientY) {
    const el = pJS.canvas && pJS.canvas.el;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const bw = el.width || pJS.canvas.w;
    const bh = el.height || pJS.canvas.h;
    if (!bw || !bh) return null;
    // Keep particles.js bookkeeping aligned with the bitmap
    if (pJS.canvas.w !== bw) pJS.canvas.w = bw;
    if (pJS.canvas.h !== bh) pJS.canvas.h = bh;
    return {
        x: ((clientX - rect.left) / rect.width) * bw,
        y: ((clientY - rect.top) / rect.height) * bh
    };
}

/**
 * Strip native particles.js mouse listeners — bridge is the only coordinate source.
 * Clears both canvas and window targets (old detect_on:'window' leftovers).
 */
function detachNativeParticleMouse(pJS) {
    if (!pJS || !pJS.fn) return;
    const targets = [];
    if (pJS.interactivity && pJS.interactivity.el) targets.push(pJS.interactivity.el);
    if (pJS.canvas && pJS.canvas.el) targets.push(pJS.canvas.el);
    targets.push(window);
    for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        try {
            if (pJS.fn.onMouseMove) el.removeEventListener('mousemove', pJS.fn.onMouseMove);
            if (pJS.fn.onMouseLeave) el.removeEventListener('mouseleave', pJS.fn.onMouseLeave);
            if (pJS.fn.onClick) el.removeEventListener('click', pJS.fn.onClick);
        } catch (_) { /* ignore */ }
    }
}

/**
 * Pointer bridge — canvas is pointer-events:none; feeds grab + click/tap push.
 * Works on mobile and when browser zoom shrinks innerWidth below 768.
 */
function ensureParticlePointerBridge() {
    if (window.__pxeParticleBridge) return;
    window.__pxeParticleBridge = true;

    // Only real controls — NOT whole cards/terminal (those blocked sky clicks in half the viewport)
    const interactiveSel =
        'a,button,input,textarea,select,label,summary,' +
        '[role="button"],[role="link"],[role="menuitem"],' +
        '.header-btn,.contact-btn,.icon-button,.social-link,.tech-item,' +
        '.theme-toggle,.vocalizer,.terminal-link,.terminal-btn,' +
        '.resume-overlay,.resume-panel,.resume-window,.resume-header';

    function livePJS() {
        return window.pJSDom?.[0]?.pJS || null;
    }

    function setMouse(pJS, clientX, clientY) {
        const pt = clientToParticleCanvas(pJS, clientX, clientY);
        if (!pt) return false;
        pJS.interactivity.mouse.pos_x = pt.x;
        pJS.interactivity.mouse.pos_y = pt.y;
        pJS.interactivity.status = 'mousemove';
        return true;
    }

    function clearMouse(pJS) {
        pJS.interactivity.mouse.pos_x = null;
        pJS.interactivity.mouse.pos_y = null;
        pJS.interactivity.status = 'mouseleave';
    }

    function isInteractiveTarget(target) {
        return !!(target && target.closest && target.closest(interactiveSel));
    }

    function inCanvas(pJS, clientX, clientY) {
        const el = pJS.canvas && pJS.canvas.el;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }

    function spawnAt(pJS, clientX, clientY) {
        if (!pJS.fn?.modes?.pushParticles) return false;
        if (!pJS.particles?.move?.enable) return false;

        const pt = clientToParticleCanvas(pJS, clientX, clientY);
        if (!pt) return false;
        // Outside the visible canvas bitmap → no silent off-screen spawn
        if (pt.x < 0 || pt.y < 0 || pt.x > pJS.canvas.w || pt.y > pJS.canvas.h) return false;

        const base = pJS.particles.number.value || 80;
        const max = base + 12;
        const arr = pJS.particles.array;
        const n = pJS.interactivity.modes.push.particles_nb || 1;
        // Recycle oldest extras instead of hard-failing (felt like random dead zones)
        if (arr && arr.length + n > max) {
            const overflow = arr.length + n - max;
            if (pJS.fn.modes.removeParticles) pJS.fn.modes.removeParticles(overflow);
            else arr.splice(0, overflow);
        }

        // pushParticles reads mouse.pos_x/pos_y (NOT click_pos_*)
        pJS.interactivity.mouse.pos_x = pt.x;
        pJS.interactivity.mouse.pos_y = pt.y;
        pJS.interactivity.mouse.click_pos_x = pt.x;
        pJS.interactivity.mouse.click_pos_y = pt.y;
        pJS.fn.modes.pushParticles(n, { pos_x: pt.x, pos_y: pt.y });
        return true;
    }

    // Track touch taps so we can spawn on pointerup (mobile click is flaky / delayed)
    let touchTap = null;

    window.addEventListener('pointerdown', (e) => {
        if (isInteractiveTarget(e.target)) return;
        const pJS = livePJS();
        if (!pJS || !pJS.interactivity?.events?.onhover?.enable) return;
        if (!inCanvas(pJS, e.clientX, e.clientY)) return;

        setMouse(pJS, e.clientX, e.clientY);

        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            touchTap = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
        }
    }, { passive: true });

    window.addEventListener('pointermove', (e) => {
        const pJS = livePJS();
        if (!pJS || !pJS.interactivity?.events?.onhover?.enable) return;

        if (touchTap && e.pointerId === touchTap.id) {
            const dx = e.clientX - touchTap.x;
            const dy = e.clientY - touchTap.y;
            if (dx * dx + dy * dy > 100) touchTap.moved = true; // >10px → scroll/drag, not tap
        }

        // Grab still works over cards — only skip when leaving the viewport canvas
        if (!inCanvas(pJS, e.clientX, e.clientY)) {
            clearMouse(pJS);
            return;
        }
        setMouse(pJS, e.clientX, e.clientY);
    }, { passive: true });

    function endPointer(e) {
        const pJS = livePJS();
        if (!pJS) return;

        // Mobile/pen tap spawn (before click may or may not fire)
        if (touchTap && e.pointerId === touchTap.id) {
            const tap = touchTap;
            touchTap = null;
            if (!tap.moved && !isInteractiveTarget(e.target) && inCanvas(pJS, tap.x, tap.y)) {
                spawnAt(pJS, tap.x, tap.y);
                // Suppress the delayed synthetic click spawn for this gesture
                window.__pxeSkipClickSpawnUntil = Date.now() + 500;
            }
            clearMouse(pJS);
            return;
        }

        // Mouse: keep grab while cursor is over canvas; clear if left
        if (e.pointerType === 'mouse' && !inCanvas(pJS, e.clientX, e.clientY)) {
            clearMouse(pJS);
        }
    }

    window.addEventListener('pointerup', endPointer, { passive: true });
    window.addEventListener('pointercancel', (e) => {
        touchTap = null;
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    }, { passive: true });

    window.addEventListener('blur', () => {
        touchTap = null;
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    });

    document.documentElement.addEventListener('mouseleave', () => {
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    });

    // Desktop / leftover click spawn (capture)
    window.addEventListener('click', (e) => {
        if (window.__pxeSkipClickSpawnUntil && Date.now() < window.__pxeSkipClickSpawnUntil) return;
        if (isInteractiveTarget(e.target)) return;
        const pJS = livePJS();
        if (!pJS) return;
        if (!inCanvas(pJS, e.clientX, e.clientY)) return;
        spawnAt(pJS, e.clientX, e.clientY);
    }, true);
}

/**
 * particles.js lifecycle.
 * Soft path = tint/retune only (NO canvas-size rebuild — that caused zoom clump/lag).
 * Hard path = destroy + recreate (used after viewport settles).
 */
function initializeParticles(particleColor, forceReinit = false) {
    const particlesJSElement = document.getElementById('particles-js');
    if (!particlesJSElement) return;

    ensureParticlePointerBridge();

    const live = window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS;
    const sky = skyFromInk(particleColor);
    const color = particleColor || sky.hex;

    // Soft path: colors / grab opacity only — never particlesRefresh on live canvas
    if (!forceReinit && live) {
        const pJSInstance = live;
        tintParticles(pJSInstance, color);
        pJSInstance.interactivity.events.onhover.enable = true;
        pJSInstance.interactivity.events.onclick.enable = false;
        detachNativeParticleMouse(pJSInstance);
        return;
    }

    // Hard reinit
    if (window.pJSDom && window.pJSDom[0]) {
        try {
            if (window.pJSDom[0].pJS?.fn?.vendors?.destroypJS) {
                window.pJSDom[0].pJS.fn.vendors.destroypJS();
            }
        } catch (e) {
            console.warn('Particles destroy failed:', e);
        }
        window.pJSDom = [];
        particlesJSElement.querySelectorAll('canvas').forEach(c => c.remove());
    }

    let currentParticleConfig = JSON.parse(JSON.stringify(particleConfigBase));
    currentParticleConfig.particles.color = { value: color };
    currentParticleConfig.particles.line_linked.color = color;
    currentParticleConfig.particles.opacity.value = sky.dotOp;
    currentParticleConfig.particles.opacity.random = false;
    currentParticleConfig.particles.opacity.anim = { enable: false };
    currentParticleConfig.particles.line_linked.opacity = sky.lineOp;
    currentParticleConfig.particles.line_linked.width = sky.lineW;
    currentParticleConfig.interactivity.modes.grab.line_linked.opacity =
        sky.grabLineOp || particleConfigBase.interactivity.modes.grab.line_linked.opacity;
    currentParticleConfig.interactivity.events.onhover.enable = true;
    currentParticleConfig.interactivity.events.onclick.enable = false;

    const { count, size, distance } = getParticleSettingsForScreen(window.innerWidth);
    currentParticleConfig.particles.number.value = count;
    currentParticleConfig.particles.size.value = size;
    currentParticleConfig.particles.line_linked.distance = distance;
    // Exact count — density auto-push during zoom was flooding edges with fat nodes
    currentParticleConfig.particles.number.density.enable = false;

    try {
        if (typeof particlesJS === 'undefined') {
            let retries = 0;
            const maxRetries = 10;
            const retryInterval = setInterval(() => {
                if (typeof particlesJS !== 'undefined') {
                    clearInterval(retryInterval);
                    particlesJS('particles-js', currentParticleConfig);
                    finalizeParticlesInit();
                } else if (++retries >= maxRetries) {
                    clearInterval(retryInterval);
                    triggerParticlesFallback();
                }
            }, 100);
            return;
        }

        particlesJS('particles-js', currentParticleConfig);
        finalizeParticlesInit();
    } catch (error) {
        triggerParticlesFallback(error);
    }
}

function triggerParticlesFallback(error) {
    if (error) console.warn('Particles.js fallback triggered:', error.message);
    const particlesContainer = document.getElementById('particles-js');
    if (particlesContainer) {
        particlesContainer.classList.add('fallback-background');
    }
    document.body.classList.add('fallback-mode');
}

function finalizeParticlesInit() {
    if (!(window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS)) return;
    const pJSInstance = window.pJSDom[0].pJS;

    // Match buffer to element; keep exact number.value (density off — no edge flood)
    syncParticleCanvasSize(pJSInstance);
    pJSInstance.particles.number.density.enable = false;

    // Drop any extras left from a previous session / race
    const target = pJSInstance.particles.number.value || 80;
    const arr = pJSInstance.particles.array;
    if (arr && arr.length > target && pJSInstance.fn?.modes?.removeParticles) {
        pJSInstance.fn.modes.removeParticles(arr.length - target);
    }

    pJSInstance.interactivity.detect_on = 'canvas';
    pJSInstance.interactivity.el = pJSInstance.canvas.el;
    detachNativeParticleMouse(pJSInstance);

    const particlesJSElement = document.getElementById('particles-js');
    if (particlesJSElement) {
        particlesJSElement.style.pointerEvents = 'none';
        particlesJSElement.style.zIndex = '-1';
        particlesJSElement.style.position = 'fixed';
    }
}

// Theme toggle logic
const themeToggleButton = document.getElementById('theme-toggle');
const body = document.body;
let initialWindowArea;

/**
 * Blackletter P — calligraphy ink-in (lamp), magnetism, spin.
 */
function initBrandMark() {
    const mark = document.getElementById('brand-mark');
    if (!mark) return;

    const stage = mark.querySelector('.logo-stage');
    const path = mark.querySelector('.logo-mark path');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (path && !reduced) {
        const length = path.getTotalLength();
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
        mark.classList.add('is-inking');

        requestAnimationFrame(() => {
            path.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)';
            path.style.strokeDashoffset = '0';
        });

        window.setTimeout(() => {
            mark.classList.remove('is-inking');
            path.style.transition = '';
            path.style.strokeDasharray = '';
            path.style.strokeDashoffset = '';
        }, 1300);
    }

    let spinning = false;
    mark.addEventListener('click', () => {
        mark.blur();
        if (reduced || spinning) return;
        spinning = true;
        mark.classList.add('is-spinning');
        window.setTimeout(() => {
            mark.classList.remove('is-spinning');
            spinning = false;
        }, 920);
    });

    mark.addEventListener('mouseup', () => mark.blur());
    mark.addEventListener('pointerup', () => mark.blur());

    if (reduced || !stage || window.matchMedia('(pointer: coarse)').matches) return;

    const maxTilt = 7;
    mark.addEventListener('pointermove', (e) => {
        const rect = mark.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        mark.style.setProperty('--logo-rx', `${(-y * maxTilt).toFixed(2)}deg`);
        mark.style.setProperty('--logo-ry', `${(x * maxTilt).toFixed(2)}deg`);
    });

    mark.addEventListener('pointerleave', () => {
        mark.style.setProperty('--logo-rx', '0deg');
        mark.style.setProperty('--logo-ry', '0deg');
    });
}

/**
 * Apply theme to body and update particle colors
 * @param {string} theme - Theme to apply ('light' or 'dark').
 * @param {boolean} isInitialLoad - Whether this is the initial page load.
 */
function applyTheme(theme, isInitialLoad = false) {
    if (theme === 'light') {
        body.classList.add('light-theme');
        if (themeToggleButton) themeToggleButton.setAttribute('aria-pressed', 'true');
    } else {
        body.classList.remove('light-theme');
        if (themeToggleButton) themeToggleButton.setAttribute('aria-pressed', 'false');
    }
    localStorage.setItem('theme', theme);

    // Always rebuild constellation on theme change so SKY ink stays unified
    requestAnimationFrame(() => {
        initializeParticles(getSky().hex, true);
        if (typeof window.__resizeStarfield === 'function') {
            window.__resizeStarfield(true);
        } else if (typeof window.__regenStarfield === 'function') {
            window.__regenStarfield();
        }
    });
}

// Theme toggle button event listener
if (themeToggleButton) {
    themeToggleButton.addEventListener('click', () => {
        const currentTheme = body.classList.contains('light-theme') ? 'light' : 'dark';
        applyTheme(currentTheme === 'light' ? 'dark' : 'light', false);
    });
}

// === Page Visibility API — pause/resume particles on tab switch ===
document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? 'System Offline!' : 'pxecore';

    if (!window.pJSDom || !window.pJSDom[0] || !window.pJSDom[0].pJS) return;

    const pJS = window.pJSDom[0].pJS;
    try {
        if (document.hidden) {
            pJS.particles.move.enable = false;
        } else {
            pJS.particles.move.enable = true;
            // Resume drift — do NOT destroy/recreate (that caused blink/clump cycles)
            if (pJS.fn && pJS.fn.vendors && typeof pJS.fn.vendors.draw === 'function') {
                pJS.fn.vendors.draw();
            }
        }
    } catch(e) {
        console.warn('Visibility particle toggle failed:', e);
    }
});

/**
 * Debounce helper to limit how often a function can run.
 * @param {function} func
 * @param {number} wait
 * @param {boolean} immediate
 * @returns {function}
 */
function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

// Debounced viewport settle — one hard rebuild for particles + starfield together.
// Soft mid-zoom refresh was the lag/clump source (fat nodes flooding from edges).
let settledViewport = { w: 0, h: 0, area: 0 };

function settleSkyViewport(force = false) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const area = w * h;
    const prev = settledViewport;

    const dimChanged =
        Math.abs(w - prev.w) >= 20 || Math.abs(h - prev.h) >= 20;
    const areaChanged =
        Math.abs(area - (prev.area || area)) / Math.max(prev.area || area, 1) >= 0.06;

    if (!force && prev.w && !dimChanged && !areaChanged) return;

    settledViewport = { w, h, area };
    initialWindowArea = area;

    initializeParticles(getSky().hex, true);
    if (typeof window.__resizeStarfield === 'function') {
        window.__resizeStarfield(true);
    }
}

const handleResize = debounce(function () {
    settleSkyViewport(false);
}, 420);

window.addEventListener('resize', handleResize, { passive: true });
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize, { passive: true });
}



// === Session ID Copy (global — called from onclick in HTML) ===
function copySessionID() {
    const FIXED_SESSION_ID = '0500d49ca2b7d6e4149e53e8eba080f0b3795af952810f19bc21882121a7a4e760';

    navigator.clipboard.writeText(FIXED_SESSION_ID).then(function() {
        const el = document.getElementById('session-copied');
        if (el) {
            el.style.display = 'inline';
            setTimeout(() => { el.style.display = 'none'; }, 2000);
        }
    }).catch(function() {
        // Fallback for older browsers / iOS WebView
        const textArea = document.createElement('textarea');
        textArea.value = FIXED_SESSION_ID;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        const el = document.getElementById('session-copied');
        if (el) {
            el.style.display = 'inline';
            setTimeout(() => { el.style.display = 'none'; }, 2000);
        }
    });
}

// === Audio Player Control (global — called from onclick in HTML) ===
let audioPlaying = false;
let audioElement = null;

function toggleAudio() {
    try {
        if (!audioElement) {
            audioElement = document.getElementById('background-audio');
        }
        if (!audioElement) return;

        const vocalizer = document.getElementById('audio-vocalizer');
        const playBtn = vocalizer ? vocalizer.querySelector('.vocalizer-play-btn') : null;

        const playSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L448 256 73 39z"/></svg>`;
        const pauseSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H144c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48H384c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H288z"/></svg>`;
        const loadingSVG = `<svg viewBox="0 0 512 512" width="1em" height="1em" fill="currentColor" aria-hidden="true" class="audio-spinner"><path d="M304 48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zm0 416a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM48 304a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm464-48a48 48 0 1 0 -96 0 48 48 0 1 0 96 0zM142.9 437A48 48 0 1 0 75 369.1 48 48 0 1 0 142.9 437zm0-362A48 48 0 1 0 75 142.9 48 48 0 1 0 142.9 75zM369.1 437A48 48 0 1 0 437 369.1 48 48 0 1 0 369.1 437z"/></svg>`;

        // Dynamically set src only on first play to prevent 2MB load on initial page view
        if (!audioElement.src || audioElement.src === "" || audioElement.src === window.location.href) {
            // Show loading state immediately
            if (vocalizer) vocalizer.classList.add('loading');
            if (playBtn) playBtn.innerHTML = loadingSVG;

            audioElement.src = "media/hmm.opus";
            audioElement.load();
            
            // Restore saved position after metadata is loaded
            try {
                const savedTime = localStorage.getItem('audioCurrentTime');
                if (savedTime && !isNaN(parseFloat(savedTime)) && parseFloat(savedTime) >= 0) {
                    audioElement.addEventListener('loadedmetadata', function onMetadata() {
                        audioElement.currentTime = Math.min(parseFloat(savedTime), audioElement.duration || 0);
                        audioElement.removeEventListener('loadedmetadata', onMetadata);
                    });
                }
            } catch (e) { /* localStorage unavailable */ }

            // Auto-play once enough data is buffered
            audioElement.addEventListener('canplay', function onCanPlay() {
                audioElement.removeEventListener('canplay', onCanPlay);
                if (vocalizer) vocalizer.classList.remove('loading');
                audioElement.volume = 0.3;
                var playPromise = audioElement.play();
                if (playPromise !== undefined && typeof playPromise.then === 'function') {
                    playPromise.then(function() {
                        audioPlaying = true;
                        if (vocalizer) vocalizer.classList.add('playing');
                        if (playBtn) playBtn.innerHTML = pauseSVG;
                        try { localStorage.setItem('audioPlaying', 'true'); } catch (e) { /* */ }
                    }).catch(function() {
                        if (vocalizer) vocalizer.classList.remove('loading');
                        if (playBtn) playBtn.innerHTML = playSVG;
                    });
                } else {
                    audioPlaying = true;
                    if (vocalizer) vocalizer.classList.add('playing');
                    if (playBtn) playBtn.innerHTML = pauseSVG;
                }
            });
            return; // Wait for canplay event
        }

        if (audioPlaying) {
            audioElement.pause();
            audioPlaying = false;
            if (vocalizer) vocalizer.classList.remove('playing');
            if (playBtn) playBtn.innerHTML = playSVG;
            try {
                localStorage.setItem('audioPlaying', 'false');
                localStorage.setItem('audioCurrentTime', audioElement.currentTime);
            } catch (e) { /* localStorage unavailable */ }
        } else {
            audioElement.volume = 0.3;

            var playPromise = audioElement.play();
            // .then() only exists on modern browsers
            if (playPromise !== undefined && typeof playPromise.then === 'function') {
                playPromise.then(function() {
                    audioPlaying = true;
                    if (vocalizer) vocalizer.classList.add('playing');
                    if (playBtn) playBtn.innerHTML = pauseSVG;
                    try { localStorage.setItem('audioPlaying', 'true'); } catch (e) { /* */ }
                }).catch(function() { /* Autoplay blocked or audio error */ });
            } else {
                // Older browser: assume success
                audioPlaying = true;
                if (vocalizer) vocalizer.classList.add('playing');
                if (playBtn) playBtn.innerHTML = pauseSVG;
            }
        }
    } catch (error) { /* Audio control error */ }
}

// === Main Initialization ===
document.addEventListener('DOMContentLoaded', () => {
    initialWindowArea = window.innerWidth * window.innerHeight;
    settledViewport = {
        w: window.innerWidth,
        h: window.innerHeight,
        area: initialWindowArea
    };

    // Apply saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme, true);

    // Terminal date (Europe/Istanbul, UTC+3)
    const staticDateElement = document.getElementById('static-date');
    if (staticDateElement) {
        const now = new Date();
        const istanbulTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
        const year = istanbulTime.getUTCFullYear();
        const month = String(istanbulTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(istanbulTime.getUTCDate()).padStart(2, '0');
        const hours = String(istanbulTime.getUTCHours()).padStart(2, '0');
        const minutes = String(istanbulTime.getUTCMinutes()).padStart(2, '0');
        staticDateElement.textContent = `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    if (document.hidden) {
        document.title = 'System Offline!';
    }

    // Initialize audio state
    const audio = document.getElementById('background-audio');
    const vocalizer = document.getElementById('audio-vocalizer');

    if (audio) {
        audio.volume = 0.3;

        // Save current time periodically (throttled)
        let lastSaveTime = 0;
        audio.addEventListener('timeupdate', function() {
            if (audioPlaying && Date.now() - lastSaveTime > 1000) {
                try {
                    localStorage.setItem('audioCurrentTime', audio.currentTime);
                    lastSaveTime = Date.now();
                } catch (e) { /* localStorage unavailable */ }
            }
        });

        // Hide vocalizer if audio fails to load
        audio.addEventListener('error', function() {
            if (vocalizer) vocalizer.style.display = 'none';
        });
    }



    // Brand mark — ink-in, magnetic tilt, Mel-style spin
    initBrandMark();

    // Terminal buttons — blur after click
    ['terminal-btn-red', 'terminal-btn-yellow', 'terminal-btn-green'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => btn.blur());
            btn.addEventListener('mouseup', () => btn.blur());
        }
    });

    // Footer year
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
        currentYearElement.textContent = new Date().getFullYear();
    }

    // Session button blur management (click handled by onclick attribute)
    const sessionCopyBtn = document.querySelector('.session-btn');
    if (sessionCopyBtn) {
        sessionCopyBtn.addEventListener('mouseup', () => sessionCopyBtn.blur());
    }

    // Theme toggle blur management
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => {
            setTimeout(() => {
                themeToggleButton.blur();
                document.activeElement.blur();
            }, 50);
        });
        themeToggleButton.addEventListener('mouseup', () => themeToggleButton.blur());
        themeToggleButton.addEventListener('mouseleave', () => themeToggleButton.blur());
    }

    // Tech items tooltips are now handled entirely by CSS :hover

    // Integrated Resume Panel Logic
    // Draggable Window Logic
    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            if (window.innerWidth <= 768) return; // Disable on mobile
            e = e || window.event;
            e.preventDefault();
            // Get mouse position at startup
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            element.classList.add('dragging');
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            // Calculate new position
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            // Set element's new position
            let newTop = element.offsetTop - pos2;
            let newLeft = element.offsetLeft - pos1;

            // Bounds checking (prevent dragging completely off-screen)
            const margin = 40;
            newTop = Math.max(margin, Math.min(newTop, window.innerHeight - margin));
            newLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - margin));

            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";
            element.style.transform = "translate(-50%, -50%)"; // Keep centered relative to new point
        }

        function closeDragElement() {
            // Stop moving when mouse button is released
            document.onmouseup = null;
            document.onmousemove = null;
            element.classList.remove('dragging');
        }
    }

    // Media fallbacks removed for privacy.

    const resumeBtn = document.getElementById('resume-btn');
    const closeResumeBtn = document.getElementById('close-resume');
    const resumePanel = document.getElementById('resume-panel');
    const resumeHeader = document.getElementById('resume-header');
    const panelBackdrop = document.getElementById('panel-backdrop');

    if (resumeBtn && resumePanel && panelBackdrop) {
        const toggleResume = (show) => {
            if (show) {
                // Reset position to center whenever opened
                resumePanel.style.top = "50%";
                resumePanel.style.left = "50%";
                resumePanel.classList.add('active');
                panelBackdrop.classList.add('active');
                document.body.style.overflow = 'hidden';
            } else {
                resumePanel.classList.remove('active');
                panelBackdrop.classList.remove('active');
                document.body.style.overflow = '';
            }
        };

        const mobileCloseResumeBtn = document.getElementById('mobile-close-resume');

        resumeBtn.addEventListener('click', () => toggleResume(true));
        closeResumeBtn.addEventListener('click', () => toggleResume(false));
        if (mobileCloseResumeBtn) {
            mobileCloseResumeBtn.addEventListener('click', () => toggleResume(false));
        }
        panelBackdrop.addEventListener('click', () => toggleResume(false));
        
        // Initialize dragging
        if (resumeHeader) {
            makeDraggable(resumePanel, resumeHeader);
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && resumePanel.classList.contains('active')) {
                toggleResume(false);
            }
        });
    }

    // Mobile tap feedback for interactive elements
    const interactiveTapElements = document.querySelectorAll('.card, .skill-category, .project-item, .contact-btn, .resume-card');
    interactiveTapElements.forEach(el => {
        el.addEventListener('click', () => {
            el.classList.add('active-tap');
            setTimeout(() => el.classList.remove('active-tap'), 300);
        });
    });

    // Prevent text selection when spam clicking particles background
    const particlesContainer = document.getElementById('particles-js');
    if (particlesContainer) {
        particlesContainer.addEventListener('mousedown', function(e) {
            if (e.detail > 1) {
                e.preventDefault();
            }
        });
    }

    // Initialize cosmic starfield (respects prefers-reduced-motion)
    initCosmicStarfield();
});

/* ═══════════════════════════════════════════════════════════════════════
 * COSMIC STARFIELD — far layer of the unified SKY
 *   Far pinpricks + mid nodes + rare sparkles
 *   Same SKY palette / tempo as particles.js constellation
 *   No nebula / dust burns — clean field only
 *   Systems: supernova → black hole (coupled to particles)
 * ═══════════════════════════════════════════════════════════════════════ */
function initCosmicStarfield() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ─── Canvas Setup ────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.id = 'starfield-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-2;';
    document.body.insertBefore(canvas, document.body.firstChild);

    const ctx = canvas.getContext('2d');
    let dpr = window.devicePixelRatio || 1;
    let W, H;

    function resize(forceRegen = true) {
        dpr = window.devicePixelRatio || 1;
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (forceRegen) generateAll();
    }

    // ─── Camera System (Static Screen) ───────────────
    let currentPx = 0, currentPy = 0;

    // ─── Theme Colors (shared SKY palette) ───────────
    function getColors() {
        const sky = getSky();
        return {
            star: sky.rgb,
            starAlt: sky.rgbDim,
            white: sky.rgbBright,
        };
    }

    // ─── Stratified Distribution ─────────────────────
    function stratifiedPlace(count, margin) {
        const m = margin || 0;
        const aspect = W / (H || 1);
        let rows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
        let cols = Math.max(1, Math.round(rows * aspect));
        while (rows * cols < count) {
            if (cols / rows < aspect) cols++;
            else rows++;
        }
        const cellW = W / cols;
        const cellH = H / rows;
        const pts = [];
        for (let r = 0; r < rows && pts.length < count; r++) {
            for (let c = 0; c < cols && pts.length < count; c++) {
                const jx = m + Math.random() * (1 - 2 * m);
                const jy = m + Math.random() * (1 - 2 * m);
                pts.push({
                    x: (c + jx) * cellW,
                    y: (r + jy) * cellH,
                });
            }
        }
        return pts;
    }

    // ─── Star Data ───────────────────────────────────
    let bgStars = [], medStars = [], brightStars = [];

    function getStarCounts() {
        const area = Math.max(1, W * H);
        // Rich far field — still scales down on tiny/zoomed viewports, without looking empty
        const densityScale = Math.min(1.15, Math.max(0.65, area / (1920 * 1080)));
        return {
            bg: Math.max(160, Math.min(320, Math.round(270 * densityScale))),
            med: Math.max(18, Math.min(40, Math.round(32 * densityScale))),
            br: Math.max(6, Math.min(12, Math.round(10 * densityScale)))
        };
    }

    function generateAll() {
        const counts = getStarCounts();
        const sky = getSky();

        // Far field: tiny pinpricks (same family as constellation nodes)
        const bgPos = stratifiedPlace(counts.bg, 0.04);
        bgStars = bgPos.map(p => ({
            x: p.x, y: p.y, homeX: p.x, homeY: p.y,
            vx: 0, vy: 0,
            r: 0.4 + Math.random() * 1.05,
            baseOp: sky.starBgOp[0] + Math.random() * (sky.starBgOp[1] - sky.starBgOp[0]),
            twinkleSpeed: 0.001 + Math.random() * 0.0028,
            twinklePhase: Math.random() * Math.PI * 2,
            colorType: Math.random() < 0.7 ? 'star' : (Math.random() < 0.5 ? 'starAlt' : 'white'),
            destroyed: false, respawnTimer: 0
        }));

        // Mid field: slightly larger nodes — no halo disks (burns)
        const medPos = stratifiedPlace(counts.med, 0.08);
        medStars = medPos.map(p => ({
            x: p.x, y: p.y, homeX: p.x, homeY: p.y,
            vx: 0, vy: 0,
            r: 0.9 + Math.random() * 1.2,
            op: sky.starMedOp[0] + Math.random() * (sky.starMedOp[1] - sky.starMedOp[0]),
            target: Math.random() > 0.5 ? sky.starMedOp[1] : sky.starMedOp[0],
            speed: 0.003 + Math.random() * 0.006,
            colorType: Math.random() < 0.6 ? 'star' : 'white',
            destroyed: false, respawnTimer: 0
        }));

        // Rare sparkles — crisp crosses, no fat radial burns; keep off chrome/hero
        const brPos = stratifiedPlace(counts.br, 0.12).filter(p => {
            const inHeader = p.y < 72 && p.x < 280;
            const inHero = p.x < Math.min(520, W * 0.48) && p.y > 90 && p.y < Math.min(420, H * 0.55);
            return !inHeader && !inHero;
        });
        while (brPos.length < Math.max(4, Math.floor(counts.br * 0.65))) {
            brPos.push({
                x: W * (0.52 + Math.random() * 0.42),
                y: H * (0.12 + Math.random() * 0.72)
            });
        }
        brightStars = brPos.map(p => ({
            x: p.x, y: p.y, homeX: p.x, homeY: p.y,
            vx: 0, vy: 0,
            arm: 4.5 + Math.random() * 5.5,
            op: sky.sparkleOp[0] + Math.random() * (sky.sparkleOp[1] - sky.sparkleOp[0]),
            target: Math.random() > 0.5 ? sky.sparkleOp[1] : sky.sparkleOp[0],
            speed: 0.0025 + Math.random() * 0.0045,
            coreR: 1.1 + Math.random() * 1.0,
            colorType: Math.random() < 0.65 ? 'star' : 'white',
            destroyed: false, respawnTimer: 0
        }));
    }

    // ─── Black Hole System ───────────────────────────
    let blackHole = null;
    let supernovaCount = 0;
    let requiredSupernovas = 3; // First singularity triggers at 3 supernovas, subsequent at 6 (rarer)

    function spawnBlackHole(x, y) {
        const isMobile = window.innerWidth < 768;
        blackHole = {
            x, y,
            mass: 0, maxMass: 600,
            growthRate: 5,
            age: 0, lifetime: 8000,
            coreRadius: 0, maxCoreRadius: isMobile ? 12 : 22,
            diskAngle: 0, diskSpeed: 0.03,
            state: 'growing' // growing, stable, evaporating
        };
    }

    function updateBlackHole(dtMs) {
        if (!blackHole) return;
        blackHole.age += dtMs;
        const remaining = blackHole.lifetime - blackHole.age;

        // Black Hole Lifecycle (Hawking Radiation / Evaporation)
        if (remaining < 800) {
            blackHole.state = 'evaporating';
            blackHole.mass *= 0.85; // rapid mass loss
            blackHole.diskSpeed += 0.02; // spin up wildly
        } else if (blackHole.mass < blackHole.maxMass) {
            blackHole.state = 'growing';
            blackHole.mass = Math.min(
                blackHole.maxMass,
                blackHole.mass + blackHole.growthRate * (dtMs / 16.67)
            );
        } else {
            blackHole.state = 'stable';
        }

        blackHole.coreRadius = (blackHole.mass / blackHole.maxMass) * blackHole.maxCoreRadius;
        blackHole.diskAngle += blackHole.diskSpeed;

        // Explode into a massive supernova flash & shockwave at the very end
        if (blackHole.age >= blackHole.lifetime) {
            explosions.push({ 
                debris: [], flash: 1.6, x: blackHole.x, y: blackHole.y, flashRadius: 220,
                shockwaveR: 10, maxShockwaveR: 350, shockwaveOp: 0.8
            });
            restoreParticlesJS(blackHole.x, blackHole.y);
            blackHole = null;
        }
    }

    // ─── Supernova System ────────────────────────────
    let explosions = [];

    function checkSupernova(cx, cy) {
        // Bright stars — full supernova
        for (const s of brightStars) {
            if (s.destroyed) continue;
            const dx = cx - s.x, dy = cy - s.y;
            if (dx * dx + dy * dy < 40 * 40) {
                triggerSupernova(s, 28, s.arm * 4);
                return true;
            }
        }
        // Medium stars — mini nova
        for (const s of medStars) {
            if (s.destroyed) continue;
            const dx = cx - s.x, dy = cy - s.y;
            if (dx * dx + dy * dy < 25 * 25) {
                triggerSupernova(s, 14, s.r * 8);
                return true;
            }
        }
        return false;
    }

    function triggerSupernova(star, debrisCount, flashR) {
        const debris = [];
        for (let i = 0; i < debrisCount; i++) {
            const angle = (Math.PI * 2 / debrisCount) * i + (Math.random() - 0.5) * 0.5;
            const speed = 1.5 + Math.random() * 4.5;
            debris.push({
                x: star.x, y: star.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r:  0.4 + Math.random() * 2.2,
                life: 1.0,
                decay: 0.006 + Math.random() * 0.014,
                colorType: star.colorType
            });
        }
        explosions.push({ 
            debris, flash: 1.0, x: star.x, y: star.y, flashRadius: flashR,
            shockwaveR: 5, maxShockwaveR: flashR * 2.5, shockwaveOp: 0.6
        });
        star.destroyed = true;
        star.respawnTimer = 6000;
    }

    // ─── Physics Engine ──────────────────────────────
    const G = 0.12; // Gravitational constant (tuned for visual feel)

    function applyGravity(star, dt) {
        if (!blackHole || star.destroyed) return;
        const dx = blackHole.x - star.x;
        const dy = blackHole.y - star.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);
        if (dist > 550) return; // influence radius

        // F = G·M / r²
        const radialForce = G * blackHole.mass / Math.max(distSq, 80);
        // Orbital mechanics: tangential force for spiraling (cross product)
        const tangentialForce = radialForce * 0.85;

        const ux = dx / dist;
        const uy = dy / dist;

        star.vx += (ux * radialForce - uy * tangentialForce) * dt;
        star.vy += (uy * radialForce + ux * tangentialForce) * dt;
        star.x  += star.vx * dt;
        star.y  += star.vy * dt;

        // Absorbed into singularity
        if (dist < blackHole.coreRadius + 2) {
            star.destroyed = true;
            star.respawnTimer = 10000;
        }
    }

    function returnHome(star, dt) {
        if (blackHole || star.destroyed) return;
        if (star.homeX === undefined) return;
        const dx = star.homeX - star.x;
        const dy = star.homeY - star.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5) {
            star.x = star.homeX; star.y = star.homeY;
            star.vx = 0; star.vy = 0;
            return;
        }
        // Damped spring — stars drift home gently after black hole dies
        star.vx = ((star.vx || 0) + dx * 0.015) * 0.94;
        star.vy = ((star.vy || 0) + dy * 0.015) * 0.94;
        star.x += star.vx * dt;
        star.y += star.vy * dt;
    }

    function updateRespawn(star, dtMs) {
        if (!star.destroyed) return;
        star.respawnTimer -= dtMs;
        if (star.respawnTimer <= 0) {
            star.destroyed = false;
            star.x = star.homeX; star.y = star.homeY;
            star.vx = 0; star.vy = 0;
            star.op = 0;
            if (star.target !== undefined) star.target = 1;
        }
    }

    // Pull particles.js constellation nodes into orbital rotation around black hole
    function applyBlackHoleToParticlesJS() {
        if (!blackHole) return;
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;

        // blackHole is in CSS/client space (starfield); particles are in canvas buffer space
        const origin = clientToParticleCanvas(pJS, blackHole.x, blackHole.y);
        if (!origin) return;
        const px = pJS.canvas.pxratio || 1;
        const particles = pJS.particles.array;
        const minSafeDist = Math.max(38, blackHole.coreRadius * 2.2) * px;
        const maxDist = 520 * px;

        particles.forEach(p => {
            const dx = origin.x - p.x;
            const dy = origin.y - p.y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            if (dist > maxDist || dist < 2) return;

            // Prevent O(N^2) line-clustering lag: orbit around event horizon instead of collapsing into point
            if (dist < minSafeDist) {
                const ux = dx / dist;
                const uy = dy / dist;
                p.vx = -uy * 2.2;
                p.vy = ux * 2.2;
                return;
            }

            const radialForce = G * blackHole.mass * 0.10 / Math.max(distSq, 400 * px * px);
            const tangentialForce = radialForce * 0.70;
            const ux = dx / dist;
            const uy = dy / dist;

            p.vx += (ux * radialForce - uy * tangentialForce);
            p.vy += (uy * radialForce + ux * tangentialForce);
        });
    }

    function restoreParticlesJS(originX, originY) {
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;
        const px = pJS.canvas.pxratio || 1;
        let ox = originX, oy = originY;
        if (originX !== undefined && originY !== undefined) {
            const mapped = clientToParticleCanvas(pJS, originX, originY);
            if (mapped) { ox = mapped.x; oy = mapped.y; }
        }
        pJS.particles.array.forEach(p => {
            p.vx = p.vx_i; p.vy = p.vy_i;
            if (ox !== undefined && oy !== undefined) {
                // Apply outward shockwave blast momentum
                const dx = p.x - ox;
                const dy = p.y - oy;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const blastForce = Math.max(0, 1 - dist / (300 * px)) * 4;
                p.vx += (dx / dist) * blastForce;
                p.vy += (dy / dist) * blastForce;
            }
        });
    }

    // ─── Click Handler ───────────────────────────────
    document.addEventListener('click', (e) => {
        if (reducedMotion) return;
        // Skip UI element clicks
        if (e.target.closest(
            'a, button, .card, .terminal, .terminal-body, .resume-overlay, ' +
            '.resume-card, nav, .profile-card, .nav-links, input, textarea, ' +
            'select, .theme-toggle, .social-link, .contact-btn, .icon-button, ' +
            '.vocalizer, .badge-container, .resume-header, .resume-panel'
        )) return;

        if (blackHole) return; // Prevent triggering supernovas while black hole is active

        if (checkSupernova(e.clientX, e.clientY)) {
            supernovaCount++;
            if (supernovaCount >= requiredSupernovas) {
                supernovaCount = 0;
                requiredSupernovas = 6; // Subsequent black hole spawns require 6 supernovas (rarer event)
                spawnBlackHole(e.clientX, e.clientY);
            }
        }
    });

    // ─── Drawing: Background Stars ───────────────────
    function drawBgStars(time, colors) {
        const sky = getSky();
        const amp = 0.07;
        bgStars.forEach(s => {
            if (s.destroyed) return;
            const twinkle = reducedMotion
                ? s.baseOp
                : s.baseOp + Math.sin(time * s.twinkleSpeed + s.twinklePhase) * amp;
            const op = Math.max(sky.starBgOp[0] * 0.7, Math.min(sky.starBgOp[1], twinkle));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${colors[s.colorType]}, ${op})`;
            ctx.fill();
        });
    }

    // ─── Drawing: Medium Stars (sharp nodes — no burn halos) ───
    function drawMedStars(colors) {
        const sky = getSky();
        medStars.forEach(s => {
            if (s.destroyed) return;
            if (!reducedMotion) {
                s.op += (s.target - s.op) * s.speed;
                if (Math.abs(s.op - s.target) < 0.02) {
                    s.target = s.target > 0.7 ? sky.starMedOp[0] : sky.starMedOp[1];
                }
            }
            // Single crisp dot — matches particle node language
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${colors[s.colorType]}, ${s.op})`;
            ctx.fill();
        });
    }

    // ─── Drawing: Bright Sparkles (tight cross, no fat glow) ───
    function drawBrightStars(colors) {
        const sky = getSky();
        brightStars.forEach(s => {
            if (s.destroyed) return;
            if (!reducedMotion) {
                s.op += (s.target - s.op) * s.speed;
                if (Math.abs(s.op - s.target) < 0.03) {
                    s.target = s.target > 0.75 ? sky.sparkleOp[0] : sky.sparkleOp[1];
                }
            }
            const { x, y, arm, op, coreR } = s;
            if (op < 0.08) return;
            const color = colors[s.colorType];

            // Hairline 4-point — same accent ink as constellation, not a lens-flare VFX
            ctx.save();
            ctx.globalAlpha = op * 0.7;
            ctx.strokeStyle = `rgba(${color}, 1)`;
            ctx.lineWidth = 1.0;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm);
            ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
            ctx.stroke();
            ctx.globalAlpha = op * 0.28;
            ctx.lineWidth = 0.7;
            const d = arm * 0.38;
            ctx.beginPath();
            ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
            ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
            ctx.stroke();
            ctx.restore();

            ctx.beginPath();
            ctx.arc(x, y, coreR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${color}, ${op * 0.9})`;
            ctx.fill();
        });
    }

    // ─── Drawing: Black Hole ─────────────────────────
    function drawBlackHole(colors) {
        if (!blackHole) return;
        const { x, y, coreRadius, diskAngle, state } = blackHole;
        const intensity = blackHole.mass / blackHole.maxMass;
        if (intensity < 0.01) return;

        // Evaporation flash/jitter (Hawking radiation collapse)
        let jitterX = 0, jitterY = 0;
        if (state === 'evaporating') {
            jitterX = (Math.random() - 0.5) * 4;
            jitterY = (Math.random() - 0.5) * 4;
        }
        const drawX = x + jitterX;
        const drawY = y + jitterY;

        // Gravitational lensing bloom
        const lensR = coreRadius * 8;
        const lens = ctx.createRadialGradient(drawX, drawY, coreRadius * 0.5, drawX, drawY, lensR);
        lens.addColorStop(0,   `rgba(${colors.star}, ${intensity * 0.5})`);
        lens.addColorStop(0.3, `rgba(${colors.star}, ${intensity * 0.15})`);
        lens.addColorStop(1,   `rgba(${colors.star}, 0)`);
        ctx.beginPath();
        ctx.arc(drawX, drawY, lensR, 0, Math.PI * 2);
        ctx.fillStyle = lens;
        ctx.fill();

        // Accretion disk — tilted ellipse with Relativistic Doppler Beaming
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(diskAngle);
        ctx.scale(1, 0.35);
        
        // Doppler Beaming Gradient: Blueshifted (brighter) on left, redshifted (dimmer) on right
        const diskGrad = ctx.createLinearGradient(-coreRadius * 4, 0, coreRadius * 4, 0);
        diskGrad.addColorStop(0, `rgba(${colors.white}, ${intensity * 0.95})`);
        diskGrad.addColorStop(0.4, `rgba(${colors.star}, ${intensity * 0.6})`);
        diskGrad.addColorStop(1, `rgba(${colors.starAlt}, ${intensity * 0.15})`);
        
        // Outer glow disk
        ctx.beginPath();
        ctx.arc(0, 0, coreRadius * 4, 0, Math.PI * 2);
        ctx.fillStyle = diskGrad;
        ctx.globalAlpha = 0.5;
        ctx.fill();

        // Outer accretion ring
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(0, 0, coreRadius * 3, 0, Math.PI * 2);
        ctx.strokeStyle = diskGrad;
        ctx.lineWidth = 4.0;
        ctx.stroke();
        
        // Inner bright matter ring
        ctx.beginPath();
        ctx.arc(0, 0, coreRadius * 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${colors.white}, ${intensity * 0.9})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        
        // Photon ring (very bright, tightly wrapping the core)
        ctx.beginPath();
        ctx.arc(0, 0, coreRadius * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${colors.white}, ${intensity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();

        // Dark core — the singularity itself
        const coreGrad = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, coreRadius);
        coreGrad.addColorStop(0,   `rgba(0, 0, 0, ${intensity})`);
        coreGrad.addColorStop(0.8, `rgba(0, 0, 0, ${intensity * 0.95})`);
        coreGrad.addColorStop(1,   'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(drawX, drawY, coreRadius, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();
        
        // Event Horizon boundary line
        ctx.beginPath();
        ctx.arc(drawX, drawY, coreRadius + 1, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${colors.star}, ${intensity * 0.4})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ─── Drawing: Explosions & Shockwaves ────────────
    function drawExplosions(colors) {
        for (let i = explosions.length - 1; i >= 0; i--) {
            const exp = explosions[i];
            
            // Gravitational Shockwave Ring
            if (exp.shockwaveR !== undefined && exp.shockwaveR < exp.maxShockwaveR) {
                exp.shockwaveR += (exp.maxShockwaveR - exp.shockwaveR) * 0.08 + 1.5;
                exp.shockwaveOp *= 0.94;
                if (exp.shockwaveOp > 0.01) {
                    ctx.beginPath();
                    ctx.arc(exp.x, exp.y, exp.shockwaveR, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(${colors.starAlt}, ${exp.shockwaveOp})`;
                    ctx.lineWidth = Math.max(0.5, 2.5 * (1 - exp.shockwaveR / exp.maxShockwaveR));
                    ctx.stroke();
                }
            }

            // Flash
            if (exp.flash > 0) {
                const fg = ctx.createRadialGradient(
                    exp.x, exp.y, 0, exp.x, exp.y, exp.flashRadius
                );
                fg.addColorStop(0,   `rgba(${colors.white}, ${exp.flash * 0.9})`);
                fg.addColorStop(0.3, `rgba(${colors.star}, ${exp.flash * 0.5})`);
                fg.addColorStop(1,   `rgba(${colors.star}, 0)`);
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, exp.flashRadius, 0, Math.PI * 2);
                ctx.fillStyle = fg;
                ctx.fill();
                exp.flash -= 0.025;
            }
            // Debris particles
            let alive = false;
            exp.debris.forEach(d => {
                if (d.life <= 0) return;
                alive = true;
                d.x += d.vx;
                d.y += d.vy;
                d.vx *= 0.985; // space friction (slight deceleration)
                d.vy *= 0.985;
                d.life -= d.decay;
                ctx.beginPath();
                ctx.arc(d.x, d.y, d.r * Math.max(d.life, 0.1), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${colors[d.colorType]}, ${d.life * 0.85})`;
                ctx.fill();
            });
            if (!alive && exp.flash <= 0 && (exp.shockwaveOp === undefined || exp.shockwaveOp <= 0.01)) {
                explosions.splice(i, 1);
            }
        }
    }

    // ─── Main Animation Loop ─────────────────────────
    let rafId;
    let lastTime = 0;

    function loop(timestamp) {
        const dtMs = lastTime ? Math.min(timestamp - lastTime, 50) : 16.67;
        const dt = dtMs / 16.67; // normalized to ~60fps
        lastTime = timestamp;

        ctx.clearRect(0, 0, W, H);
        const colors = getColors();

        // Update systems
        updateBlackHole(dtMs);

        // Update all star physics
        const allStars = bgStars.concat(medStars, brightStars);
        for (let i = 0, len = allStars.length; i < len; i++) {
            const s = allStars[i];
            updateRespawn(s, dtMs);
            if (!s.destroyed) {
                applyGravity(s, dt);
                returnHome(s, dt);
            }
        }

        // Pull particles.js nodes too
        applyBlackHoleToParticlesJS();

        // Draw layers (back → front) — one sky language, no burn washes
        drawBgStars(timestamp || 0, colors);
        drawMedStars(colors);
        drawBrightStars(colors);
        drawExplosions(colors);
        drawBlackHole(colors);

        rafId = requestAnimationFrame(loop);
    }

    // ─── Bootstrap ───────────────────────────────────
    // Own resize listener removed — settleSkyViewport owns zoom/resize regen
    // so particles + starfield rebuild once together (no mid-zoom thrash).
    resize(true);
    window.__resizeStarfield = resize;
    window.__regenStarfield = generateAll;

    if (reducedMotion) {
        const c = getColors();
        drawBgStars(0, c);
        drawMedStars(c);
        drawBrightStars(c);
    } else {
        loop(0);
    }

    // Pause when tab is hidden — zero CPU waste
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelAnimationFrame(rafId);
            lastTime = 0;
        } else if (!reducedMotion) {
            loop(0);
        }
    });
}

