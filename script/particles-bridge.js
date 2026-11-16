/* particles.js configuration, pointer bridge, starlight sprite renderer, and lifecycle */

const particleConfigBase = {
    particles: {
        number: {
            value: 48,
            density: { enable: false, value_area: 800 }
        },
        shape: { type: 'circle' },
        opacity: {
            value: 0.42,
            random: false,
            anim: { enable: false }
        },
        size: {
            value: 2.0,
            random: true,
            anim: { enable: false }
        },
        line_linked: {
            enable: true,
            distance: 128,
            opacity: 0.18,
            width: 1.0
        },
        move: {
            enable: true,
            speed: 0.65,
            direction: 'none',
            random: false,
            straight: false,
            out_mode: 'out',
            bounce: false,
            attract: { enable: false, rotateX: 0, rotateY: 0 }
        }
    },
    interactivity: {
        detect_on: 'canvas',
        events: {
            onhover: { enable: true, mode: 'grab' },
            onclick: { enable: false, mode: 'push' },
            resize: false
        },
        modes: {
            grab: { distance: 140, line_linked: { opacity: 0.42 } },
            push: { particles_nb: 1 }
        }
    },
    retina_detect: true,
    fps_limit: 0
};

/**
 * Hardware + viewport particle settings.
 * Width buckets set baseline; area cap keeps zoomed-in / small screens clean.
 */
function getParticleSettingsForScreen(screenWidth) {
    const tier = window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2;
    const lowBat = Boolean(window.HardwareProfiler?.isLowBattery?.());
    const isLowPower = tier <= 1 || lowBat;
    const w = Math.min(window.innerWidth || screenWidth, screenWidth || window.innerWidth || 1080);
    const h = window.innerHeight || 800;
    const area = w * h;

    let count;
    let size;
    let distance;

    if (w < 480) {
        count = 28;
        size = 1.65;
        distance = 78;
    } else if (w < 768) {
        count = 42;
        size = 1.8;
        distance = 94;
    } else if (w < 1100) {
        count = 60;
        size = 1.95;
        distance = 116;
    } else if (w < 1500) {
        count = 78;
        size = 2.05;
        distance = 130;
    } else {
        count = 94;
        size = 2.15;
        distance = 142;
    }

    if (isLowPower) {
        count = Math.min(28, Math.round(count * 0.52));
    } else if (tier === 2) {
        count = Math.min(count, 48);
    } else {
        count = Math.min(count, 56);
    }

    const isDesktop = !isCoarsePointer() && ((window.screen && window.screen.width >= 1024) || w >= 1024);
    const minFloor = isLowPower ? 18 : (isDesktop ? 36 : 20);
    const areaCap = Math.max(minFloor, Math.min(56, Math.round(area / 24000)));
    count = Math.max(minFloor, Math.min(count, areaCap));
    return { count, size, distance };
}

function hexToRgbSafe(hex) {
    if (typeof hexToRgb === 'function') {
        return hexToRgb(hex);
    }
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 216, g: 178, b: 120 };
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
        pJSInstance.particles.line_linked.enable = true;
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
window.tintParticles = tintParticles;

function getTargetParticlePxRatio() {
    const rawDpr = window.devicePixelRatio || 1;
    const lowBat = Boolean(window.HardwareProfiler?.isLowBattery?.());
    const isMobile = typeof isCoarsePointer === 'function' && isCoarsePointer();
    const maxPxRatio = lowBat ? 1.25 : (isMobile ? 1.5 : 2.25);
    return Math.min(Math.max(1, rawDpr), maxPxRatio);
}

function refreshCachedCanvasRect(el) {
    if (!el) return null;
    const w = el.offsetWidth || window.innerWidth || 0;
    const h = el.offsetHeight || window.innerHeight || 0;
    el._pxeRect = { left: 0, top: 0, width: w, height: h };
    return el._pxeRect;
}

/**
 * Keep canvas buffer sized to the element (resize:false in particles.js).
 */
