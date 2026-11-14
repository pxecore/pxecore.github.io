/* Audio player, visualizer envelope, and Web Audio pentatonic synthesizer */

let audioPlaying = false;
let audioElement = null;
let lastAudioToggle = 0;
let visualizerRafId = null;
let visualizerBars = null;
let analyserCtx = null;
let analyserNode = null;
let analyserSource = null;
let analyserData = null;
let analyserFailed = false;
const BAR_COUNT = 10;
const VISUALIZER_INTERVAL_MS = 24; // ~41 FPS: aligns with 80ms CSS transition & avoids 120Hz/144Hz DOM style thrash
let lastVisualizerUpdateTime = 0;
const currentScales = new Float32Array(BAR_COUNT).fill(0.35);

function ensureAudioAnalyser(audio) {
    if (analyserNode || analyserFailed || !audio) return analyserNode;
    if (window.location.protocol === 'file:') {
        analyserFailed = true;
        return null;
    }
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            analyserFailed = true;
            return null;
        }
        analyserCtx = new Ctx();
        analyserSource = analyserCtx.createMediaElementSource(audio);
        analyserNode = analyserCtx.createAnalyser();
        analyserNode.fftSize = 128;
        analyserNode.smoothingTimeConstant = 0.72;
        analyserSource.connect(analyserNode);
        analyserNode.connect(analyserCtx.destination);
        analyserData = new Uint8Array(analyserNode.frequencyBinCount);
        return analyserNode;
    } catch (_) {
        analyserFailed = true;
        return null;
    }
}

const audioEnvelope = {
    active: false,
    bass: 0,
    mid: 0,
    high: 0,
    energy: 0,
    bpm: 74
};
window.__pxecoreAudioEnvelope = audioEnvelope;

// Web Audio pentatonic synthesizer (C4 = 261.6256 Hz)
const SoundSymphony = (function () {
    const BASE_FREQ_HZ = 261.6256;
    const PENTATONIC_RATIOS = Object.freeze([1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3]);
    let audioCtx = null;

    function getNoteFrequency(index) {
        const idx = Math.max(0, Math.min(PENTATONIC_RATIOS.length - 1, Math.floor(index) || 0));
        return BASE_FREQ_HZ * PENTATONIC_RATIOS[idx];
    }

    function playHarmonicChord(indices = [0, 2, 3, 5]) {
        try {
            if (window.HardwareProfiler?.isReducedMotion?.()) return false;
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return false;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            const now = audioCtx.currentTime;
            indices.forEach((noteIdx, i) => {
                const freq = getNoteFrequency(noteIdx);
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                const startT = now + i * 0.075;
                osc.frequency.setValueAtTime(freq, startT);
                gain.gain.setValueAtTime(0.0001, startT);
                gain.gain.linearRampToValueAtTime(0.026 / Math.sqrt(i + 1), startT + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, startT + 0.85);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(startT);
                osc.stop(startT + 0.90);
            });
            return true;
        } catch (_) {
            return false;
        }
    }

    return Object.freeze({
        BASE_FREQ_HZ,
        PENTATONIC_RATIOS,
        getNoteFrequency,
        playHarmonicChord
    });
})();
window.SoundSymphony = SoundSymphony;

