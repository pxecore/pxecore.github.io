/**
 * pxecore — Chroma Engine
 *
 * Applies theme palettes from window.PXECORE_PALETTES to CSS custom properties
 * and notifies live canvas renderers (particles, starfield, foliage).
 */
(function (window) {
    'use strict';

    const DEFAULT_PALETTES = window.PXECORE_PALETTES || {};

    function applyPalette(palette, themeId) {
        if (!palette) return;

        const root = document.documentElement;
        const updateVar = (prop, val) => {
            if (val !== undefined && val !== null && root.style.getPropertyValue(prop) !== val) {
                root.style.setProperty(prop, val);
            }
        };

        updateVar('--accent', palette.accent);
        updateVar('--accent-rgb', palette.accent_rgb);
        updateVar('--terminal-prompt', palette.accent);
        updateVar('--particle-color', palette.particle_color);

        if (typeof window.SKY !== 'undefined' && window.SKY[themeId] && palette.sky) {
            const skyObj = window.SKY[themeId];
            skyObj.hex = palette.sky.hex;
            skyObj.rgb = palette.sky.rgb;
            skyObj.rgbBright = palette.sky.rgbBright;
            skyObj.rgbDim = palette.sky.rgbDim;
        }

        if (window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS && palette.sky) {
            if (typeof window.tintParticles === 'function') {
                window.tintParticles(window.pJSDom[0].pJS, palette.sky.hex);
            }
        }

        if (themeId === 'light' && typeof window.__setChromaLeafPalette === 'function') {
            window.__setChromaLeafPalette(palette.accent_rgb, palette.accent);
        }
    }

    const ChromaEngine = {
        syncTheme: function (themeId, force = false) {
            themeId = themeId === 'light' ? 'light' : 'dark';
            if (!force && this._lastSyncedTheme === themeId) return;
            this._lastSyncedTheme = themeId;

            if (DEFAULT_PALETTES[themeId]) {
                applyPalette(DEFAULT_PALETTES[themeId], themeId);
            }
        },

        init: function () {
            try {
                const keysToRemove = [
                    'pxecore_chroma_dark', 'pxecore_chroma_light',
                    'pxecore_chroma_v3_universal_dark', 'pxecore_chroma_v3_universal_light',
                    'pxecore_chroma_v4_canonical_dark', 'pxecore_chroma_v4_canonical_light',
                    'pxecore_chroma_v5_liquid_dark', 'pxecore_chroma_v5_liquid_light',
                    'pxecore_chroma_v6_apple_dark', 'pxecore_chroma_v6_apple_light'
                ];
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (_) {}

            let activeTheme = 'dark';
            const html = document.documentElement;
            const body = document.body;

            if (html.classList.contains('light') || (body && body.classList.contains('light-theme'))) {
                activeTheme = 'light';
            } else {
                try {
                    const saved = localStorage.getItem('pxecore_theme') || localStorage.getItem('theme');
                    if (saved === 'light' || saved === 'dark') activeTheme = saved;
                } catch (_) {}
            }

            ChromaEngine.syncTheme(activeTheme);

            window.addEventListener('theme-changed', function (e) {
                if (e.detail && e.detail.theme) {
                    ChromaEngine.syncTheme(e.detail.theme);
                }
            });
        }
    };

    window.ChromaEngine = ChromaEngine;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ChromaEngine.init);
    } else {
        ChromaEngine.init();
    }

})(window);