function syncParticleCanvasSize(pJSInstance) {
    const el = pJSInstance.canvas && pJSInstance.canvas.el;
    if (!el || !el.offsetWidth || !el.offsetHeight) return;
    refreshCachedCanvasRect(el);
    const pxratio = getTargetParticlePxRatio();
    const w = Math.round(el.offsetWidth * pxratio);
    const h = Math.round(el.offsetHeight * pxratio);
    const prevW = pJSInstance.canvas.w || 0;
    const prevH = pJSInstance.canvas.h || 0;
    if (prevW === w && prevH === h && pJSInstance.canvas.pxratio === pxratio) {
        return;
    }

    if (prevW > 0 && prevH > 0 && (prevW !== w || prevH !== h)) {
        const arr = pJSInstance.particles?.array;
        if (Array.isArray(arr) && arr.length > 0) {
            const sx = w / prevW;
            const sy = h / prevH;
            for (let i = 0; i < arr.length; i++) {
                const p = arr[i];
                const r = Math.max(1, p.radius || 2);
                const maxX = Math.max(r, w - r);
                const maxY = Math.max(r, h - r);
                p.x = Math.max(r, Math.min(maxX, p.x * sx));
                p.y = Math.max(r, Math.min(maxY, p.y * sy));
            }
        }
    }

    pJSInstance.canvas.pxratio = pxratio;
    pJSInstance.tmp = pJSInstance.tmp || {};
    pJSInstance.tmp.retina = pxratio > 1;
    pJSInstance.canvas.w = w;
    pJSInstance.canvas.h = h;
    el.width = w;
    el.height = h;

    if (pJSInstance.fn?.particlesDraw && !pJSInstance.particles?.move?.enable) {
        pJSInstance.fn.particlesDraw();
    }
}
window.syncParticleCanvasSize = syncParticleCanvasSize;

/**
 * Map viewport client coords to particles.js canvas buffer pixels without forcing reflow.
 */
function clientToParticleCanvas(pJS, clientX, clientY) {
    const el = pJS.canvas && pJS.canvas.el;
    if (!el) return null;
    const rect = el._pxeRect || refreshCachedCanvasRect(el);
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    const bw = el.width || pJS.canvas.w;
    const bh = el.height || pJS.canvas.h;
    if (!bw || !bh) return null;
    if (pJS.canvas.w !== bw) pJS.canvas.w = bw;
    if (pJS.canvas.h !== bh) pJS.canvas.h = bh;
    return {
        x: ((clientX - rect.left) / rect.width) * bw,
        y: ((clientY - rect.top) / rect.height) * bh
    };
}
window.clientToParticleCanvas = clientToParticleCanvas;

/**
 * Strip native particles.js mouse listeners; the pointer bridge owns coordinates.
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
        } catch (_) {}
    }
}

/**
 * Pointer bridge: canvas is pointer-events:none; feeds grab + click/tap push.
 */
