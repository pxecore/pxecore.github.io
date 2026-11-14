/* Interactive terminal emulator and Matrix Rain canvas effect */

function initInteractiveTerminal() {
    const term = document.getElementById('interactive-terminal');
    const termBody = document.getElementById('terminal-body');
    const historyContainer = document.getElementById('terminal-history');
    const hiddenInput = document.getElementById('terminal-hidden-input');
    const inputDisplay = document.getElementById('terminal-input-display');
    const btnRed = document.getElementById('terminal-btn-red');
    const btnYellow = document.getElementById('terminal-btn-yellow');
    const btnGreen = document.getElementById('terminal-btn-green');

    if (!term || !hiddenInput || !inputDisplay || !historyContainer) return;

    const commandHistory = [];
    let historyIndex = -1;

    term.addEventListener('click', (e) => {
        if (window.getSelection && window.getSelection().toString().length > 0) return;
        if (e.target.closest('button') || e.target.closest('a')) return;
        hiddenInput.focus();
    });

    term.classList.add('terminal-unfocused');
    const handleTermFocus = () => {
        term.classList.remove('terminal-unfocused');
    };
    const handleTermBlur = () => {
        term.classList.add('terminal-unfocused');
    };

    hiddenInput.addEventListener('focus', handleTermFocus);
    hiddenInput.addEventListener('blur', handleTermBlur);

    hiddenInput.addEventListener('input', () => {
        inputDisplay.textContent = hiddenInput.value;
    });

    const MAX_HISTORY = 50;
    const MAX_OUTPUT_NODES = 120;

    function sanitizeTerminalInput(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
            .slice(0, 256);
    }

    function appendOutput(htmlContent) {
        const out = document.createElement('div');
        out.className = 'terminal-output';
        out.innerHTML = htmlContent;
        historyContainer.appendChild(out);

        while (historyContainer.children.length > MAX_OUTPUT_NODES) {
            historyContainer.removeChild(historyContainer.firstElementChild);
        }

        if (termBody) termBody.scrollTop = termBody.scrollHeight;
    }

    function appendCommand(cmd) {
        const p = document.createElement('p');
        p.className = 'terminal-text';
        p.innerHTML = `<span class="prompt notranslate" translate="no">pxecore@system:~$</span> <span class="command notranslate" translate="no">${escapeHtml(cmd)}</span>`;
        historyContainer.appendChild(p);

        while (historyContainer.children.length > MAX_OUTPUT_NODES) {
            historyContainer.removeChild(historyContainer.firstElementChild);
        }
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function startMatrixRain() {
        const existingCanvas = term.querySelector('.terminal-matrix-canvas');
        if (existingCanvas) existingCanvas.remove();

        term.classList.add('matrix-active');
        window.__pxecoreMatrixRunning = true;

        const canvas = document.createElement('canvas');
        canvas.id = 'terminal-matrix-canvas';
        canvas.className = 'terminal-matrix-canvas';
        term.appendChild(canvas);

        const headerEl = term.querySelector('.terminal-header');
        const headerH = headerEl ? headerEl.offsetHeight : 37;
        canvas.style.top = headerH + 'px';
        canvas.style.height = `calc(100% - ${headerH}px)`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            term.classList.remove('matrix-active');
            window.__pxecoreMatrixRunning = false;
            canvas.remove();
            return;
        }

        function resolveMatrixPalette() {
            const isLightNow = document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'));
            return {
                isLight: isLightNow,
                colors: isLightNow ? {
                    bgFade: 'rgba(226, 219, 208, 0.22)',
                    initialBg: '#E2DBD0',
                    head: '#381005',
                    body: '#84321A',
                    decay: 'rgba(132, 50, 26, 0.72)',
                    tail: 'rgba(132, 50, 26, 0.35)',
                    faint: 'rgba(132, 50, 26, 0.15)',
                    badge: 'rgba(132, 50, 26, 0.85)',
                    shadow: 'transparent'
                } : {
                    bgFade: 'rgba(14, 13, 12, 0.18)',
                    initialBg: '#0E0D0C',
                    head: '#FFFDF5',
                    body: '#E8C589',
                    decay: 'rgba(216, 178, 120, 0.75)',
                    tail: 'rgba(216, 178, 120, 0.40)',
                    faint: 'rgba(216, 178, 120, 0.16)',
                    badge: 'rgba(216, 178, 120, 0.80)',
                    shadow: 'rgba(216, 178, 120, 0.9)'
                }
            };
        }

        let { isLight, colors } = resolveMatrixPalette();

        const onThemeChange = () => {
            const nextPalette = resolveMatrixPalette();
            isLight = nextPalette.isLight;
            colors = nextPalette.colors;

            if (currentW > 0 && currentH > 0 && ctx) {
                ctx.fillStyle = colors.initialBg;
                ctx.fillRect(0, 0, currentW, currentH);
            }
        };

        window.addEventListener('theme-changed', onThemeChange);

        const glyphs = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜPXECORE{}[]<>=/*+~';

        let currentW = 0;
        let currentH = 0;
        let fontSize = 13;
        let colWidth = 16;
        const streams = [];

        function syncDimensions() {
            const rect = canvas.getBoundingClientRect();
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);
            if (w <= 0 || h <= 0) return;

            fontSize = w < 480 ? 11 : 13;
            colWidth = w < 480 ? 13 : 16;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);

            ctx.fillStyle = colors.initialBg;
            ctx.fillRect(0, 0, w, h);

            currentW = w;
            currentH = h;

            const stepH = fontSize + 3;
            const maxRows = Math.max(Math.floor(h / stepH), 14);
            const colCount = Math.max(Math.floor(w / colWidth), 1);
            const offsetX = Math.floor((w % colWidth) / 2);

            while (streams.length < colCount) {
                const idx = streams.length;
                const trailLength = Math.floor(10 + Math.random() * 14);
                const startY = Math.floor(Math.random() * (maxRows + 12));
                const initialChars = [];
                for (let c = 0; c < trailLength; c++) {
                    initialChars.push(glyphs[Math.floor(Math.random() * glyphs.length)]);
                }
                streams.push({
                    x: offsetX + idx * colWidth + 4,
                    y: startY,
                    trailLength: trailLength,
                    chars: initialChars,
                    lastMove: 0,
                    moveDelay: 50 + Math.random() * 60
                });
            }

            if (streams.length > colCount) {
                streams.length = colCount;
            }

            for (let i = 0; i < streams.length; i++) {
                streams[i].x = offsetX + i * colWidth + 4;
            }
        }

        syncDimensions();

        let resizeObserver = null;
        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => syncDimensions());
            resizeObserver.observe(term);
        } else {
            window.addEventListener('resize', syncDimensions);
        }

        const MATRIX_FRAME_INTERVAL = 32; // ~31 FPS: consistent trail fade across 60Hz/120Hz/144Hz displays
        let isRunning = true;
        let animId = null;
        let lastTimestamp = performance.now();
        let lastFrameTime = 0;

        function draw(now) {
            if (!isRunning) return;

            const homeView = document.getElementById('view-home');
            if (document.hidden || (homeView && homeView.hasAttribute('hidden'))) {
                animId = null;
                return;
            }

            if (lastFrameTime !== 0 && (now - lastFrameTime) < MATRIX_FRAME_INTERVAL) {
                animId = requestAnimationFrame(draw);
                return;
            }
            lastFrameTime = now;

            const delta = Math.min(Math.max(0, now - lastTimestamp), 50);
            lastTimestamp = now;

            if (currentW > 0 && currentH > 0) {
                ctx.fillStyle = colors.bgFade;
                ctx.fillRect(0, 0, currentW, currentH);

                ctx.fillStyle = colors.badge;
                ctx.font = '10px "SF Mono", Monaco, monospace';
                ctx.fillText('[ ESC // CLICK TO EXIT ]', 14, 18);

                ctx.font = `600 ${fontSize}px "SF Mono", Monaco, monospace`;
                const stepH = fontSize + 3;

                for (let s = 0; s < streams.length; s++) {
                    const stream = streams[s];
                    stream.lastMove += delta;

                    if (stream.lastMove >= stream.moveDelay) {
                        stream.lastMove = 0;
                        stream.y++;

                        const newChar = glyphs[Math.floor(Math.random() * glyphs.length)];
                        stream.chars.unshift(newChar);

                        if (stream.chars.length > stream.trailLength) {
                            stream.chars.pop();
                        }

                        if ((stream.y - stream.trailLength) * stepH > currentH) {
                            stream.y = Math.floor(Math.random() * -10);
                            stream.trailLength = Math.floor(10 + Math.random() * 14);
                            stream.moveDelay = 50 + Math.random() * 60;
                            stream.chars = [];
                            for (let c = 0; c < 3; c++) {
                                stream.chars.push(glyphs[Math.floor(Math.random() * glyphs.length)]);
                            }
                        }
                    }

                    for (let j = 0; j < stream.chars.length; j++) {
                        const glyphY = (stream.y - j) * stepH;
                        if (glyphY < 24 || glyphY > currentH + 20) continue;

                        if (Math.random() < 0.018) {
                            stream.chars[j] = glyphs[Math.floor(Math.random() * glyphs.length)];
                        }

                        const char = stream.chars[j];

                        if (j === 0) {
                            ctx.fillStyle = colors.head;
                            if (!isLight) {
                                ctx.shadowColor = colors.shadow;
                                ctx.shadowBlur = 6;
                            } else {
                                ctx.shadowBlur = 0;
                            }
                        } else if (j < 4) {
                            ctx.fillStyle = colors.body;
                            ctx.shadowBlur = 0;
                        } else if (j < 8) {
                            ctx.fillStyle = colors.decay;
                            ctx.shadowBlur = 0;
                        } else if (j < 12) {
                            ctx.fillStyle = colors.tail;
                            ctx.shadowBlur = 0;
                        } else {
                            ctx.fillStyle = colors.faint;
                            ctx.shadowBlur = 0;
                        }

                        ctx.fillText(char, stream.x, glyphY);
                    }
                    ctx.shadowBlur = 0;
                }
            }

            animId = requestAnimationFrame(draw);
        }

        animId = requestAnimationFrame(draw);

        function resumeMatrixIfHiddenPaused() {
            if (!isRunning || animId !== null) return;
            const homeView = document.getElementById('view-home');
            if (!document.hidden && (!homeView || !homeView.hasAttribute('hidden'))) {
                lastTimestamp = performance.now();
                lastFrameTime = 0;
                animId = requestAnimationFrame(draw);
            }
        }
        document.addEventListener('visibilitychange', resumeMatrixIfHiddenPaused);
        window.addEventListener('hashchange', resumeMatrixIfHiddenPaused);

        function stopMatrix(silent = false) {
            if (!isRunning) return;
            isRunning = false;
            window.__pxecoreMatrixRunning = false;
            delete window.__pxecoreStopMatrixSilent;
            clearTimeout(autoStopTimer);

            if (animId) cancelAnimationFrame(animId);
            window.removeEventListener('theme-changed', onThemeChange);
            document.removeEventListener('visibilitychange', resumeMatrixIfHiddenPaused);
            window.removeEventListener('hashchange', resumeMatrixIfHiddenPaused);
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            } else {
                window.removeEventListener('resize', syncDimensions);
            }

            window.removeEventListener('keydown', handleKey);
            canvas.removeEventListener('click', onCanvasExit);
            canvas.removeEventListener('touchend', onCanvasExit);

            canvas.style.transition = 'opacity 0.28s ease';
            canvas.style.opacity = '0';

            setTimeout(() => {
                canvas.remove();
                term.classList.remove('matrix-active');
                if (!silent) {
                    appendOutput('Matrix stream terminated.');
                }
                if (termBody) termBody.scrollTop = termBody.scrollHeight;
                const homeView = document.getElementById('view-home');
                if (homeView && !homeView.hasAttribute('hidden')) {
                    hiddenInput.focus();
                }
            }, 280);
        }

        function onCanvasExit() {
            stopMatrix(false);
        }

        window.__pxecoreStopMatrixSilent = () => stopMatrix(true);

        function handleKey(e) {
            const homeView = document.getElementById('view-home');
            if (!homeView || homeView.hasAttribute('hidden')) return;
            if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q' || (e.key === 'c' && e.ctrlKey)) {
                stopMatrix(false);
            }
        }

        setTimeout(() => {
            if (isRunning) {
                window.addEventListener('keydown', handleKey);
                canvas.addEventListener('click', onCanvasExit);
                canvas.addEventListener('touchend', onCanvasExit, { passive: true });
            }
        }, 300);

        const autoStopTimer = setTimeout(() => {
            if (isRunning) stopMatrix(false);
        }, 30000);
    }

    const COMMANDS = {
        help: () => {
            return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight"><span class="notranslate" translate="no">pxecore</span> Shell — Core Commands:</span>
  <span class="terminal-cmd-highlight notranslate" translate="no">fastfetch</span>     System &amp; hardware info
  <span class="terminal-cmd-highlight notranslate" translate="no">whoami</span>        Identity &amp; focus
  <span class="terminal-cmd-highlight notranslate" translate="no">skills</span>        Technical capabilities
  <span class="terminal-cmd-highlight notranslate" translate="no">notes</span>         Open notes
  <span class="terminal-cmd-highlight notranslate" translate="no">github</span>        GitHub API status &amp; telemetry
  <span class="terminal-cmd-highlight notranslate" translate="no">resume</span>        Open resume
  <span class="terminal-cmd-highlight notranslate" translate="no">theme [mode]</span>  Toggle dark / light theme
  <span class="terminal-cmd-highlight notranslate" translate="no">music</span>         Toggle ambient audio
  <span class="terminal-cmd-highlight notranslate" translate="no">harmony</span>       Trigger Golden Ratio (φ) cosmic symphony
  <span class="terminal-cmd-highlight notranslate" translate="no">matrix</span>        Run digital rain
  <span class="terminal-cmd-highlight notranslate" translate="no">date</span>          Current timestamp
  <span class="terminal-cmd-highlight notranslate" translate="no">ls [dir]</span>      List directory contents
  <span class="terminal-cmd-highlight notranslate" translate="no">cat &lt;file&gt;</span>    View file
  <span class="terminal-cmd-highlight notranslate" translate="no">history</span>       View session command log
  <span class="terminal-cmd-highlight notranslate" translate="no">clear / cls</span>   Clear screen</pre>`;
        },
        fastfetch: () => {
            const currentTheme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
            const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#D8B278';
            const asciiArt = [
                '       _,met$$$$$gg.',
                '    ,g$$$$$$$$$$$$$$$P.',
                '  ,g$$P"\'\'       \'\'\'"Y$$.',
                ' ,$$P\'              `$$$.',
                '\',$$P       ,ggs.     `$$b:',
                '`d$$\'     ,$P"\'   .    $$$',
                ' $$P      d$\'     ,    $$P',
                ' $$:      $$.   -    ,d$$\'',
                ' $$;      Y$b._   _,d$P\'',
                ' Y$$.    `.`"Y$$$$P"\'',
                ' `$$b      "-.__',
                '  `Y$$',
                '   `Y$$.',
                '     `$$b.',
                '       `Y$$b.',
                '          `"Y$b._',
                '              `"""'
            ].join('\n');
            return `<div class="terminal-neofetch-grid">
<pre class="terminal-neofetch-ascii" style="color:var(--accent)">${asciiArt}</pre>
<div class="terminal-neofetch-info">
  <div><span class="info-label" style="color:var(--terminal-prompt)">pxecore</span>@<span class="info-label" style="color:var(--terminal-prompt)">system</span></div>
  <div>-------------------------</div>
  <div><span class="info-label">OS</span><span class="info-sep">:</span>Debian GNU/Linux x86_64</div>
  <div><span class="info-label">Host</span><span class="info-sep">:</span>ThinkPad T14 Gen 4</div>
  <div><span class="info-label">Packages</span><span class="info-sep">:</span>dpkg, flatpak</div>
  <div><span class="info-label">DE</span><span class="info-sep">:</span>KDE Plasma</div>
  <div><span class="info-label">WM</span><span class="info-sep">:</span>KWin (Wayland)</div>
  <div><span class="info-label">Terminal</span><span class="info-sep">:</span>konsole</div>
  <div><span class="info-label">Shell</span><span class="info-sep">:</span>bash</div>
  <div><span class="info-label">Display</span><span class="info-sep">:</span>2560x1440 @ 180Hz, 1920x1200 @ 60Hz</div>
  <div><span class="info-label">CPU</span><span class="info-sep">:</span>13th Gen Intel Core i7-1365U (12)</div>
  <div><span class="info-label">GPU</span><span class="info-sep">:</span>Intel Iris Xe Graphics</div>
  <div><span class="info-label">Memory</span><span class="info-sep">:</span>32 GiB</div>
  <div><span class="info-label">Theme</span><span class="info-sep">:</span>${currentTheme}</div>
  <div><span class="info-label">Accent</span><span class="info-sep">:</span>${accentHex}</div>
  <div style="margin-top:6px; letter-spacing:2px"><span style="color:#7f848e"></span> <span style="color:#e06c75"></span> <span style="color:#98c379"></span> <span style="color:#e5c07b"></span> <span style="color:#61afef"></span> <span style="color:#c678dd"></span> <span style="color:#56b6c2"></span> <span style="color:#abb2bf"></span></div>
</div>
</div>`;
        },
        neofetch: () => COMMANDS.fastfetch(),
        sys: () => COMMANDS.fastfetch(),
        whoami: () => {
            return `pxecore — student learning systems, SIEM, computer science, and cybersecurity.`;
        },
        about: () => COMMANDS.whoami(),
        skills: (args) => {
            const sub = (args && args[0]) ? args[0].toLowerCase() : '';
            if (sub === 're' || sub === 'reverse' || sub === 'reversing' || sub === 'reverse-engineering') {
                return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">reverse engineering</span>
  interest : binary structure, disassembly, runtime behavior
  tools    : Ghidra, GDB, objdump, strace</pre>`;
            }
            if (sub === 'osint') {
                return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">osint</span>
  interest : infrastructure mapping, certificate logs, public records
  tools    : Shodan, crt.sh, dig, whois</pre>`;
            }
            if (sub === 'opsec') {
                return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">opsec</span>
  interest : compartmentalization, metadata hygiene, privacy
  habits   : PGP verification, alias routing, isolated sessions</pre>`;
            }
            if (sub === 'cs' || sub === 'computer-science') {
                return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">computer science</span>
  interest : operating systems, networking, security engineering &amp; SIEM
  stack    : Linux, Python, bash, SQL</pre>`;
            }
            if (sub === 'research') {
                return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">research</span>
  interest : RFCs, systems &amp; security papers, post-mortems
  method   : primary sources, first-principles breakdown, technical notes</pre>`;
            }
            return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">interests:</span>
  • <span class="terminal-cmd-highlight">skills research</span> : literature, post-mortems &amp; technical notes
  • <span class="terminal-cmd-highlight">skills osint</span>    : open-source intel &amp; infrastructure mapping
  • <span class="terminal-cmd-highlight">skills opsec</span>    : privacy, hygiene &amp; compartmentalization
  • <span class="terminal-cmd-highlight">skills re</span>       : binary structure &amp; runtime behavior
  • <span class="terminal-cmd-highlight">skills cs</span>       : OS, networking, security &amp; SIEM</pre>`;
        },
        notes: () => {
            if (typeof window.switchView === 'function') window.switchView('notes', true);
            return `Switching to Notes...`;
        },
        resume: () => {
            if (typeof window.switchView === 'function') window.switchView('resume', true);
            return `Switching to Resume...`;
        },
        home: () => {
            if (typeof window.switchView === 'function') window.switchView('home', true);
            return `Switching to Home...`;
        },
        music: () => {
            const wasPlaying = Boolean(window.pxecore?.audio?.isPlaying?.());
            if (typeof window.toggleAudio === 'function') window.toggleAudio();
            return `Audio: ${wasPlaying ? 'PAUSED' : 'PLAYING ♫'}`;
        },
        audio: () => COMMANDS.music(),
        date: (args) => {
            const isUtc = args && (args.includes('-u') || args.includes('--utc') || args.includes('-R'));
            const now = new Date();
            if (isUtc) return now.toUTCString();
            try {
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Europe/Istanbul',
                    weekday: 'short',
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                const parts = formatter.formatToParts(now);
                const pMap = {};
                parts.forEach(p => { pMap[p.type] = p.value; });
                return `${pMap.weekday} ${pMap.month} ${pMap.day} ${pMap.hour}:${pMap.minute}:${pMap.second} +03 ${now.getFullYear()}`;
            } catch (_) {
                return now.toString();
            }
        },
        ls: (args) => {
            const target = (args && args[0]) ? args[0].toLowerCase() : '';
            if (target === 'notes' || target === 'notes/') {
                let noteList = [];
                try {
                    const raw = localStorage.getItem('pxecore_cached_posts_v16');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            noteList = parsed.map(p => p.slug ? `${p.slug}.md` : null).filter(Boolean);
                        }
                    }
                } catch (_) {}
                if (noteList.length === 0) {
                    return `No notes synced yet. Open <span class="terminal-cmd-highlight notranslate" translate="no">notes</span> to sync.`;
                }
                return noteList.map(n => `<span class="terminal-cmd-highlight">${escapeHtml(n)}</span>`).join('   ');
            }
            if (target === 'media' || target === 'media/') {
                return `<span class="terminal-cmd-highlight">avatar.webp</span>   <span class="terminal-cmd-highlight">banner.webp</span>   <span class="terminal-cmd-highlight">bg_dark.webp</span>   <span class="terminal-cmd-highlight">bg_light.webp</span>   <span class="terminal-cmd-highlight">hmm.opus</span>   <span class="terminal-cmd-highlight">og.webp</span>`;
            }
            return `<span class="terminal-cmd-highlight">ident.txt</span>   <span class="terminal-cmd-highlight">notice.txt</span>   <span class="terminal-cmd-highlight">notes/</span>   <span class="terminal-cmd-highlight">media/</span>`;
        },
        clear: () => {
            historyContainer.innerHTML = '';
            return null;
        },
        cls: () => COMMANDS.clear(),
        theme: (args) => {
            const mode = args && args[0] ? args[0].toLowerCase() : '';
            if (mode === 'light' || mode === 'dark') {
                if (typeof window.applyTheme === 'function') window.applyTheme(mode);
                return `Theme switched to ${mode}.`;
            }
            const current = document.documentElement.classList.contains('light') ? 'light' : 'dark';
            const next = current === 'light' ? 'dark' : 'light';
            if (typeof window.applyTheme === 'function') window.applyTheme(next);
            return `Theme toggled to ${next}.`;
        },
        cat: (args) => {
            let target = args && args[0] ? args[0].trim().toLowerCase() : '';
            if (!target) return `Usage: cat &lt;filename&gt; (e.g. cat ident.txt)`;

            target = target.replace(/^\.\//, '').replace(/^~\//, '').replace(/^\/home\/pxecore\//, '');

            if (target === 'notes' || target === 'notes/' || target === 'media' || target === 'media/') {
                return `cat: ${escapeHtml(target)}: Is a directory`;
            }

            const files = {
                'ident.txt': () => `Cryptographic identity verification signature available at: <a href="https://pxecore.github.io/ident.txt" target="_blank" rel="noopener noreferrer" class="terminal-link">ident.txt</a>`,
                'notice.txt': () => `Type <span class="terminal-cmd-highlight notranslate" translate="no">help</span> for commands, or view <a href="ident.txt" target="_blank" rel="noopener noreferrer" class="terminal-link notranslate" translate="no">ident.txt</a>.`
            };
            if (Object.prototype.hasOwnProperty.call(files, target)) {
                return typeof files[target] === 'function' ? files[target]() : files[target];
            }
            return `cat: ${escapeHtml(target)}: No such file or directory`;
        },
        matrix: () => {
            startMatrixRain();
            return `Executing Matrix digital stream... (Click or press any key to exit)`;
        },
        harmony: () => {
            if (typeof window.__triggerHarmonicOrder === 'function') {
                window.__triggerHarmonicOrder(5200);
            }
            if (typeof window.__triggerTitleCrystallize === 'function') {
                window.__triggerTitleCrystallize();
            }
            if (window.SoundSymphony && typeof window.SoundSymphony.playHarmonicChord === 'function') {
                window.SoundSymphony.playHarmonicChord([0, 2, 3, 5, 7]);
            }
            const isLight = document.documentElement.classList.contains('light') || (document.body && document.body.classList.contains('light-theme'));
            const titleLabel = isLight ? '[phyllotaxis harmonic resonance]' : '[cosmic harmonic resonance]';
            return `<pre class="terminal-output-pre"><span class="terminal-cmd-highlight">${titleLabel}</span>
  φ (golden ratio) : 1.618033988749895
  θ_golden         : 137.50776405003785° (2.39996323 rad)
  tuning           : Pythagorean Pentatonic [1, 9/8, 5/4, 3/2, 5/3, 2]</pre>`;
        },
        symphony: () => COMMANDS.harmony(),
        history: () => {
            if (commandHistory.length === 0) return `History is empty.`;
            return `<pre class="terminal-output-pre">${commandHistory.map((cmd, idx) => `  ${String(idx + 1).padStart(3, ' ')}  ${escapeHtml(cmd)}`).join('\n')}</pre>`;
        },
        github: (args) => {
            const sub = (args && args[0]) ? args[0].toLowerCase() : 'status';
            if (sub === 'status') {
                let meta = null;
                let token = null;
                try {
                    const rawMeta = localStorage.getItem('pxecore_ratelimit_meta_v1');
                    if (rawMeta) meta = JSON.parse(rawMeta);
                    token = sessionStorage.getItem('pxecore_github_token');
                } catch (_) {}
                const isAuth = Boolean(token && token.trim());
                const authMode = isAuth ? 'token (5,000/hr)' : 'public (60/hr)';
                const quotaLimit = meta && typeof meta.limit === 'number' ? meta.limit : (isAuth ? 5000 : 60);
                const quotaRem = meta && typeof meta.remaining === 'number' ? meta.remaining : quotaLimit;
                let resetStr = '-';
                if (meta && meta.resetTime) {
                    const secLeft = Math.max(0, Math.round((meta.resetTime - Date.now()) / 1000));
                    resetStr = `${Math.floor(secLeft / 60)}m ${secLeft % 60}s`;
                }
                let etag = 'none';
                try { etag = localStorage.getItem('pxecore_git_tree_etag_v6') || 'none'; } catch (_) {}
                const cleanEtag = etag.length > 28 ? etag.slice(0, 28) + '...' : etag;
                return `<pre class="terminal-output-pre">[github] pxecore/notes (main)
api       : 2026-03-10 (${authMode})
quota     : ${quotaRem}/${quotaLimit} (reset: ${resetStr})
tree etag : ${escapeHtml(cleanEtag)} [RFC 7232 / 304 cached]</pre>`;
            }
            if (sub === 'token') {
                const tokenVal = args[1] ? args[1].trim() : '';
                if (!tokenVal || tokenVal === 'clear' || tokenVal === 'remove') {
                    try {
                        sessionStorage.removeItem('pxecore_github_token');
                        localStorage.removeItem('pxecore_github_token');
                        localStorage.removeItem('pxecore_ratelimit_meta_v1');
                        localStorage.removeItem('pxecore_ratelimit_reset_v6');
                    } catch (_) {}
                    return `token cleared. reverted to public quota (60 req/hr).`;
                }
                if (tokenVal.startsWith('ghp_') || tokenVal.startsWith('github_pat_')) {
                    try {
                        sessionStorage.setItem('pxecore_github_token', tokenVal);
                        localStorage.removeItem('pxecore_github_token');
                        localStorage.removeItem('pxecore_ratelimit_meta_v1');
                        localStorage.removeItem('pxecore_ratelimit_reset_v6');
                    } catch (_) {}
                    return `session token saved (5,000 req/hr, cleared on tab close). run 'github sync' to test.`;
                }
                return `usage: github token &lt;ghp_... | github_pat_...&gt; or github token clear`;
            }
            if (sub === 'sync') {
                if (window.__pxecoreNotesSync) {
                    window.__pxecoreNotesSync(true).catch(() => {});
                    return `triggered tree sync.`;
                }
                return `sync engine not ready.`;
            }
            return `<pre class="terminal-output-pre">usage: github &lt;status|sync|token&gt;
  github status         inspect rate limit quota and tree etag
  github sync           trigger manual tree sync
  github token &lt;pat&gt;    save personal access token (5,000 req/hr)
  github token clear    remove token and revert to public quota</pre>`;
        },
        api: (args) => COMMANDS.github(args)
    };

    function executeCommand(rawInput) {
        const sanitized = sanitizeTerminalInput(rawInput);
        const trimmed = sanitized.trim();
        appendCommand(trimmed);

        if (!trimmed) {
            if (termBody) termBody.scrollTop = termBody.scrollHeight;
            return;
        }

        if (commandHistory.length >= MAX_HISTORY) {
            commandHistory.shift();
        }
        commandHistory.push(trimmed);
        historyIndex = commandHistory.length;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (Object.prototype.hasOwnProperty.call(COMMANDS, cmd) && typeof COMMANDS[cmd] === 'function') {
            const out = COMMANDS[cmd](args);
            if (out) appendOutput(out);
        } else {
            appendOutput(`bash: ${escapeHtml(cmd)}: command not found. Type <span class="terminal-cmd-highlight">help</span> for commands.`);
        }
    }

    hiddenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = hiddenInput.value;
            hiddenInput.value = '';
            inputDisplay.textContent = '';
            executeCommand(val);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0 && historyIndex > 0) {
                historyIndex--;
                hiddenInput.value = commandHistory[historyIndex];
                inputDisplay.textContent = hiddenInput.value;
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
                historyIndex++;
                hiddenInput.value = commandHistory[historyIndex];
                inputDisplay.textContent = hiddenInput.value;
            } else {
                historyIndex = commandHistory.length;
                hiddenInput.value = '';
                inputDisplay.textContent = '';
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const current = sanitizeTerminalInput(hiddenInput.value).trim().toLowerCase();
            if (!current) return;
            const available = Object.keys(COMMANDS).concat([
                'cat ident.txt', 'cat notice.txt',
                'skills re', 'skills osint', 'skills opsec', 'skills cs', 'skills research',
                'github status', 'github sync', 'github token',
                'ls notes', 'ls media',
                'theme light', 'theme dark'
            ]);
            const matches = available.filter(c => c.startsWith(current));
            if (matches.length === 1) {
                hiddenInput.value = matches[0];
                inputDisplay.textContent = matches[0];
            } else if (matches.length > 1) {
                appendCommand(hiddenInput.value);
                appendOutput(escapeHtml(matches.join('   ')));
            }
        }
    });

    function dismissMatrix() {
        if (typeof window.__pxecoreStopMatrixSilent === 'function') {
            window.__pxecoreStopMatrixSilent();
            return;
        }
        const activeCanvas = term.querySelector('.terminal-matrix-canvas');
        if (activeCanvas) {
            activeCanvas.click();
        }
    }

    if (btnRed) {
        btnRed.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissMatrix();
            COMMANDS.clear();
            btnRed.blur();
        });
    }
    if (btnYellow) {
        btnYellow.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissMatrix();
            appendCommand('help');
            appendOutput(COMMANDS.help());
            btnYellow.blur();
        });
    }
    if (btnGreen) {
        btnGreen.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissMatrix();
            appendCommand('fastfetch');
            appendOutput(COMMANDS.fastfetch());
            btnGreen.blur();
        });
    }

    window.pxecore = window.pxecore || {};
    window.pxecore.term = {
        runCommand: executeCommand,
        isMatrixRunning: () => Boolean(window.__pxecoreMatrixRunning)
    };
    window.__pxecoreRunCommand = executeCommand;

    const techStack = document.querySelector('.tech-stack');
    if (techStack) {
        techStack.addEventListener('click', (e) => {
            const btn = e.target.closest('.tech-item');
            if (!btn) return;
            const cmd = btn.getAttribute('data-cmd');
            if (cmd) {
                dismissMatrix();
                executeCommand(cmd);
                btn.blur();

                if (window.innerWidth < 768 && term) {
                    term.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        });
    }
}

window.pxecore = window.pxecore || {};
window.pxecore._initTerminal = initInteractiveTerminal;

