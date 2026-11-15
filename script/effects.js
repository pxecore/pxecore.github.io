// Sky theme palettes and depth settings (colors derive from window.PXECORE_PALETTES)
const BASE_PALETTES = (typeof window !== 'undefined' && window.PXECORE_PALETTES) || {};
function buildSkyPalette(themeId, fallback) {
    const raw = BASE_PALETTES[themeId] || {};
    const src = raw.sky || raw;
    return Object.assign({}, fallback, {
        hex: src.hex || fallback.hex,
        rgb: src.rgb || fallback.rgb,
        rgbBright: src.rgbBright || fallback.rgbBright,
        rgbDim: src.rgbDim || fallback.rgbDim
    });
}
const SKY = {
    dark: buildSkyPalette('dark', {
        hex: '#D8B278',
        rgb: '216, 178, 120',
        rgbBright: '255, 250, 240',
        rgbDim: '190, 155, 105',
        dotOp: 0.52,
        lineOp: 0.22,
        lineW: 1.0,
        grabLineOp: 0.60,
        countScale: 0.88,
        sizeScale: 0.98,
        distScale: 1.22,
        speedScale: 0.72,
        starBgOp: [0.40, 0.62],
        starMedOp: [0.52, 0.75],
        sparkleOp: [0.70, 0.92]
    }),
    light: buildSkyPalette('light', {
        hex: '#84321A',
        rgb: '132, 50, 26',
        rgbBright: '180, 80, 50',
        rgbDim: '90, 30, 15',
        dotOp: 0.42,
        lineOp: 0.20,
        lineW: 1.05,
        grabLineOp: 0.58,
        countScale: 0.82,
        sizeScale: 1.04,
        distScale: 1.10,
        speedScale: 0.48,
        starBgOp: [0.26, 0.50],
        starMedOp: [0.35, 0.60],
        sparkleOp: [0.50, 0.75]
    })
};
window.SKY = SKY;

function getSky() {
    if (document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'))) return SKY.light;
    return SKY.dark;
}
window.getSky = getSky;

/** Resolve palette from an explicit ink color (theme-flip safe). */
function skyFromInk(hex) {
    if (!hex) return getSky();
    const h = String(hex).toLowerCase();
    if (h === SKY.light.hex.toLowerCase() || h === '#84321a' || h === '#8c4a32') return SKY.light;
    return SKY.dark;
}

/** Touch / stylus primary — no mouse-style grab on these devices. */
function isCoarsePointer() {
    if (typeof window !== 'undefined' && window.HardwareProfiler?.isCoarsePointer) {
        return window.HardwareProfiler.isCoarsePointer();
    }
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch (_) {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    }
}
window.isCoarsePointer = isCoarsePointer;

/** Safe global motion preference checker (prevents any ReferenceError). */
function isCalmMotion() {
    if (typeof window !== 'undefined' && window.HardwareProfiler) {
        return window.HardwareProfiler.isReducedMotion() || window.HardwareProfiler.getTier() <= 1;
    }
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return false;
    }
}