function ensureParticlePointerBridge() {
    if (window.__pxeParticleBridge) return;
    window.__pxeParticleBridge = true;

    const interactiveSel =
        'a,button,input,textarea,select,label,summary,' +
        '[role="button"],[role="link"],[role="menuitem"],' +
        '.header-btn,.header-nav-btn,.contact-btn,.icon-button,.social-link,.tech-item,' +
        '.theme-toggle,.vocalizer,.terminal-link,.terminal-btn,' +
        '.notes-btn,.notes-resync-mini-btn,.notes-link-btn,.notes-page-pill,.notes-card-share-btn,.notes-tag-pill,' +
        '.notes-chip,.notes-chip-clear,.notes-article-card,.notes-custom-select-option,.notes-custom-select-trigger,' +
        '[data-card-tag],[data-category],[data-tag],[data-slug],' +
        '.notes-mindmap-modal-dialog,.notes-lightbox-content,' +
        '.resume-link,pre,code';
    window.__pxeInteractiveSelector = interactiveSel;

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
        return clientX >= 0 && clientX <= window.innerWidth && clientY >= 0 && clientY <= window.innerHeight;
    }

    function spawnAt(pJS, clientX, clientY) {
        if (!pJS || !pJS.fn) return false;
        const pt = clientToParticleCanvas(pJS, clientX, clientY);
        if (!pt) return false;
        if (pt.x < 0 || pt.y < 0 || pt.x > (pJS.canvas?.w || window.innerWidth) || pt.y > (pJS.canvas?.h || window.innerHeight)) return false;

        const arr = pJS.particles?.array;
        const base = pJS.particles?.number?.value || 60;
        const hardCap = base + 12;
        const n = pJS.interactivity?.modes?.push?.particles_nb || 1;
        if (arr && arr.length + n > hardCap) {
            const overflow = arr.length + n - hardCap;
            if (pJS.fn.modes?.removeParticles) pJS.fn.modes.removeParticles(overflow);
            else arr.splice(0, overflow);
        }

        if (pJS.fn.modes?.pushParticles) {
            pJS.interactivity.mouse.pos_x = pt.x;
            pJS.interactivity.mouse.pos_y = pt.y;
            pJS.interactivity.mouse.click_pos_x = pt.x;
            pJS.interactivity.mouse.click_pos_y = pt.y;
            pJS.fn.modes.pushParticles(n, { pos_x: pt.x, pos_y: pt.y });
            return true;
        }
        return false;
    }

    let touchTap = null;
    let mouseTap = null;
    let pendingPointerRaf = null;
    let pendingPointerPos = null;
    let lastSpawnTime = 0;

    function isParticlesActiveTheme() {
        return !document.documentElement.classList.contains('light') &&
               !(document.body && document.body.classList.contains('light-theme'));
    }

    window.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !isParticlesActiveTheme()) return;
        if (isInteractiveTarget(e.target)) return;
        const pJS = livePJS();
        if (!pJS) return;
        if (!inCanvas(pJS, e.clientX, e.clientY)) return;

        if (e.pointerType === 'mouse' && pJS.interactivity?.events?.onhover?.enable) {
            setMouse(pJS, e.clientX, e.clientY);
            mouseTap = { x: e.clientX, y: e.clientY, time: Date.now(), moved: false };
        }

        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            touchTap = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
        }
    }, { passive: true });

    window.addEventListener('pointermove', (e) => {
        if (!isParticlesActiveTheme()) return;
        const pJS = livePJS();
        if (!pJS) return;

        if (touchTap && e.pointerId === touchTap.id) {
            const dx = e.clientX - touchTap.x;
            const dy = e.clientY - touchTap.y;
            if (dx * dx + dy * dy > 80) touchTap.moved = true;
        }

        if (mouseTap) {
            const mdx = e.clientX - mouseTap.x;
            const mdy = e.clientY - mouseTap.y;
            if (mdx * mdx + mdy * mdy > 64) mouseTap.moved = true;
        }

        if (e.pointerType !== 'mouse') return;
        if (!pJS.interactivity?.events?.onhover?.enable) return;

        pendingPointerPos = { x: e.clientX, y: e.clientY };
        if (!pendingPointerRaf) {
            pendingPointerRaf = requestAnimationFrame(() => {
                pendingPointerRaf = null;
                if (!pendingPointerPos) return;
                const { x, y } = pendingPointerPos;
                if (!inCanvas(pJS, x, y)) {
                    clearMouse(pJS);
                } else {
                    setMouse(pJS, x, y);
                }
            });
        }
    }, { passive: true });

    function endPointer(e) {
        if (pendingPointerRaf) {
            cancelAnimationFrame(pendingPointerRaf);
            pendingPointerRaf = null;
        }
        const pJS = livePJS();
        if (!pJS) return;

        const now = Date.now();

        if (touchTap && e.pointerId === touchTap.id) {
            const tap = touchTap;
            touchTap = null;
            if (!tap.moved && !isInteractiveTarget(e.target) && inCanvas(pJS, tap.x, tap.y)) {
                if (now - lastSpawnTime > 120) {
                    lastSpawnTime = now;
                    spawnAt(pJS, tap.x, tap.y);
                }
                window.__pxeSkipClickSpawnUntil = now + 400;
            }
            clearMouse(pJS);
            return;
        }

        if (mouseTap && e.pointerType === 'mouse') {
            const mt = mouseTap;
            mouseTap = null;
            if (!mt.moved && !isInteractiveTarget(e.target) && inCanvas(pJS, e.clientX, e.clientY)) {
                if (now - lastSpawnTime > 120) {
                    lastSpawnTime = now;
                    spawnAt(pJS, e.clientX, e.clientY);
                }
                window.__pxeSkipClickSpawnUntil = now + 400;
            }
        }

        if (e.pointerType === 'mouse' && !inCanvas(pJS, e.clientX, e.clientY)) {
            clearMouse(pJS);
        }
    }

    window.addEventListener('pointerup', endPointer, { passive: true });
    window.addEventListener('pointercancel', () => {
        touchTap = null;
        mouseTap = null;
        if (pendingPointerRaf) {
            cancelAnimationFrame(pendingPointerRaf);
            pendingPointerRaf = null;
        }
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    }, { passive: true });

    window.addEventListener('blur', () => {
        touchTap = null;
        mouseTap = null;
        if (pendingPointerRaf) {
            cancelAnimationFrame(pendingPointerRaf);
            pendingPointerRaf = null;
        }
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    });

    document.addEventListener('visibilitychange', () => {
        touchTap = null;
        mouseTap = null;
        if (pendingPointerRaf) {
            cancelAnimationFrame(pendingPointerRaf);
            pendingPointerRaf = null;
        }
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
        const pJS = livePJS();
        if (pJS) clearMouse(pJS);
    });

    window.addEventListener('click', (e) => {
        if (e.button && e.button !== 0) return;
        if (!isParticlesActiveTheme()) return;
        if (window.__pxeSkipClickSpawnUntil && Date.now() < window.__pxeSkipClickSpawnUntil) return;
        if (isInteractiveTarget(e.target)) return;
        const pJS = livePJS();
        if (!pJS) return;
        if (!inCanvas(pJS, e.clientX, e.clientY)) return;
        const now = Date.now();
        if (now - lastSpawnTime > 120) {
            lastSpawnTime = now;
            spawnAt(pJS, e.clientX, e.clientY);
        }
    }, true);

    window.addEventListener('mousedown', (e) => {
        if (e.detail <= 1 || e.shiftKey) return;
        const t = e.target;
        if (!t) return;
        const isBackgroundCanvas =
            t === document.body ||
            t === document.documentElement ||
            (t.matches && t.matches('#particles-js, #starfield-canvas, .site-backdrop, .site-backdrop-layer, canvas'));
        if (isBackgroundCanvas) {
            e.preventDefault();
        }
    }, false);
}

