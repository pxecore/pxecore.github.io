// hardware capability tiering
(function(window) {
    'use strict';

    let currentTier = 2;
    let isLowBattery = false;
    let isOnBattery = false;
    let isDataSaver = false;
    let isReducedMotion = false;
    let cachedGpuAcceleration = null;
    const listeners = [];

    function isCoarsePointer() {
        try {
            return window.matchMedia('(pointer: coarse)').matches;
        } catch (_) {
            return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        }
    }

    function hasGpuAcceleration() {
        if (cachedGpuAcceleration !== null) return cachedGpuAcceleration;
        cachedGpuAcceleration = true;
        return true;
    }

    function evaluateTier() {
        try {
            isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {}

        try {
            if (navigator.connection) {
                isDataSaver = Boolean(navigator.connection.saveData) || 
                              navigator.connection.effectiveType === '2g' || 
                              navigator.connection.effectiveType === 'slow-2g';
            }
        } catch (_) {}

        const cores = navigator.hardwareConcurrency || 4;
        const hasDeviceMemory = typeof navigator.deviceMemory === 'number';
        const memory = hasDeviceMemory ? navigator.deviceMemory : 8;
        const isCoarse = isCoarsePointer();
        const innerW = window.innerWidth || 1024;
        const screenW = (!isCoarse && window.screen && typeof window.screen.width === 'number') ? window.screen.width : 0;
        const width = isCoarse ? innerW : Math.max(innerW, screenW);

        // Tier determination: mobile/software (1), standard desktop (2), high-spec desktop (3)
        if (isReducedMotion || isLowBattery || cachedGpuAcceleration === false || isCoarse || width <= 768 || cores < 4 || memory < 4) {
            currentTier = 1;
        } else if (width >= 1440 && cores >= 8 && (!hasDeviceMemory || memory >= 8)) {
            currentTier = 3;
        } else {
            currentTier = 2;
        }

        if (document.documentElement) {
            document.documentElement.setAttribute('data-hardware-tier', String(currentTier));
        }

        return currentTier;
    }

    // Passive no-op: avoids WebGL debug renderer and Battery Status API fingerprinting
    function scheduleDeferredChecks() {}

    // Network Information API
    if (navigator.connection) {
        navigator.connection.addEventListener('change', function() {
            const oldTier = currentTier;
            const newTier = evaluateTier();
            if (oldTier !== newTier) {
                dispatchTierChange(newTier);
            }
        });
    }

    // Reduced Motion change listener
    try {
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mql.addEventListener) {
            mql.addEventListener('change', function() {
                const oldTier = currentTier;
                const newTier = evaluateTier();
                if (oldTier !== newTier) {
                    dispatchTierChange(newTier);
                }
            });
        }
    } catch (_) {}

    function dispatchTierChange(tier) {
        window.dispatchEvent(new CustomEvent('hardware-tier-changed', { detail: { tier: tier } }));
        for (let i = 0; i < listeners.length; i++) {
            try { listeners[i](tier); } catch (_) {}
        }
    }

    // Debounced Resize and Orientation Listener for Viewport/Tier Transition
    let resizeTimer = null;
    function handleResizeOrOrientation() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            const oldTier = currentTier;
            const newTier = evaluateTier();
            if (oldTier !== newTier) {
                dispatchTierChange(newTier);
            }
        }, 200);
    }

    window.addEventListener('resize', handleResizeOrOrientation, { passive: true });
    window.addEventListener('orientationchange', handleResizeOrOrientation, { passive: true });

    // Evaluate initially
    evaluateTier();
    scheduleDeferredChecks();

    window.isCoarsePointer = isCoarsePointer;

    window.HardwareProfiler = Object.freeze({
        getTier: function() { return currentTier; },
        recheck: evaluateTier,
        isLowBattery: function() { return isLowBattery; },
        isOnBattery: function() { return isOnBattery; },
        isDataSaver: function() { return isDataSaver; },
        isReducedMotion: function() { return isReducedMotion; },
        isCoarsePointer: isCoarsePointer,
        hasGpuAcceleration: hasGpuAcceleration,
        onTierChange: function(fn) {
            if (typeof fn === 'function' && listeners.length < 32) listeners.push(fn);
        },
        demoteTier: function() {
            if (currentTier > 0) {
                currentTier--;
                if (document.documentElement) {
                    document.documentElement.setAttribute('data-hardware-tier', String(currentTier));
                }
                dispatchTierChange(currentTier);
            }
        }
    });

})(window);
