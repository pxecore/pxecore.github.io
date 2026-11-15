(function () {
    'use strict';

    const modules = [
        'script/hardware-profiler.js',
        'script/theme-palettes.js',
        'script/particles.min.js',
        'script/particles-bridge.js',
        'script/audio-player.js',
        'script/effects-cosmos.js',
        'script/effects-foliage.js',
        'script/effects.js',
        'script/chroma-engine.js',
        'script/notes-markdown.js',
        'script/notes-graph.js',
        'script/notes-sync.js',
        'script/notes.js',
        'script/terminal.js',
        'script/main.js'
    ];

    const host = document.head || document.documentElement;
    for (const src of modules) {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        host.appendChild(s);
    }
})();