function computeTargetParticleMetrics(particleColor) {
    const sky = skyFromInk(particleColor);
    const color = particleColor || sky.hex;
    const vw = window.innerWidth || 1080;
    const { count, size, distance } = getParticleSettingsForScreen(vw);
    const tier = window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2;
    const isLowPower = tier <= 1 || Boolean(window.HardwareProfiler?.isLowBattery?.());
    const onBattery = Boolean(window.HardwareProfiler?.isOnBattery?.());
    const pxratio = getTargetParticlePxRatio();
    const baseLineWidth = vw < 768 ? 0.9 : sky.lineW;
    const baseGrabDist = vw < 768 ? 95 : 155;
    return {
        sky,
        color,
        pxratio,
        isLowPower,
        onBattery,
        targetCount: Math.max(10, Math.round(count * (sky.countScale || 1))),
        sizeValue: size * (sky.sizeScale || 1) * pxratio,
        distanceValue: Math.round(distance * (sky.distScale || 1) * pxratio),
        lineOpacityValue: vw < 768 ? Math.min(sky.lineOp, 0.22) : sky.lineOp,
        lineWidthValue: baseLineWidth * pxratio,
        moveSpeedValue: particleConfigBase.particles.move.speed * (sky.speedScale || 1) * pxratio,
        grabDistanceValue: Math.round(baseGrabDist * pxratio)
    };
}

function syncLiveParticleProfile(pJSInstance, particleColor) {
    if (!pJSInstance) return;
    syncParticleCanvasSize(pJSInstance);
    const m = computeTargetParticleMetrics(particleColor);
    const prevSizeValue = pJSInstance.particles.size.value || m.sizeValue;
    pJSInstance.particles.number.value = m.targetCount;
    pJSInstance.particles.size.value = m.sizeValue;
    if (pJSInstance.particles.line_linked) {
        pJSInstance.particles.line_linked.distance = m.distanceValue;
        pJSInstance.particles.line_linked.opacity = m.lineOpacityValue;
        pJSInstance.particles.line_linked.width = m.lineWidthValue;
    }
    if (pJSInstance.particles.move) {
        pJSInstance.particles.move.speed = m.moveSpeedValue;
    }
    if (pJSInstance.interactivity?.modes?.grab) {
        pJSInstance.interactivity.modes.grab.distance = m.grabDistanceValue;
    }

    const arr = pJSInstance.particles?.array;
    if (Array.isArray(arr)) {
        if (prevSizeValue > 0 && Math.abs(prevSizeValue - m.sizeValue) > 0.01) {
            const sizeRatio = m.sizeValue / prevSizeValue;
            for (let i = 0; i < arr.length; i++) {
                if (typeof arr[i].radius === 'number') {
                    arr[i].radius = Math.max(0.6, arr[i].radius * sizeRatio);
                }
            }
        }
        const prevLen = arr.length;
        if (prevLen < m.targetCount && pJSInstance.fn?.modes?.pushParticles) {
            pJSInstance.fn.modes.pushParticles(m.targetCount - prevLen);
            if (prevLen === 0 || (m.targetCount - prevLen) >= Math.max(4, Math.floor(m.targetCount * 0.25))) {
                distributeParticlesHarmoniously(pJSInstance);
            }
        } else if (arr.length > m.targetCount + 12 && pJSInstance.fn?.modes?.removeParticles) {
            pJSInstance.fn.modes.removeParticles(arr.length - m.targetCount);
        }
    }

    tintParticles(pJSInstance, m.color);
    pJSInstance.interactivity.events.onhover.enable = !isCoarsePointer();
    pJSInstance.interactivity.events.onclick.enable = false;
    detachNativeParticleMouse(pJSInstance);
}