function startAudioVisualizer() {
    if (window.HardwareProfiler?.isReducedMotion?.() || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        stopAudioVisualizer();
        return;
    }

    if (!visualizerBars || visualizerBars.length === 0) {
        visualizerBars = Array.from(document.querySelectorAll('.vocalizer-bar'));
    }
    if (!visualizerBars || visualizerBars.length === 0) return;

    if (visualizerRafId) {
        cancelAnimationFrame(visualizerRafId);
        visualizerRafId = null;
    }
    lastVisualizerUpdateTime = 0;

    function renderAudioFrame(now) {
        if (!audioPlaying || !audioElement || audioElement.paused) {
            stopAudioVisualizer();
            return;
        }

        if (document.hidden) {
            visualizerRafId = null;
            audioEnvelope.active = false;
            audioEnvelope.bass = 0;
            return;
        }
        const homeView = document.getElementById('view-home');
        if (homeView && homeView.hasAttribute('hidden')) {
            visualizerRafId = null;
            audioEnvelope.active = false;
            audioEnvelope.bass = 0;
            return;
        }

        if (typeof now === 'number' && lastVisualizerUpdateTime !== 0 && (now - lastVisualizerUpdateTime) < VISUALIZER_INTERVAL_MS) {
            visualizerRafId = requestAnimationFrame(renderAudioFrame);
            return;
        }
        lastVisualizerUpdateTime = typeof now === 'number' ? now : performance.now();

        let hasLiveFft = false;
        if (analyserNode && analyserData && analyserCtx && analyserCtx.state === 'running') {
            analyserNode.getByteFrequencyData(analyserData);
            let sum = 0;
            for (let k = 0; k < analyserData.length; k++) sum += analyserData[k];
            if (sum > 0) hasLiveFft = true;
        }

        const count = Math.min(BAR_COUNT, visualizerBars.length);
        if (hasLiveFft) {
            // Map 64 FFT bins across 10 bars using logarithmic-like bands (bass -> mid -> high)
            const bands = [
                [0, 2], [2, 4], [4, 6],
                [6, 9], [9, 13], [13, 18], [18, 24],
                [24, 32], [32, 44], [44, 60]
            ];
            let bassAcc = 0, midAcc = 0, highAcc = 0;
            for (let i = 0; i < count; i++) {
                const [lo, hi] = bands[i];
                let peak = 0;
                for (let b = lo; b < hi && b < analyserData.length; b++) {
                    if (analyserData[b] > peak) peak = analyserData[b];
                }
                const norm = peak / 255;
                if (i < 3) bassAcc += norm;
                else if (i < 7) midAcc += norm;
                else highAcc += norm;

                const targetScale = 0.35 + norm * 1.50;
                const speed = targetScale > currentScales[i] ? 0.45 : 0.24;
                currentScales[i] += (targetScale - currentScales[i]) * speed;
                visualizerBars[i].style.transform = `scaleY(${currentScales[i].toFixed(2)})`;
            }
            audioEnvelope.active = true;
            audioEnvelope.bass = bassAcc / 3;
            audioEnvelope.mid = midAcc / 4;
            audioEnvelope.high = highAcc / 3;
            audioEnvelope.energy = audioEnvelope.bass * 0.50 + audioEnvelope.mid * 0.35 + audioEnvelope.high * 0.15;
            audioEnvelope.bpm = Math.round(118 + audioEnvelope.bass * 18);
        } else {
            const t = audioElement.currentTime || 0;
            const beat = t * 2.1;
            const kick = Math.pow(Math.max(0, Math.sin(beat * Math.PI)), 4);
            const snare = Math.pow(Math.max(0, Math.sin((beat + 1.0) * Math.PI * 0.5)), 3);

            audioEnvelope.active = true;
            audioEnvelope.bass = kick;
            audioEnvelope.mid = snare;
            audioEnvelope.high = Math.abs(Math.sin(t * 8.4));
            audioEnvelope.energy = kick * 0.50 + snare * 0.35 + audioEnvelope.high * 0.15;
            audioEnvelope.bpm = Math.round(122 + kick * 8);

            for (let i = 0; i < count; i++) {
                const hihat = Math.abs(Math.sin(t * 8.4 + i * 0.45));
                const wave = 0.5 + 0.5 * Math.sin(beat * Math.PI + i * 0.65);

                let energy;
                if (i < 3) {
                    energy = kick * 0.75 + wave * 0.25;
                } else if (i < 7) {
                    energy = snare * 0.55 + wave * 0.35 + kick * 0.10;
                } else {
                    energy = hihat * 0.50 + wave * 0.35 + kick * 0.15;
                }

                const targetScale = 0.35 + energy * 1.50;
                const speed = targetScale > currentScales[i] ? 0.40 : 0.22;
                currentScales[i] += (targetScale - currentScales[i]) * speed;

                visualizerBars[i].style.transform = `scaleY(${currentScales[i].toFixed(2)})`;
            }
        }

        visualizerRafId = requestAnimationFrame(renderAudioFrame);
    }

    visualizerRafId = requestAnimationFrame(renderAudioFrame);
}

function stopAudioVisualizer() {
    if (visualizerRafId) {
        cancelAnimationFrame(visualizerRafId);
        visualizerRafId = null;
    }
    lastVisualizerUpdateTime = 0;

    audioEnvelope.active = false;
    audioEnvelope.bass = 0;
    audioEnvelope.mid = 0;
    audioEnvelope.high = 0;
    audioEnvelope.energy = 0;
    audioEnvelope.bpm = 74;

    if (!visualizerBars || visualizerBars.length === 0) {
        visualizerBars = Array.from(document.querySelectorAll('.vocalizer-bar'));
    }

    if (visualizerBars) {
        for (let i = 0; i < visualizerBars.length; i++) {
            visualizerBars[i].style.transform = 'scaleY(0.35)';
            currentScales[i] = 0.35;
        }
    }
}