// Cosmic starfield & particles layer
function initCosmicStarfield() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    // canvas setup
    if (document.getElementById('starfield-canvas')) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'starfield-canvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;right:0;width:100%;height:100vh;height:100lvh;pointer-events:none;z-index:1;';
    document.body.insertBefore(canvas, document.body.firstChild);

    let ctx = canvas.getContext('2d');
    let dpr = 1;
    let W, H;
    let generatedForTheme = null;
    let rafId = null;
    let lastRenderTime = 0;
    let isRenderingActive = true;
    let isTornDown = false;

    function resize(forceRegen = false) {
        const rect = (canvas && typeof canvas.getBoundingClientRect === 'function') ? canvas.getBoundingClientRect() : null;
        const newW = Math.round(rect?.width || canvas.clientWidth || window.innerWidth || 1);
        const newH = Math.round(rect?.height || canvas.clientHeight || window.innerHeight || 1);
        const oldW = W || newW;
        const oldH = H || newH;

        // Ignore mobile URL bar height-only jitter (< 160px height delta with identical width)
        if (!forceRegen && W && H && isCoarsePointer() && Math.abs(newW - oldW) < 4 && Math.abs(newH - oldH) < 160) {
            return;
        }

        W = newW;
        H = newH;
        const rawDpr = window.devicePixelRatio || 1;
        const lowBat = Boolean(window.HardwareProfiler?.isLowBattery?.());
        const isMobile = isCoarsePointer();
        const maxDpr = (lowBat || adaptiveThrottle) ? 1.25 : (isMobile ? 1.5 : 2.25);
        dpr = Math.min(Math.max(1, rawDpr), maxDpr);
        const targetW = Math.round(W * dpr);
        const targetH = Math.round(H * dpr);

        const bufferChanged = (canvas.width !== targetW || canvas.height !== targetH);
        if (bufferChanged) {
            canvas.width = targetW;
            canvas.height = targetH;
            lastRenderTime = 0;
        }
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        const needsInitial = (bgStars.length === 0);
        if (forceRegen || needsInitial) {
            generateAll(true);
        } else if (bufferChanged && oldW && oldH && (oldW !== W || oldH !== H)) {
            adaptStarCoordinates(oldW, oldH, W, H);
        }
    }

    // camera system
    let currentPx = 0, currentPy = 0;

    // theme color cache
    const cachedColors = {
        star: '220, 182, 128',
        starAlt: '190, 155, 105',
        white: '255, 250, 240'
    };
    function updateColorsCache() {
        const sky = getSky();
        cachedColors.star = sky.rgb;
        cachedColors.starAlt = sky.rgbDim;
        cachedColors.white = sky.rgbBright;
    }
    updateColorsCache();

    // resize handler
    function adaptStarCoordinates(oldW, oldH, newW, newH) {
        if (!oldW || !oldH || (oldW === newW && oldH === newH)) return;
        const sx = newW / oldW;
        const sy = newH / oldH;
        const minStarY = newH > 180 ? 88 : 2;
        const scaleStar = (s, minY) => {
            if (typeof s.nx !== 'number' || typeof s.ny !== 'number') {
                s.nx = (s.homeX !== undefined ? s.homeX : s.x) / Math.max(1, oldW);
                s.ny = (s.homeY !== undefined ? s.homeY : s.y) / Math.max(1, oldH);
            }
            const nextHomeX = Math.max(2, Math.min(newW - 2, s.nx * newW));
            const nextHomeY = Math.max(minY, Math.min(newH - 2, s.ny * newH));
            const dx = (s.x - s.homeX) * sx;
            const dy = (s.y - s.homeY) * sy;
            s.homeX = nextHomeX;
            s.homeY = nextHomeY;
            s.x = Math.max(2, Math.min(newW - 2, nextHomeX + dx));
            s.y = Math.max(minY, Math.min(newH - 2, nextHomeY + dy));
        };
        bgStars.forEach(s => scaleStar(s, 2));
        medStars.forEach(s => scaleStar(s, minStarY));
        brightStars.forEach(s => scaleStar(s, minStarY));
        foliage.scalePositions(sx, sy);

        // Harmonize star counts smoothly with new viewport area
        const targetCounts = getStarCounts();
        const sky = getSky();
        if (bgStars.length < targetCounts.bg) {
            const extra = stratifiedPlace(targetCounts.bg - bgStars.length, 0.04);
            extra.forEach(p => {
                bgStars.push({
                    x: p.x, y: p.y, homeX: p.x, homeY: p.y,
                    nx: p.x / Math.max(1, newW), ny: p.y / Math.max(1, newH),
                    vx: 0, vy: 0,
                    r: 0.75 + Math.random() * 0.85,
                    baseOp: sky.starBgOp[0] + Math.random() * (sky.starBgOp[1] - sky.starBgOp[0]),
                    twinkleSpeed: 0.0007 + Math.random() * 0.0016,
                    twinklePhase: Math.random() * Math.PI * 2,
                    colorType: Math.random() < 0.7 ? 'star' : (Math.random() < 0.5 ? 'starAlt' : 'white'),
                    destroyed: false, respawnTimer: 0,
                    spawned: true
                });
            });
        } else if (bgStars.length > targetCounts.bg + 24) {
            bgStars.splice(targetCounts.bg);
        }

        if (medStars.length < targetCounts.med) {
            const extraMed = stratifiedPlace(targetCounts.med - medStars.length, 0.08);
            extraMed.forEach(p => {
                const starY = newH > 180 ? 88 + (p.y / Math.max(1, newH)) * Math.max(12, newH - 96) : p.y;
                medStars.push({
                    x: p.x, y: starY, homeX: p.x, homeY: starY,
                    nx: p.x / Math.max(1, newW), ny: starY / Math.max(1, newH),
                    vx: 0, vy: 0,
                    r: 1.30 + Math.random() * 1.10,
                    op: sky.starMedOp[0] + Math.random() * (sky.starMedOp[1] - sky.starMedOp[0]),
                    target: Math.random() > 0.5 ? sky.starMedOp[1] : sky.starMedOp[0],
                    speed: 0.0012 + Math.random() * 0.0024,
                    colorType: Math.random() < 0.6 ? 'star' : 'white',
                    destroyed: false, respawnTimer: 0,
                    spawned: true
                });
            });
        } else if (medStars.length > targetCounts.med + 8) {
            medStars.splice(targetCounts.med);
        }

        if (brightStars.length < targetCounts.br) {
            const extraBr = stratifiedPlace(targetCounts.br - brightStars.length, 0.12);
            extraBr.forEach(p => {
                const starY = newH > 180 ? 88 + (p.y / Math.max(1, newH)) * Math.max(12, newH - 96) : p.y;
                brightStars.push({
                    x: p.x, y: starY, homeX: p.x, homeY: starY,
                    nx: p.x / Math.max(1, newW), ny: starY / Math.max(1, newH),
                    vx: 0, vy: 0,
                    r: 1.85 + Math.random() * 0.90,
                    op: sky.sparkleOp[0] + Math.random() * (sky.sparkleOp[1] - sky.sparkleOp[0]),
                    target: Math.random() > 0.5 ? sky.sparkleOp[1] : sky.sparkleOp[0],
                    speed: 0.0009 + Math.random() * 0.0018,
                    colorType: Math.random() < 0.7 ? 'star' : 'white',
                    diffraction: brightStars.length < 4,
                    spikeAngle: Math.random() * Math.PI * 0.5,
                    destroyed: false, respawnTimer: 0,
                    spawned: true
                });
            });
        } else if (brightStars.length > targetCounts.br + 4) {
            brightStars.splice(targetCounts.br);
        }
    }

    // stratified celestial distribution: uniform jittered grid sampling across all quadrants
    function stratifiedPlace(count, margin) {
        const m = margin || 0.04;
        const aspect = Math.max(0.5, W / (H || 1));
        let rows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
        let cols = Math.max(1, Math.round(rows * aspect));
        while (rows * cols < count) {
            if (cols / rows < aspect) cols++;
            else rows++;
        }
        const cellW = W / cols;
        const cellH = H / rows;

        // Populate all grid cell coordinates
        const cells = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                cells.push({ r, c });
            }
        }
        // shuffle cells for even distribution
        for (let i = cells.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = cells[i];
            cells[i] = cells[j];
            cells[j] = tmp;
        }

        const pts = [];
        const limit = Math.min(count, cells.length);
        for (let i = 0; i < limit; i++) {
            const { r, c } = cells[i];
            const jx = m + Math.random() * (1 - 2 * m);
            const jy = m + Math.random() * (1 - 2 * m);
            pts.push({
                x: (c + jx) * cellW,
                y: (r + jy) * cellH,
            });
        }
        return pts;
    }

    // star data initialization
    let bgStars = [], medStars = [], brightStars = [];
    let starfieldBirthTime = 0; // timestamp when generateAll was called (for progressive spawn)
    let isInstantSpawn = false; // true for resize — skip progressive delay

    function getStarCounts() {
        const area = Math.max(1, W * H);
        const densityScale = Math.min(1.0, Math.max(0.68, area / (1920 * 1080)));
        const tier = window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2;
        let baseBg = 85, baseMed = 14, baseBr = 4;
        if (tier === 1) {
            baseBg = 50; baseMed = 8; baseBr = 3;
        } else if (tier === 3) {
            baseBg = 105; baseMed = 16; baseBr = 5;
        }
        return {
            bg: Math.round(Math.max(28, Math.min(115, baseBg * densityScale))),
            med: Math.round(Math.max(6, Math.min(18, baseMed * densityScale))),
            br: Math.round(Math.max(tier >= 2 ? 4 : 3, Math.min(6, baseBr * densityScale)))
        };
    }

    /**
     * Assign progressive spawn delay for wave-based star appearance.
     * Wave 1 (0-0.5s):  bright stars (first 4) + 30% bg
     * Wave 2 (0.5-1.5s): remaining bright + med + 60% bg
     * Wave 3 (1.5-3.0s): all remaining bg
     */
    function assignSpawnDelay(star, wave) {
        if (wave === 1) {
            star.spawnDelay = Math.random() * 500;
        } else if (wave === 2) {
            star.spawnDelay = 500 + Math.random() * 1000;
        } else {
            star.spawnDelay = 1500 + Math.random() * 1500;
        }
    }

    function generateAll(instant = true) {
        const counts = getStarCounts();
        const sky = getSky();
        generatedForTheme = getCurrentTheme();
        starfieldBirthTime = performance.now();
        isInstantSpawn = !!instant;

        // Far field: tiny pinpricks (same family as constellation nodes)
        const bgPos = stratifiedPlace(counts.bg, 0.04);
        bgStars = bgPos.map((p, i) => {
            const star = {
                x: p.x, y: p.y, homeX: p.x, homeY: p.y,
                nx: p.x / Math.max(1, W), ny: p.y / Math.max(1, H),
                vx: 0, vy: 0,
                r: 0.75 + Math.random() * 0.85,
                baseOp: sky.starBgOp[0] + Math.random() * (sky.starBgOp[1] - sky.starBgOp[0]),
                twinkleSpeed: 0.0007 + Math.random() * 0.0016,
                twinklePhase: (i * 2.399963) % (Math.PI * 2),
                colorType: Math.random() < 0.7 ? 'star' : (Math.random() < 0.5 ? 'starAlt' : 'white'),
                destroyed: false, respawnTimer: 0,
                spawned: !!instant
            };
            // Wave: first 30% = wave 1, next 30% = wave 2, rest = wave 3
            const frac = i / bgPos.length;
            assignSpawnDelay(star, frac < 0.3 ? 1 : frac < 0.6 ? 2 : 3);
            return star;
        });

        // Mid field: slightly larger nodes — keep off top header
        const minStarY = H > 180 ? 88 : 2;
        const medPos = stratifiedPlace(counts.med, 0.08).map(p => (
            p.y < minStarY
                ? { x: p.x, y: minStarY + (p.y / Math.max(1, minStarY)) * Math.max(12, H - minStarY - 12) }
                : p
        ));
        medStars = medPos.map((p, i) => {
            const star = {
                x: p.x, y: p.y, homeX: p.x, homeY: p.y,
                nx: p.x / Math.max(1, W), ny: p.y / Math.max(1, H),
                vx: 0, vy: 0,
                r: 1.30 + Math.random() * 1.10,
                op: sky.starMedOp[0] + Math.random() * (sky.starMedOp[1] - sky.starMedOp[0]),
                target: Math.random() > 0.5 ? sky.starMedOp[1] : sky.starMedOp[0],
                speed: 0.0012 + Math.random() * 0.0024,
                colorType: Math.random() < 0.6 ? 'star' : 'white',
                destroyed: false, respawnTimer: 0,
                spawned: !!instant
            };
            assignSpawnDelay(star, 2); // Wave 2
            return star;
        });

        // Rare sparkles — crisp crosses, no fat radial burns; keep off chrome/hero
        const brPos = stratifiedPlace(counts.br, 0.12).filter(p => {
            const inHeader = p.y < minStarY;
            const inHero = p.x < Math.min(520, W * 0.48) && p.y > 90 && p.y < Math.min(420, H * 0.55);
            return !inHeader && !inHero;
        });
        while (brPos.length < Math.max(4, Math.floor(counts.br * 0.65))) {
            brPos.push({
                x: W * (0.52 + Math.random() * 0.42),
                y: Math.max(minStarY, H * (0.18 + Math.random() * 0.68))
            });
        }
        brightStars = brPos.map((p, i) => {
            const star = {
                x: p.x, y: p.y, homeX: p.x, homeY: p.y,
                nx: p.x / Math.max(1, W), ny: p.y / Math.max(1, H),
                vx: 0, vy: 0,
                r: 1.90 + Math.random() * 1.25,
                op: sky.sparkleOp[0] + Math.random() * (sky.sparkleOp[1] - sky.sparkleOp[0]),
                target: Math.random() > 0.5 ? sky.sparkleOp[1] : sky.sparkleOp[0],
                speed: 0.0014 + Math.random() * 0.0024,
                colorType: Math.random() < 0.65 ? 'star' : 'white',
                // First 3-4 get subtle light diffraction spikes
                diffraction: i < Math.min(4, Math.ceil(brPos.length * 0.4)),
                spikeAngle: Math.random() * Math.PI * 0.5,
                destroyed: false, respawnTimer: 0,
                spawned: !!instant
            };
            assignSpawnDelay(star, i < 4 ? 1 : 2);
            return star;
        });
    }

    // velocity deceleration
    function getCurrentTheme() {
        if (document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'))) return 'light';
        return 'dark';
    }


    const cosmos = window.pxecore.createCosmosEngine({
        getW: () => W,
        getH: () => H,
        getCtx: () => ctx,
        getBgStars: () => bgStars,
        getMedStars: () => medStars,
        getBrightStars: () => brightStars,
        getSky,
        isCalmMotion,
        triggerCosmicSparkle
    });

    const foliage = window.pxecore.createFoliageEngine({
        getW: () => W,
        getH: () => H,
        getCtx: () => ctx,
        getHarmonicOrder: () => cosmos.getHarmonicOrder()
    });
    window.__setChromaLeafPalette = foliage.setChromaLeafPalette;
    if (getCurrentTheme() === 'light' && window.ChromaEngine && typeof window.ChromaEngine.syncTheme === 'function') {
        window.ChromaEngine.syncTheme('light', true);
    }

    // pointer & tap handler
    let lastInteractionTimestamp = 0;
    let lastInteractionX = -999;
    let lastInteractionY = -999;
    let pointerDownStart = null;
    let skipSyntheticClickUntil = 0;

    function handleNatureCanvasInteraction(clientX, clientY, target, shiftKey = false) {
        // Never fire wind/supernova on real interactive controls (buttons, links, inputs, cards, chips, code blocks)
        const interactiveSel = window.__pxeInteractiveSelector || (
            'a, button, input, textarea, select, label, summary, [role="button"], [role="link"], [role="menuitem"], ' +
            '.header-btn, .header-nav-btn, .theme-btn, .theme-toggle, .contact-btn, .icon-button, .social-link, ' +
            '.tech-item, .terminal-input, .terminal-btn, ' +
            '.notes-btn, .notes-resync-mini-btn, .notes-link-btn, .notes-page-pill, .notes-card-share-btn, .notes-tag-pill, ' +
            '.notes-chip, .notes-chip-clear, .notes-article-card, .notes-custom-select-option, .notes-custom-select-trigger, ' +
            '[data-card-tag], [data-category], [data-tag], [data-slug], ' +
            '.notes-mindmap-modal-dialog, .notes-lightbox-content, ' +
            'pre, code'
        );
        if (target?.closest && target.closest(interactiveSel)) return;

        const now = Date.now();
        const distSq = (clientX - lastInteractionX) ** 2 + (clientY - lastInteractionY) ** 2;
        // Only throttle duplicate/rapid double-fires on the EXACT same point (< 16px)
        if (now - lastInteractionTimestamp < 60 && distSq < 256) return;
        lastInteractionTimestamp = now;
        lastInteractionX = clientX;
        lastInteractionY = clientY;

        if (!shiftKey && window.getSelection && !window.getSelection().isCollapsed) {
            const isBgTarget = target === document.body || target === document.documentElement ||
                (target?.closest && target.closest('#particles-js, #starfield-canvas, .site-backdrop'));
            if (isBgTarget) {
                window.getSelection().removeAllRanges();
            }
        }

        // Direct viewport-to-canvas mapping (canvas is position:fixed; inset:0; avoids synchronous reflow)
        const vw = W || window.innerWidth || 1;
        const vh = H || window.innerHeight || 1;
        const canvasX = Math.max(0, Math.min(vw, clientX));
        const canvasY = Math.max(0, Math.min(vh, clientY));

        const currentTheme = getCurrentTheme();
        if (currentTheme === 'light') {
            foliage.handleWindClick(canvasX, canvasY);
        } else {
            // Dark theme: star interaction (supernova explosion only on directly clicking stars)
            cosmos.checkSupernova(canvasX, canvasY);
        }
    }

    // Clear active selection only on unmodified pointerdown directly on empty canvas
    if (window.PointerEvent) {
        document.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            // On desktop mouse or stylus devices: trigger instantly on press with zero latency
            if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
                skipSyntheticClickUntil = Date.now() + 450;
                handleNatureCanvasInteraction(e.clientX, e.clientY, e.target, Boolean(e.shiftKey));
                return;
            }
            // For touch devices: record initial contact to distinguish tap vs scroll gesture
            pointerDownStart = { x: e.clientX, y: e.clientY, time: Date.now() };
        }, { passive: true });

        document.addEventListener('pointerup', (e) => {
            if (e.button !== 0) return;
            // Mouse/pen interactions already triggered immediately on pointerdown
            if (e.pointerType === 'mouse' || e.pointerType === 'pen') return;

            // Touch device tap completion
            const clickX = e.clientX;
            const clickY = e.clientY;
            if (pointerDownStart) {
                const dx = e.clientX - pointerDownStart.x;
                const dy = e.clientY - pointerDownStart.y;
                pointerDownStart = null;
                // If user dragged more than 14px, this is a page scroll gesture, not a tap
                if (dx * dx + dy * dy > 196) {
                    skipSyntheticClickUntil = Date.now() + 400;
                    return;
                }
            }
            skipSyntheticClickUntil = Date.now() + 400;
            handleNatureCanvasInteraction(clickX, clickY, e.target);
        }, { passive: true });

        document.addEventListener('pointercancel', () => {
            pointerDownStart = null;
        }, { passive: true });
    } else {
        document.addEventListener('touchend', (e) => {
            const t = e.changedTouches?.[0];
            if (t) {
                skipSyntheticClickUntil = Date.now() + 400;
                handleNatureCanvasInteraction(t.clientX, t.clientY, e.target);
            }
        }, { passive: true });
    }
    // Also listen on click for synthetic and fallback click dispatch (ignoring if pointer already handled)
    document.addEventListener('click', (e) => {
        if (e.button && e.button !== 0) return;
        if (Date.now() < skipSyntheticClickUntil) return;
        handleNatureCanvasInteraction(e.clientX, e.clientY, e.target);
    });

    // Prevent accidental bulk text selection when click-spamming background canvases
    document.addEventListener('mousedown', (e) => {
        if (e.detail <= 1 || e.shiftKey) return;
        const t = e.target;
        if (!t) return;
        const isBackgroundClick =
            t === document.body ||
            t === document.documentElement ||
            (t.matches && t.matches('#particles-js, #starfield-canvas, .site-backdrop, .site-backdrop-layer, canvas, main, .main-content, .container, .content, .site-view'));
        if (isBackgroundClick) {
            e.preventDefault();
        }
    });

    // Double-click contributes energetic turbulence without abruptly force-spawning
    document.addEventListener('dblclick', (e) => {
        if (e.target?.closest && e.target.closest(
            'a, button, input, textarea, select, label, [role="button"], [role="link"], ' +
            '.header-btn, .header-nav-btn, .theme-btn, .contact-btn, .icon-button, .social-link, ' +
            '.tech-item, .notes-card-share-btn, .notes-btn, .notes-link-btn, .notes-page-pill, ' +
            '.notes-lightbox-content, .terminal-input, pre, code'
        )) return;

        const currentTheme = getCurrentTheme();
        if (currentTheme === 'light') {
            foliage.addTurbulence(24);
        } else {
            // Double-click in dark theme: significant cosmic contribution but still needs supernovas
            cosmos.addTurbulence(35);
        }
    });


    // main animation loop (rafId, lastRenderTime, isRenderingActive, isTornDown hoisted near canvas init)

    function updateStarGroup(group, dtMs, dt, timestamp) {
        const now = timestamp || performance.now();
        const timeSinceBirth = now - starfieldBirthTime;

        for (let i = 0, len = group.length; i < len; i++) {
            const s = group[i];

            if (!s.spawned) {
                if (isInstantSpawn || timeSinceBirth >= (s.spawnDelay || 0)) {
                    s.spawned = true;
                }
                continue;
            }

            cosmos.updateRespawn(s, dtMs);
            if (!s.destroyed) {
                cosmos.applyGravity(s, dt);
                cosmos.returnHome(s, dt);
            }
        }
    }

    // particle buffer limit
    const PARTICLE_HARD_CAP = 100;
    let lastParticleGCTime = 0;
    const PARTICLE_GC_INTERVAL = 800;

    function manageParticleLifecycle(dtMs) {
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;

        const now = performance.now();
        if (now - lastParticleGCTime < PARTICLE_GC_INTERVAL) return;
        lastParticleGCTime = now;

        const particles = pJS.particles.array;
        if (particles.length > PARTICLE_HARD_CAP) {
            const excess = particles.length - PARTICLE_HARD_CAP;
            particles.splice(0, excess);
        }
    }

    let slowFramesStreak = 0;
    let goodFramesStreak = 0;
    let adaptiveThrottle = false;
    let isWindowBlurred = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
    let cachedTheme = getCurrentTheme();
    let cachedTier = window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2;
    const isLowPowerMode = () => cachedTier <= 1 || Boolean(window.HardwareProfiler?.isLowBattery?.());
    const isOnBatteryMode = () => Boolean(window.HardwareProfiler?.isOnBattery?.());
    if (window.HardwareProfiler && typeof window.HardwareProfiler.onTierChange === 'function') {
        window.HardwareProfiler.onTierChange((t) => {
            cachedTier = t;
            if (!isTornDown) resize(false);
        });
    }

    function getTargetFrameInterval() {
        if (isWindowBlurred) return 56;
        if (adaptiveThrottle) return 44;
        if (isLowPowerMode() || document.body?.classList?.contains('reader-focused')) return 38;
        if (isOnBatteryMode()) return 28;
        return 21;
    }

    function loop(timestamp) {
        if (!isRenderingActive || isTornDown) return;
        rafId = requestAnimationFrame(loop);

        if (!timestamp) timestamp = performance.now();

        const minInterval = getTargetFrameInterval();
        if (minInterval > 0 && lastRenderTime && (timestamp - lastRenderTime) < minInterval) {
            return;
        }

        const frameWorkStart = performance.now();
        const elapsed = lastRenderTime ? (timestamp - lastRenderTime) : 16.67;
        const dtMs = Math.min(elapsed, 48);
        const dt = dtMs / 16.67;
        lastRenderTime = timestamp;

        // Clear backing buffer across DPR scaling
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const colors = cachedColors;
        const currentTheme = cachedTheme;

        // Always damp particles.js velocities so explosion speed decays smoothly
        cosmos.dampParticlesVelocity();

        try {
            if (currentTheme === 'light') {
                foliage.updateWhirlwind(dtMs, dt);
                if (cosmos.getHarmonicOrder().active) {
                    cosmos.applyCurlAndHarmonicOrderToParticlesJS(dtMs, timestamp);
                    cosmos.drawHarmonicOrderOverlay({ ...colors, accentRgb: foliage.getAccentRgb() });
                }
                foliage.updateAndDrawLeaves(timestamp, dt, colors, dtMs);
            } else {
                // Dark mode: stars, supernovas, and black hole effect
                cosmos.decaySupernovas();

                cosmos.updateBlackHole(dtMs);
                updateStarGroup(bgStars, dtMs, dt, timestamp);
                updateStarGroup(medStars, dtMs, dt, timestamp);
                updateStarGroup(brightStars, dtMs, dt, timestamp);

                cosmos.applyBlackHoleToParticlesJS();
                cosmos.applyCurlAndHarmonicOrderToParticlesJS(dtMs, timestamp);
                manageParticleLifecycle(dtMs);

                cosmos.drawBgStars(timestamp || 0, colors);
                cosmos.drawMedStars(colors, timestamp || 0);
                cosmos.drawBrightStars(colors);
                cosmos.drawHarmonicOrderOverlay(colors);
                cosmos.drawExplosions(colors, dt);
                cosmos.drawBlackHole(colors);
                drawThemeSparkles(colors);
            }
        } catch (frameErr) {
            if (!window.__effectsFrameErrorLogged) {
                window.__effectsFrameErrorLogged = true;
                console.warn('[Effects] Frame render exception caught (suppressed to prevent console flood):', frameErr);
            }
        }

        // Monitor frame work + cadence relative to minInterval (prevents paced frames self-tripping throttle)
        if (timestamp - starfieldBirthTime > 2500) {
            const frameWorkMs = performance.now() - frameWorkStart;
            const stallElapsedLimit = Math.max(48, minInterval + 22);
            const recoverElapsedLimit = Math.max(36, minInterval + 14);
            const frameStalled = frameWorkMs > 16 && elapsed > stallElapsedLimit && elapsed < 160;
            if (!adaptiveThrottle) {
                if (frameStalled) {
                    if (++slowFramesStreak >= 12) {
                        adaptiveThrottle = true;
                        slowFramesStreak = 0;
                        goodFramesStreak = 0;
                        if (dpr > 1) resize(false);
                        const livePJS = window.pJSDom?.[0]?.pJS;
                        if (livePJS && (!livePJS.fps_limit || livePJS.fps_limit > 26)) {
                            livePJS.fps_limit = 26;
                        }
                    }
                } else if (slowFramesStreak > 0) {
                    slowFramesStreak--;
                }
            } else if (frameWorkMs < 8 && elapsed <= recoverElapsedLimit) {
                if (++goodFramesStreak >= 120) {
                    adaptiveThrottle = false;
                    goodFramesStreak = 0;
                    if (!isLowPowerMode()) {
                        resize(false);
                        const livePJS = window.pJSDom?.[0]?.pJS;
                        if (livePJS) livePJS.fps_limit = isWindowBlurred ? 18 : (isOnBatteryMode() ? 30 : 42);
                    }
                }
            } else if (goodFramesStreak > 0 && frameStalled) {
                goodFramesStreak = Math.max(0, goodFramesStreak - 4);
            }
        }
    }

    // Theme transition sparkle particles
    const themeSparkles = [];

    function triggerCosmicSparkle(x, y) {
        if (isCalmMotion()) return;
        if (themeSparkles.length > 28) {
            themeSparkles.splice(0, 10);
        }
        const count = 10;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
            const speed = 1.2 + Math.random() * 2.0;
            themeSparkles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 1.2 + Math.random() * 1.2,
                life: 1.0,
                decay: 0.024 + Math.random() * 0.012
            });
        }
    }

    function drawThemeSparkles(colors) {
        if (themeSparkles.length === 0) return;
        for (let i = themeSparkles.length - 1; i >= 0; i--) {
            const s = themeSparkles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vx *= 0.94;
            s.vy *= 0.94;
            s.life -= s.decay;
            if (s.life <= 0) {
                themeSparkles.splice(i, 1);
                continue;
            }
            const alpha = Math.max(0, s.life * 0.85);
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius * s.life, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${colors.star || '220, 182, 128'}, ${alpha.toFixed(3)})`;
            ctx.fill();
        }
    }

    function triggerGoldenBreeze(x, y) {
        if (isCalmMotion()) return;
        foliage.handleWindClick(x, y);
    }

    // bootstrap
    const initialTheme = getCurrentTheme();
    requestAnimationFrame(() => {
        if (!isTornDown) resize(initialTheme === 'dark');
    });
    if (initialTheme === 'light') {
        foliage.initLeaves();
    }
    window.pxecore = window.pxecore || {};
    window.pxecore.fx = {
        resize,
        regenStarfield: generateAll,
        spawnBlackHole: cosmos.spawnBlackHole,
        explodeBlackHole: cosmos.explodeBlackHole,
        isBlackHoleActive: cosmos.isBlackHoleActive,
        getBlackHole: cosmos.getBlackHole,
        spawnWhirlwind: foliage.spawnWhirlwind,
        isWhirlwindActive: foliage.isWhirlwindActive,
        handleWindClick: foliage.handleWindClick,
        getWindBursts: foliage.getWindBursts,
        getLeaves: foliage.getLeaves,
        getLeafCutFlashes: foliage.getLeafCutFlashes,
        getBrightStars: () => brightStars,
        getMedStars: () => medStars,
        getExplosions: cosmos.getExplosions,
        checkSupernova: cosmos.checkSupernova,
        triggerSupernova: cosmos.triggerSupernova,
        triggerCosmicSparkle,
        triggerGoldenBreeze,
        computeCurlFlow: cosmos.computeCurlFlow,
        triggerHarmonicOrder: cosmos.triggerHarmonicOrder,
        getHarmonicOrderState: () => {
            const ho = cosmos.getHarmonicOrder();
            return {
                active: ho.active,
                age: ho.age,
                duration: ho.duration,
                goldenRatio: cosmos.GOLDEN_RATIO,
                goldenAngleRad: cosmos.GOLDEN_ANGLE_RAD
            };
        }
    };

    // Backward compatibility test aliases (ensures test suite integrity)
    window.__resizeStarfield = window.pxecore.fx.resize;
    window.__regenStarfield = window.pxecore.fx.regenStarfield;
    window.__spawnBlackHole = window.pxecore.fx.spawnBlackHole;
    window.__explodeBlackHole = window.pxecore.fx.explodeBlackHole;
    window.__isBlackHoleActive = window.pxecore.fx.isBlackHoleActive;
    window.__getBlackHole = window.pxecore.fx.getBlackHole;
    window.__spawnWhirlwind = window.pxecore.fx.spawnWhirlwind;
    window.__isWhirlwindActive = window.pxecore.fx.isWhirlwindActive;
    window.__handleWindClick = window.pxecore.fx.handleWindClick;
    window.__getWindBursts = window.pxecore.fx.getWindBursts;
    window.__getLeaves = window.pxecore.fx.getLeaves;
    window.__getLeafCutFlashes = window.pxecore.fx.getLeafCutFlashes;
    window.__getBrightStars = window.pxecore.fx.getBrightStars;
    window.__getMedStars = window.pxecore.fx.getMedStars;
    window.__getExplosions = window.pxecore.fx.getExplosions;
    window.__checkSupernova = window.pxecore.fx.checkSupernova;
    window.__triggerSupernova = window.pxecore.fx.triggerSupernova;
    window.__triggerCosmicSparkle = window.pxecore.fx.triggerCosmicSparkle;
    window.__triggerGoldenBreeze = window.pxecore.fx.triggerGoldenBreeze;
    window.__computeCurlFlow = window.pxecore.fx.computeCurlFlow;
    window.__triggerHarmonicOrder = window.pxecore.fx.triggerHarmonicOrder;
    window.__getHarmonicOrderState = window.pxecore.fx.getHarmonicOrderState;

    window.addEventListener('theme-changed', (e) => {
        updateColorsCache();
        const t = e.detail?.theme || getCurrentTheme();
        cachedTheme = t;

        if (t === 'dark') {
            // Teardown light-mode ephemeral physics to prevent frozen cross-theme artifacts
            foliage.resetState();

            // Immediately revive stars so all stars are interactive without waiting for stale respawn timers
            for (let i = 0; i < brightStars.length; i++) {
                brightStars[i].destroyed = false;
                brightStars[i].respawnTimer = 0;
                brightStars[i].vx = 0;
                brightStars[i].vy = 0;
            }
            for (let i = 0; i < medStars.length; i++) {
                medStars[i].destroyed = false;
                medStars[i].respawnTimer = 0;
                medStars[i].vx = 0;
                medStars[i].vy = 0;
            }
            for (let i = 0; i < bgStars.length; i++) {
                bgStars[i].destroyed = false;
                bgStars[i].respawnTimer = 0;
                bgStars[i].vx = 0;
                bgStars[i].vy = 0;
            }
        } else if (t === 'light') {
            // Teardown dark-mode ephemeral physics
            cosmos.resetState();
            themeSparkles.length = 0;
        }

        requestAnimationFrame(() => {
            if (t === 'light') {
                if (foliage.getLeaves().length === 0) foliage.initLeaves();
            } else if (t === 'dark') {
                const counts = getStarCounts();
                if (
                    bgStars.length === 0 ||
                    generatedForTheme !== 'dark' ||
                    bgStars.length < counts.bg ||
                    medStars.length < Math.floor(counts.med * 0.7)
                ) {
                    generateAll(true);
                }
            }
        });
    });

    // Defer first frame to rAF so DOMContentLoaded does not stall behind initial canvas draw
    const initDoneTime = performance.now();
    let handledInitialPageshow = false;
    rafId = requestAnimationFrame(loop);

    // Pause when tab is hidden — zero CPU/GPU waste
    function pauseLoop() {
        isRenderingActive = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastRenderTime = 0;
    }

    function resumeLoop() {
        if (isTornDown) return;
        isRenderingActive = true;
        if (!rafId) {
            lastRenderTime = 0;
            rafId = requestAnimationFrame(loop);
        }
    }

    window.__pauseStarfield = pauseLoop;
    window.__resumeStarfield = resumeLoop;

    // teardown on unload
    function teardown() {
        if (isTornDown) return;
        isTornDown = true;
        isRenderingActive = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        bgStars = [];
        medStars = [];
        brightStars = [];
        foliage.teardownState();
        cosmos.resetState();
        if (canvas) {
            // Free GPU texture framebuffer immediately by zeroing dimensions
            canvas.width = 0;
            canvas.height = 0;
            if (canvas.parentNode) {
                canvas.parentNode.removeChild(canvas);
            }
        }
    }

    window.addEventListener('beforeunload', teardown, { capture: true, once: true });
    window.addEventListener('pagehide', () => {
        pointerDownStart = null;
        pauseLoop();
    }, { passive: true });

    // lifecycle & bfcache
    document.addEventListener('visibilitychange', () => {
        pointerDownStart = null;
        if (document.hidden) {
            pauseLoop();
        } else {
            resize(false);
            resumeLoop();
        }
    });

    window.addEventListener('pageshow', (e) => {
        if (!e.persisted && !handledInitialPageshow) {
            handledInitialPageshow = true;
            if (performance.now() - initDoneTime < 1500) return;
        }
        // Restored from BFCache (back-forward navigation)
        pointerDownStart = null;
        if (isTornDown) {
            isTornDown = false;
            if (!document.getElementById('starfield-canvas')) {
                initCosmicStarfield();
                return;
            }
        }
        resize(false);
        resumeLoop();
    });

    window.addEventListener('focus', () => {
        pointerDownStart = null;
        isWindowBlurred = false;
        resize(false);
        resumeLoop();
    });

    window.addEventListener('resize', () => {
        if (isTornDown) return;
        resize(false);
    }, { passive: true });

    window.addEventListener('blur', () => {
        pointerDownStart = null;
        isWindowBlurred = true;
        if (document.hidden) {
            pauseLoop();
        } else {
            resize(false);
        }
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (isTornDown) return;
            resize(false);
            resumeLoop();
        }, 150);
    });
}
window.initCosmicStarfield = initCosmicStarfield;