function initializeParticles(particleColor, forceReinit = false) {
    const particlesJSElement = document.getElementById('particles-js');
    if (!particlesJSElement) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    ensureParticlePointerBridge();

    const live = window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS;
    const m = computeTargetParticleMetrics(particleColor);
    const { sky, color } = m;

    if (!forceReinit && live) {
        syncLiveParticleProfile(live, color);
        return;
    }

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
    currentParticleConfig.particles.line_linked.opacity = m.lineOpacityValue;
    currentParticleConfig.particles.line_linked.width = m.lineWidthValue;
    currentParticleConfig.interactivity.modes.grab.line_linked.opacity =
        sky.grabLineOp || particleConfigBase.interactivity.modes.grab.line_linked.opacity;
    currentParticleConfig.interactivity.events.onhover.enable = !isCoarsePointer();
    currentParticleConfig.interactivity.events.onclick.enable = false;

    currentParticleConfig.particles.number.value = m.targetCount;
    currentParticleConfig.particles.size.value = m.sizeValue;
    currentParticleConfig.particles.line_linked.enable = true;
    currentParticleConfig.particles.line_linked.distance = m.distanceValue;
    currentParticleConfig.particles.move.speed = m.moveSpeedValue;
    currentParticleConfig.interactivity.modes.grab.distance = m.grabDistanceValue;
    currentParticleConfig.particles.number.density.enable = false;
    // keep particles.min.js from multiplying by full DPR
    currentParticleConfig.retina_detect = false;
    currentParticleConfig.fps_limit = m.isLowPower ? 26 : (m.onBattery ? 30 : 42);

    try {
        if (typeof particlesJS === 'undefined') {
            let retries = 0;
            const maxRetries = 50;
            const tryInit = () => {
                if (typeof particlesJS !== 'undefined') {
                    clearInterval(retryInterval);
                    particlesJS('particles-js', currentParticleConfig);
                    finalizeParticlesInit();
                    return true;
                }
                return false;
            };
            const retryInterval = setInterval(() => {
                if (!tryInit() && ++retries >= maxRetries) {
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
window.initializeParticles = initializeParticles;

function triggerParticlesFallback(error) {
    if (error) console.warn('Particles.js fallback triggered:', error.message);
    const particlesContainer = document.getElementById('particles-js');
    if (particlesContainer) {
        particlesContainer.classList.add('fallback-background');
    }
    document.body.classList.add('fallback-mode');
}

/**
 * Multi-jittered stratified grid distribution with short-range repulsion.
 */
function distributeParticlesHarmoniously(pJSInstance) {
    const arr = pJSInstance.particles?.array;
    if (!arr || arr.length === 0) return;
    const w = pJSInstance.canvas.w || (window.innerWidth * (pJSInstance.canvas.pxratio || 1));
    const h = pJSInstance.canvas.h || (window.innerHeight * (pJSInstance.canvas.pxratio || 1));
    const count = arr.length;

    const padX = Math.max(28, w * 0.04);
    const padY = Math.max(28, h * 0.04);
    const usableW = Math.max(100, w - padX * 2);
    const usableH = Math.max(100, h - padY * 2);

    const aspect = usableW / usableH;
    let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
    let rows = Math.max(1, Math.ceil(count / cols));
    while (cols * rows < count) rows++;

    const cellW = usableW / cols;
    const cellH = usableH / rows;

    const indices = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (let i = 0; i < count; i++) {
        const p = arr[i];
        const cellIdx = indices[i];
        const cx = cellIdx % cols;
        const cy = Math.floor(cellIdx / cols);
        const jx = (Math.random() * 0.70 + 0.15) * cellW;
        const jy = (Math.random() * 0.70 + 0.15) * cellH;
        p.x = padX + cx * cellW + jx;
        p.y = padY + cy * cellH + jy;
    }

    const minD = Math.max(36, Math.sqrt((usableW * usableH) / (count * 1.15)) * 0.42);
    const minDSq = minD * minD;

    for (let iter = 0; iter < 4; iter++) {
        for (let i = 0; i < count; i++) {
            const pi = arr[i];
            let fx = 0, fy = 0;
            for (let j = 0; j < count; j++) {
                if (i === j) continue;
                const pj = arr[j];
                const dx = pi.x - pj.x;
                const dy = pi.y - pj.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < minDSq && dSq > 0.0001) {
                    const d = Math.sqrt(dSq);
                    const force = ((minD - d) / minD) * 0.35;
                    fx += (dx / d) * force * minD;
                    fy += (dy / d) * force * minD;
                }
            }
            pi.x = Math.max(padX * 0.6, Math.min(w - padX * 0.6, pi.x + fx));
            pi.y = Math.max(padY * 0.6, Math.min(h - padY * 0.6, pi.y + fy));
        }
    }
}

function finalizeParticlesInit() {
    const particlesContainer = document.getElementById('particles-js');
    if (particlesContainer) {
        particlesContainer.classList.remove('fallback-background');
    }
    document.body.classList.remove('fallback-mode');

    if (!(window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS)) return;
    const pJSInstance = window.pJSDom[0].pJS;

    syncParticleCanvasSize(pJSInstance);
    pJSInstance.particles.number.density.enable = false;

    const target = pJSInstance.particles.number.value || 80;
    const arr = pJSInstance.particles.array;
    if (arr && arr.length > target && pJSInstance.fn?.modes?.removeParticles) {
        pJSInstance.fn.modes.removeParticles(arr.length - target);
    }

    distributeParticlesHarmoniously(pJSInstance);

    if (pJSInstance.fn?.particlesUpdate && !pJSInstance.fn.__dtWrapped) {
        let lastPJSUpdateTime = 0;
        const origParticlesUpdate = pJSInstance.fn.particlesUpdate.bind(pJSInstance.fn);
        pJSInstance.fn.particlesUpdate = function() {
            const now = performance.now();
            const deltaMs = lastPJSUpdateTime ? Math.min(50, Math.max(4, now - lastPJSUpdateTime)) : 16.67;
            lastPJSUpdateTime = now;
            const dtNorm = deltaMs / 16.67;

            const origSpeed = pJSInstance.particles?.move?.speed ?? 0.48;
            if (pJSInstance.particles?.move) {
                pJSInstance.particles.move.speed = origSpeed * dtNorm;
            }
            origParticlesUpdate();
            if (pJSInstance.particles?.move) {
                pJSInstance.particles.move.speed = origSpeed;
            }
        };
        pJSInstance.fn.__dtWrapped = true;
    }

    pJSInstance.interactivity.detect_on = 'canvas';
    pJSInstance.interactivity.el = pJSInstance.canvas.el;
    if (pJSInstance.interactivity.events && pJSInstance.interactivity.events.onhover) {
        pJSInstance.interactivity.events.onhover.enable = !isCoarsePointer();
    }
    detachNativeParticleMouse(pJSInstance);

    const particlesJSElement = document.getElementById('particles-js');
    if (particlesJSElement) {
        particlesJSElement.style.pointerEvents = 'none';
        particlesJSElement.style.zIndex = '1';
        particlesJSElement.style.position = 'fixed';
    }

    let starlightSpriteCache = null;
    let lastCachedColorKey = '';

    function getStarlightSprite(outerR, rgb) {
        const colorKey = `${rgb.r},${rgb.g},${rgb.b}`;
        if (!starlightSpriteCache || lastCachedColorKey !== colorKey) {
            starlightSpriteCache = new Map();
            lastCachedColorKey = colorKey;
        }

        const quantR = Math.min(24, Math.max(2.5, Math.round(outerR * 2) / 2));
        if (starlightSpriteCache.has(quantR)) {
            return starlightSpriteCache.get(quantR);
        }

        const pad = 3;
        const radiusInt = Math.ceil(quantR);
        const center = radiusInt + pad;
        const size = center * 2;
        const offCanvas = document.createElement('canvas');
        offCanvas.width = size;
        offCanvas.height = size;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) return null;

        const grad = offCtx.createRadialGradient(center, center, 0, center, center, quantR);
        grad.addColorStop(0, 'rgba(255, 255, 252, 1.0)');
        grad.addColorStop(0.20, 'rgba(255, 250, 240, 0.96)');
        grad.addColorStop(0.42, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.88)`);
        grad.addColorStop(0.72, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
        grad.addColorStop(1.0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

        offCtx.fillStyle = grad;
        offCtx.beginPath();
        offCtx.arc(center, center, quantR, 0, Math.PI * 2, false);
        offCtx.fill();

        const coreR = Math.max(0.75, quantR * 0.25);
        offCtx.fillStyle = 'rgba(255, 254, 248, 0.98)';
        offCtx.beginPath();
        offCtx.arc(center, center, coreR, 0, Math.PI * 2, false);
        offCtx.fill();

        const entry = { canvas: offCanvas, halfSize: center };
        starlightSpriteCache.set(quantR, entry);
        return entry;
    }

    pJSInstance.fn.particle.prototype.draw = function() {
        const a = this;
        const ctx = pJSInstance.canvas.ctx;
        if (!ctx) return;
        const radius = (a.radius_bubble !== undefined) ? a.radius_bubble : a.radius;
        const opacity = (a.opacity_bubble !== undefined) ? a.opacity_bubble : a.opacity;
        if (opacity <= 0 || radius <= 0) return;

        const rgb = a.color.rgb || { r: 216, g: 178, b: 120 };
        const outerR = radius * 2.2;

        const sprite = getStarlightSprite(outerR, rgb);
        if (sprite) {
            const prevAlpha = ctx.globalAlpha;
            ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
            ctx.drawImage(sprite.canvas, a.x - sprite.halfSize, a.y - sprite.halfSize);
            ctx.globalAlpha = prevAlpha;
        } else {
            const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, outerR);
            grad.addColorStop(0, `rgba(255, 255, 250, ${(opacity * 0.98).toFixed(3)})`);
            grad.addColorStop(0.24, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(opacity * 0.88).toFixed(3)})`);
            grad.addColorStop(0.58, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(opacity * 0.26).toFixed(3)})`);
            grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(a.x, a.y, outerR, 0, Math.PI * 2, false);
            ctx.fill();
        }
    };

    const isLight = document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'));
    if (isLight && pJSInstance.particles?.move) {
        pJSInstance.particles.move.enable = false;
    }
}

let isParticlesPausedByLifecycle = false;

function getDesiredParticleFps(tier) {
    const effectiveTier = typeof tier === 'number' ? tier : (window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2);
    const lowBat = Boolean(window.HardwareProfiler?.isLowBattery?.());
    const onBattery = Boolean(window.HardwareProfiler?.isOnBattery?.());
    const readerFocused = Boolean(document.body?.classList?.contains('reader-focused'));
    const unfocused = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
    if (unfocused || readerFocused) return 18;
    if (effectiveTier <= 1 || lowBat) return 26;
    return onBattery ? 30 : 42;
}

function pauseParticleLoop(pJS) {
    if (!pJS) return;
    if (pJS.particles?.move) pJS.particles.move.enable = false;
    if (pJS.fn?.drawAnimFrame) {
        const cancel = window.cancelRequestAnimFrame || window.cancelAnimationFrame;
        if (cancel) cancel(pJS.fn.drawAnimFrame);
        pJS.fn.drawAnimFrame = null;
    }
    isParticlesPausedByLifecycle = true;
}

function resumeParticleLoop(pJS, tier) {
    if (!pJS || isParticlesTornDown || document.hidden) return;
    if (document.body?.classList?.contains('light-theme') || document.documentElement.classList.contains('light')) return;
    pJS.fps_limit = getDesiredParticleFps(tier);
    syncParticleCanvasSize(pJS);
    if (pJS.particles?.move) {
        pJS.particles.move.enable = true;
    }
    if (pJS.fn && typeof pJS.fn.vendors?.draw === 'function') {
        if (!pJS.fn.drawAnimFrame) {
            pJS.fn.vendors.draw();
        }
    }
    isParticlesPausedByLifecycle = false;
}

window.__pauseParticles = function() {
    pauseParticleLoop(window.pJSDom?.[0]?.pJS);
};
window.__resumeParticles = function() {
    const pJS = window.pJSDom?.[0]?.pJS;
    if (pJS) {
        resumeParticleLoop(pJS);
    } else if (!isParticlesTornDown && !document.hidden && !document.documentElement.classList.contains('light') && typeof initializeParticles === 'function') {
        initializeParticles(getSky().hex, false);
    }
};

function applyParticlePowerProfile(tier) {
    const pJSInstance = window.pJSDom?.[0]?.pJS;
    if (!pJSInstance) return;
    const effectiveTier = typeof tier === 'number' ? tier : (window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2);
    pJSInstance.fps_limit = getDesiredParticleFps(effectiveTier);
    const isLight = document.documentElement.classList.contains('light') ||
        (document.body && document.body.classList.contains('light-theme'));
    if (!isLight) {
        syncLiveParticleProfile(pJSInstance, window.SKY?.dark?.hex || '#D8B278');
    } else {
        syncParticleCanvasSize(pJSInstance);
    }
}

if (window.HardwareProfiler && typeof window.HardwareProfiler.onTierChange === 'function') {
    window.HardwareProfiler.onTierChange(applyParticlePowerProfile);
}

let isParticlesTornDown = false;
function teardownParticles() {
    if (isParticlesTornDown) return;
    isParticlesTornDown = true;
    try {
        if (window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS) {
            const p = window.pJSDom[0].pJS;
            if (p.fn?.vendors?.destroypJS) {
                p.fn.vendors.destroypJS();
            }
            if (p.canvas?.el) {
                p.canvas.el.width = 0;
                p.canvas.el.height = 0;
                if (p.canvas.el.parentNode) {
                    p.canvas.el.parentNode.removeChild(p.canvas.el);
                }
            }
        }
        window.pJSDom = [];
    } catch (_) {}
}

document.addEventListener('visibilitychange', () => {
    const pJS = window.pJSDom?.[0]?.pJS;
    if (!pJS) return;
    if (document.hidden) {
        pauseParticleLoop(pJS);
    } else {
        resumeParticleLoop(pJS);
    }
});

window.addEventListener('blur', () => {
    const pJS = window.pJSDom?.[0]?.pJS;
    if (!pJS) return;
    if (document.hidden) {
        pauseParticleLoop(pJS);
    } else {
        applyParticlePowerProfile();
    }
});

window.addEventListener('focus', () => {
    const pJS = window.pJSDom?.[0]?.pJS;
    if (!pJS) return;
    resumeParticleLoop(pJS);
});

let particleResizeRaf = null;
let lastParticleResizeW = window.innerWidth || 0;
let lastParticleResizeH = window.innerHeight || 0;
window.addEventListener('resize', () => {
    if (isParticlesTornDown || particleResizeRaf) return;
    const curW = window.innerWidth || 0;
    const curH = window.innerHeight || 0;
    if (typeof isCoarsePointer === 'function' && isCoarsePointer() && lastParticleResizeW > 0 &&
        Math.abs(curW - lastParticleResizeW) < 4 && Math.abs(curH - lastParticleResizeH) < 160) {
        return;
    }
    particleResizeRaf = requestAnimationFrame(() => {
        particleResizeRaf = null;
        lastParticleResizeW = window.innerWidth || 0;
        lastParticleResizeH = window.innerHeight || 0;
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS) return;
        const isLight = document.documentElement.classList.contains('light') ||
            (document.body && document.body.classList.contains('light-theme'));
        if (!isLight) {
            const darkHex = window.SKY?.dark?.hex || '#D8B278';
            syncLiveParticleProfile(pJS, darkHex);
        } else {
            syncParticleCanvasSize(pJS);
        }
    });
}, { passive: true });

window.addEventListener('beforeunload', teardownParticles, { capture: true, once: true });
window.addEventListener('pagehide', () => {
    pauseParticleLoop(window.pJSDom?.[0]?.pJS);
}, { passive: true });