function toggleAudio() {
    const now = Date.now();
    if (now - lastAudioToggle < 180) return;
    lastAudioToggle = now;

    try {
        if (!audioElement) {
            audioElement = document.getElementById('background-audio');
        }
        if (!audioElement) return;

        const vocalizer = document.getElementById('audio-vocalizer');
        const playBtn = vocalizer ? vocalizer.querySelector('.vocalizer-play-btn') : null;

        const playSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L448 256 73 39z"/></svg>`;
        const pauseSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H144c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48H384c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H288z"/></svg>`;

        if (!audioElement.src || audioElement.src === '' || audioElement.src === window.location.href) {
            audioElement.src = 'media/hmm.opus';
        }

        if (audioPlaying) {
            audioElement.pause();
            audioPlaying = false;
            if (vocalizer) vocalizer.classList.remove('playing');
            if (playBtn) playBtn.innerHTML = playSVG;
            stopAudioVisualizer();
            try {
                localStorage.setItem('audioCurrentTime', audioElement.currentTime);
            } catch (_) {}
        } else {
            audioElement.volume = 0.3;

            try {
                const savedTime = parseFloat(localStorage.getItem('audioCurrentTime'));
                if (!isNaN(savedTime) && savedTime > 0 && audioElement.currentTime === 0) {
                    if (audioElement.readyState >= 1) {
                        audioElement.currentTime = savedTime;
                    } else {
                        audioElement.addEventListener('loadedmetadata', () => {
                            if (audioElement.currentTime < 0.5 && isFinite(audioElement.duration)) {
                                audioElement.currentTime = Math.min(savedTime, Math.max(0, audioElement.duration - 0.5));
                            }
                        }, { once: true });
                    }
                }
            } catch (_) {}

            ensureAudioAnalyser(audioElement);
            if (analyserCtx && analyserCtx.state === 'suspended') {
                analyserCtx.resume().catch(() => {});
            }

            const playPromise = audioElement.play();
            if (playPromise !== undefined && typeof playPromise.then === 'function') {
                playPromise.then(function () {
                    audioPlaying = true;
                    if (vocalizer) vocalizer.classList.add('playing');
                    if (playBtn) playBtn.innerHTML = pauseSVG;
                    startAudioVisualizer();
                }).catch(function (err) {
                    console.warn('[Audio] Playback prevented:', err);
                    audioPlaying = false;
                    if (vocalizer) vocalizer.classList.remove('playing');
                    if (playBtn) playBtn.innerHTML = playSVG;
                    stopAudioVisualizer();
                });
            } else {
                audioPlaying = true;
                if (vocalizer) vocalizer.classList.add('playing');
                if (playBtn) playBtn.innerHTML = pauseSVG;
                startAudioVisualizer();
            }
        }
    } catch (error) {
        console.warn('[Audio] Error:', error);
    }
}
window.toggleAudio = toggleAudio;

function initAudioPlayer() {
    const audio = document.getElementById('background-audio');
    const vocalizer = document.getElementById('audio-vocalizer');
    if (vocalizer) {
        vocalizer.addEventListener('click', () => toggleAudio());
    }
    if (!audio) return;

    audioElement = audio;
    audio.volume = 0.3;

    let lastSaveTime = 0;
    audio.addEventListener('timeupdate', function () {
        if (audioPlaying && Date.now() - lastSaveTime > 1000) {
            try {
                localStorage.setItem('audioCurrentTime', audio.currentTime);
                lastSaveTime = Date.now();
            } catch (_) {}
        }
    });

    const playSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L448 256 73 39z"/></svg>`;
    const pauseSVG = `<svg viewBox="0 0 448 512" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H144c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48H384c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H288z"/></svg>`;

    audio.addEventListener('play', function () {
        if (audioPlaying) return;
        audioPlaying = true;
        if (vocalizer) vocalizer.classList.add('playing');
        const playBtn = vocalizer ? vocalizer.querySelector('.vocalizer-play-btn') : null;
        if (playBtn) playBtn.innerHTML = pauseSVG;
        startAudioVisualizer();
    });

    audio.addEventListener('pause', function () {
        if (!audioPlaying) return;
        audioPlaying = false;
        if (vocalizer) vocalizer.classList.remove('playing');
        const playBtn = vocalizer ? vocalizer.querySelector('.vocalizer-play-btn') : null;
        if (playBtn) playBtn.innerHTML = playSVG;
        stopAudioVisualizer();
    });

    audio.addEventListener('error', function () {
        if (vocalizer) vocalizer.style.display = 'none';
    });
}

window.pxecore = window.pxecore || {};
window.pxecore.audio = {
    init: initAudioPlayer,
    toggle: toggleAudio,
    isPlaying: () => audioPlaying,
    resumeVisualizerIfPlaying: () => {
        if (audioPlaying && audioElement && !audioElement.paused && !visualizerRafId) {
            startAudioVisualizer();
        }
    }
};

