// sanitizers & markdown rendering for notes
window.pxecore = window.pxecore || {};
window.pxecore.notesMarkdown = (function () {
    const reposOwner = 'pxecore';
    const reposName = 'notes';
    const postsFolder = 'posts';

    function escapeHTML(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeURL(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        const compact = trimmed.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
        if (/^(?:javascript|data|vbscript):/i.test(compact)) {
            return '#';
        }
        if (/^(?:https?:|\/|#|mailto:)/i.test(trimmed)) {
            return trimmed.replace(/"/g, '%22').replace(/'/g, '%27').replace(/</g, '%3C').replace(/>/g, '%3E');
        }
        if (/^[a-zA-Z0-9_\-\.\/]+(?:\?[a-zA-Z0-9_\-=&%\.\/]*)?(?:#[a-zA-Z0-9_\-]*)?$/.test(trimmed)) {
            return trimmed;
        }
        return '#';
    }

    function sanitizeRawHTML(content) {
        if (!content || typeof content !== 'string') return '';
        return content
            .replace(/<script\b[^<]*(?:(?!<\/script\s*>)<[^<]*)*<\/script\s*>/gim, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe\s*>)<[^<]*)*<\/iframe\s*>/gim, '')
            .replace(/<object\b[^<]*(?:(?!<\/object\s*>)<[^<]*)*<\/object\s*>/gim, '')
            .replace(/<form\b[^<]*(?:(?!<\/form\s*>)<[^<]*)*<\/form\s*>/gim, '')
            .replace(/<style\b[^<]*(?:(?!<\/style\s*>)<[^<]*)*<\/style\s*>/gim, '')
            .replace(/<svg\b[^<]*(?:(?!<\/svg\s*>)<[^<]*)*<\/svg\s*>/gim, '')
            .replace(/<math\b[^<]*(?:(?!<\/math\s*>)<[^<]*)*<\/math\s*>/gim, '')
            .replace(/<\/?(?:script|iframe|object|embed|form|style|svg|math|meta|link|base)\b[^>]*>/gim, '')
            .replace(/[\s\/]on[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gim, '');
    }

    const ALLOWED_HTML_TAGS = new Set([
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'P', 'BR', 'HR', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
        'PRE', 'CODE', 'SPAN', 'DIV',
        'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'U', 'MARK', 'KBD', 'SUB', 'SUP',
        'A', 'IMG',
        'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
        'DETAILS', 'SUMMARY', 'FIGURE', 'FIGCAPTION'
    ]);
    const STRIP_WITH_CONTENT_TAGS = new Set([
        'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM',
        'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'MATH',
        'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'BASE', 'TITLE'
    ]);
    const ALLOWED_HTML_ATTRS = new Set([
        'id', 'class', 'href', 'target', 'rel',
        'src', 'alt', 'title', 'loading', 'decoding', 'referrerpolicy',
        'width', 'height', 'align', 'colspan', 'rowspan', 'open',
        'data-math', 'data-display'
    ]);

    function sanitizeRenderedHTML(html, folder = '', options = {}) {
        if (!html || typeof DOMParser === 'undefined') return html;
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const cleanNode = (node) => {
                const children = Array.from(node.childNodes);
                for (const child of children) {
                    if (child.nodeType === 8) {
                        node.removeChild(child);
                        continue;
                    }
                    if (child.nodeType !== 1) continue;
                    const tag = child.tagName.toUpperCase();
                    if (STRIP_WITH_CONTENT_TAGS.has(tag)) {
                        node.removeChild(child);
                        continue;
                    }
                    cleanNode(child);
                    if (!ALLOWED_HTML_TAGS.has(tag)) {
                        while (child.firstChild) {
                            node.insertBefore(child.firstChild, child);
                        }
                        node.removeChild(child);
                        continue;
                    }
                    for (const attr of Array.from(child.attributes)) {
                        const name = attr.name.toLowerCase();
                        if (name.startsWith('on') || !ALLOWED_HTML_ATTRS.has(name)) {
                            child.removeAttribute(attr.name);
                            continue;
                        }
                        if (name === 'id') {
                            if (!/^(?:note-|heading-|fn-|user-content-|sec-)[a-zA-Z0-9_-]+$/.test(attr.value.trim())) {
                                child.removeAttribute(attr.name);
                            }
                            continue;
                        }
                        if (name === 'href') {
                            child.setAttribute(name, sanitizeURL(attr.value));
                        } else if (name === 'src') {
                            const resolved = (tag === 'IMG' && !(options && options.preserveRelativeSrc)) ? resolveRawImagePath(attr.value, folder) : attr.value;
                            child.setAttribute(name, sanitizeURL(resolved));
                        }
                    }
                    if (tag === 'IMG') {
                        // Konqueror / QtWebEngine skips lazy images inside dynamically toggled containers
                        if (child.getAttribute('loading') === 'lazy') {
                            child.removeAttribute('loading');
                        }
                        if (!child.getAttribute('decoding')) {
                            child.setAttribute('decoding', 'async');
                        }
                        if (!child.getAttribute('referrerpolicy')) {
                            child.setAttribute('referrerpolicy', 'no-referrer');
                        }
                    }
                    if (tag === 'A' && child.getAttribute('target') === '_blank') {
                        child.setAttribute('rel', 'noopener noreferrer');
                    }
                }
            };
            cleanNode(doc.body);
            return doc.body.innerHTML;
        } catch (_) {
            return sanitizeRawHTML(html);
        }
    }

    // smooth curve helper
    function catmullRomToBezier(points) {
        if (!points || points.length < 2) return '';
        let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = i > 0 ? points[i - 1] : points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = i + 2 < points.length ? points[i + 2] : p2;

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        return d;
    }

    // sparkline generator
    function generateDynamicSparkline(values, width = 100, height = 30, type = 'spline') {
        if (!values || values.length === 0) {
            return {
                strokePath: `M 0 ${height / 2} L ${width} ${height / 2}`,
                areaPath: '',
                endpoint: { x: width, y: height / 2 }
            };
        }

        let pts = [];
        const padX = 4;
        const padY = 5;
        const usableW = width - padX * 2;
        const usableH = height - padY * 2;

        if (type === 'cdf') {
            // Cumulative curve
            const sorted = [...values].sort((a, b) => a - b);
            let cumSum = 0;
            const cumValues = [0];
            sorted.forEach(v => {
                cumSum += v;
                cumValues.push(cumSum);
            });
            const max = Math.max(cumSum, 1);
            pts = cumValues.map((val, idx) => ({
                x: padX + (idx / (cumValues.length - 1)) * usableW,
                y: height - padY - (val / max) * usableH
            }));
        } else if (type === 'gaussian') {
            // Smoothed sliding-window distribution curve over values
            if (values.length === 1) {
                pts = [
                    { x: padX, y: height / 2 },
                    { x: width - padX, y: height / 2 }
                ];
            } else {
                const smoothed = values.map((_, i) => {
                    let num = 0;
                    let den = 0;
                    for (let j = 0; j < values.length; j++) {
                        const w = Math.exp(-0.5 * Math.pow((i - j) / 1.1, 2));
                        num += values[j] * w;
                        den += w;
                    }
                    return num / (den || 1);
                });
                const max = Math.max(...smoothed, 1);
                const min = Math.min(...smoothed, 0);
                const range = max - min || 1;
                pts = smoothed.map((val, idx) => ({
                    x: padX + (idx / (smoothed.length - 1)) * usableW,
                    y: height - padY - ((val - min) / range) * usableH
                }));
            }
        } else {
            // Standard smooth spline over values
            if (values.length === 1) {
                pts = [
                    { x: padX, y: height / 2 },
                    { x: width - padX, y: height / 2 }
                ];
            } else {
                const max = Math.max(...values, 1);
                const min = Math.min(...values, 0);
                const range = max - min || 1;
                pts = values.map((val, idx) => ({
                    x: padX + (idx / (values.length - 1)) * usableW,
                    y: height - padY - ((val - min) / range) * usableH
                }));
            }
        }

        const strokePath = catmullRomToBezier(pts);
        const first = pts[0];
        const last = pts[pts.length - 1];
        const areaPath = `${strokePath} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;

        return {
            strokePath,
            areaPath,
            endpoint: last
        };
    }

    // Date formatter
    function formatFriendlyDate(dateStr) {
        if (!dateStr) return '';
        try {
            const match = String(dateStr).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (match) {
                const year = match[1];
                const monthNum = parseInt(match[2], 10);
                const day = parseInt(match[3], 10);
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                if (monthNum >= 1 && monthNum <= 12 && day >= 1 && day <= 31) {
                    return `${months[monthNum - 1]} ${day}, ${year}`;
                }
            }
            return escapeHTML(String(dateStr));
        } catch {
            return escapeHTML(String(dateStr));
        }
    }

    // Topic icon dictionary for research cards
    const TOPIC_ICONS = {
        ebpf: 'fa-bolt-lightning',
        xdp: 'fa-bolt-lightning',
        bpf: 'fa-bolt-lightning',
        exploit: 'fa-crosshairs',
        pwn: 'fa-crosshairs',
        malware: 'fa-biohazard',
        rootkit: 'fa-biohazard',
        kernel: 'fa-microchip',
        memory: 'fa-memory',
        uaf: 'fa-memory',
        reversing: 'fa-code-compare',
        'reverse-engineering': 'fa-code-compare',
        binary: 'fa-layer-group',
        crypto: 'fa-key',
        cryptography: 'fa-key',
        auth: 'fa-fingerprint',
        network: 'fa-network-wired',
        networking: 'fa-network-wired',
        security: 'fa-shield-halved',
        cyber: 'fa-shield-halved',
        defense: 'fa-shield-halved',
        ctf: 'fa-flag',
        ai: 'fa-brain',
        ml: 'fa-brain',
        machinelearning: 'fa-brain',
        algorithm: 'fa-diagram-project',
        algorithms: 'fa-diagram-project',
        math: 'fa-infinity',
        mathematics: 'fa-infinity',
        database: 'fa-database',
        cloud: 'fa-cubes-stacked',
        compiler: 'fa-code-fork',
        code: 'fa-code',
        terminal: 'fa-terminal',
        book: 'fa-book-bookmark',
        forensics: 'fa-microscope',
        hardware: 'fa-server'
    };

    // Resolve topic icon from metadata tags, title, or category
    function detectLogoType(post) {
        const meta = post.meta || {};

        // Explicit user icon from frontmatter takes highest precedence (whitelist FA classes)
        if (meta.icon || meta.logo) {
            const rawIcon = String(meta.icon || meta.logo).trim();
            if (rawIcon.startsWith('<i') && rawIcon.endsWith('>')) {
                const clsMatch = rawIcon.match(/class=["']([^"']+)["']/i);
                const safeCls = clsMatch
                    ? clsMatch[1].split(/\s+/).filter(c => /^(?:fa[brs]?|fa-[a-z0-9-]+)$/i.test(c)).join(' ')
                    : '';
                if (safeCls) return `<i class="${escapeHTML(safeCls)}" aria-hidden="true"></i>`;
            }
            let style = 'fa-solid';
            if (/\b(?:fa-brands|fab)\b/i.test(rawIcon)) style = 'fa-brands';
            else if (/\b(?:fa-regular|far)\b/i.test(rawIcon)) style = 'fa-regular';

            let faName = rawIcon.replace(/^(?:fa-[a-z0-9-]+:)?(?:fa-solid\s+|fa-regular\s+|fa-brands\s+|fab\s+|far\s+|fas\s+|fa-\s+|fa\s+)/i, '').trim();
            faName = faName.replace(/[^a-z0-9-]/gi, '');
            if (faName && faName !== 'fa-') {
                if (!faName.startsWith('fa-')) faName = `fa-${faName}`;
                return `<i class="${style} ${escapeHTML(faName)}" aria-hidden="true"></i>`;
            }
        }

        const rawTags = Array.isArray(meta.tags) ? meta.tags : [];
        const tags = rawTags.map(t => String(t).toLowerCase().trim()).filter(Boolean);
        const category = String(meta.category || '').toLowerCase().trim();

        // 1. Direct tag match
        for (const t of tags) {
            if (TOPIC_ICONS[t]) {
                return `<i class="fa-solid ${TOPIC_ICONS[t]}" aria-hidden="true"></i>`;
            }
        }

        // 2. Direct category match
        if (TOPIC_ICONS[category]) {
            return `<i class="fa-solid ${TOPIC_ICONS[category]}" aria-hidden="true"></i>`;
        }

        // 3. Fallback: clean default terminal icon
        return '<i class="fa-solid fa-terminal" aria-hidden="true"></i>';
    }

    function isValidMetaBlock(rawMeta) {
        const validKeys = ["title", "date", "description", "desc", "summary", "author", "signer", "tags", "topics", "category", "cat", "image", "cover", "thumbnail", "readtime", "read_time", "read-time", "icon", "logo"];
        const lines = String(rawMeta || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const hasValidKeys = lines.some(line => {
            const k = line.split(":")[0].trim().toLowerCase();
            return validKeys.includes(k);
        });
        // Reject if the "meta" block looks like markdown body (headings, fences, blockquotes)
        const hasMarkdownNoise = lines.some(line => line.startsWith("#") || line.startsWith("```") || line.startsWith("~~~") || line.startsWith(">"));
        return hasValidKeys && !hasMarkdownNoise;
    }

    function stripTrailingWrapperCloser(tail, wrapperChar, wrapperLen) {
        const lines = String(tail || '').split(/\r?\n/);
        let inInner = false;
        let innerChar = '';
        let innerLen = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (inInner) {
                const closeMatch = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
                if (closeMatch && closeMatch[1][0] === innerChar && closeMatch[1].length >= innerLen) {
                    inInner = false;
                }
                continue;
            }
            const openInfoMatch = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*(\S.*)$/);
            if (openInfoMatch) {
                inInner = true;
                innerChar = openInfoMatch[1][0];
                innerLen = openInfoMatch[1].length;
                continue;
            }
            const bareFenceMatch = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
            if (bareFenceMatch) {
                const restBlank = lines.slice(i + 1).every(l => !l.trim());
                if (restBlank && bareFenceMatch[1][0] === wrapperChar && bareFenceMatch[1].length >= wrapperLen) {
                    lines.splice(i, 1);
                    break;
                }
                inInner = true;
                innerChar = bareFenceMatch[1][0];
                innerLen = bareFenceMatch[1].length;
            }
        }
        return lines.join('\n');
    }

    // YAML Frontmatter: prefer top-of-file frontmatter; if absent, unwrap outer ```markdown wrapper blocks.
    function extractFrontmatter(text) {
        if (!text || typeof text !== 'string') return { rawMeta: '', body: '' };

        // Strip BOM and leading blank lines before top-of-file frontmatter
        const trimmedStart = text.replace(/^\uFEFF/, '').replace(/^(?:[ \t]*\r?\n)+/, '');
        const startMatch = trimmedStart.match(/^---[ \t]*\r?\n/);
        if (startMatch) {
            const afterOpen = startMatch[0].length;
            const rest = trimmedStart.slice(afterOpen);
            const closeMatch = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
            if (closeMatch) {
                const rawMeta = rest.slice(0, closeMatch.index);
                if (isValidMetaBlock(rawMeta)) {
                    const body = rest.slice(closeMatch.index + closeMatch[0].length);
                    return { rawMeta, body: body.trim() };
                }
            }
        }

        // Unwrap outer ```markdown / ```md fence containing frontmatter (e.g., drafted note templates)
        const wrapperRe = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/m;
        const wrapperMatch = trimmedStart.match(wrapperRe);
        if (wrapperMatch && isValidMetaBlock(wrapperMatch[2])) {
            const wChar = wrapperMatch[1][0];
            const wLen = wrapperMatch[1].length;
            const prefix = trimmedStart.slice(0, wrapperMatch.index).trimEnd();
            const rawSuffix = trimmedStart.slice(wrapperMatch.index + wrapperMatch[0].length);
            const suffix = stripTrailingWrapperCloser(rawSuffix, wChar, wLen).trimStart();
            const combined = [prefix, suffix].filter(Boolean).join('\n\n').trim();
            return { rawMeta: wrapperMatch[2], body: combined };
        }

        return { rawMeta: '', body: text.trim() };
    }

    function stripFencedBlocks(text) {
        const lines = String(text || '').split(/\r?\n/);
        const out = [];
        let fence = null;
        let isMdWrapper = false;
        let nestedDepth = 0;
        for (const line of lines) {
            const m = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
            if (m) {
                const tok = m[1];
                const info = m[2].trim();
                if (fence === null) {
                    fence = tok[0].repeat(tok.length);
                    const lang = (info.split(/\s+/)[0] || '').toLowerCase();
                    isMdWrapper = (lang === 'markdown' || lang === 'md');
                    nestedDepth = 0;
                    continue;
                }
                if (isMdWrapper && info) {
                    nestedDepth++;
                    continue;
                }
                if (!info) {
                    if (isMdWrapper && nestedDepth > 0) {
                        nestedDepth--;
                        continue;
                    }
                    if (tok[0] === fence[0] && tok.length >= fence.length) {
                        fence = null;
                        isMdWrapper = false;
                        nestedDepth = 0;
                        continue;
                    }
                }
            }
            if (fence === null) out.push(line);
        }
        return out.join('\n');
    }

    function removeFirstTopLevelH1(text, metaTitle = '') {
        const lines = String(text || '').split(/\r?\n/);
        const out = [];
        let inFence = false;
        let fenceChar = '';
        let fenceLen = 0;
        let removed = false;
        let seenContentBefore = false;
        const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const normMetaTitle = norm(metaTitle);

        for (const line of lines) {
            const mFence = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
            if (mFence) {
                const ch = mFence[1][0];
                const ln = mFence[1].length;
                const tail = mFence[2];
                if (!inFence) {
                    inFence = true;
                    fenceChar = ch;
                    fenceLen = ln;
                    seenContentBefore = true;
                } else if (ch === fenceChar && ln >= fenceLen && !tail.trim()) {
                    inFence = false;
                }
            } else if (!inFence && !removed && /^#[ \t]+[^\r\n]+$/.test(line)) {
                const h1Text = line.replace(/^#[ \t]+/, '').trim();
                if (!seenContentBefore || (normMetaTitle && norm(h1Text) === normMetaTitle)) {
                    removed = true;
                    continue;
                }
                seenContentBefore = true;
            } else if (!inFence && line.trim()) {
                seenContentBefore = true;
            }
            out.push(line);
        }
        return out.join('\n').trim();
    }

    function extractAndStripExcerpt(text, existingDesc = '') {
        const lines = String(text || '').split(/\r?\n/);
        let inFence = false;
        let fenceChar = '';
        let fenceLen = 0;
        let quoteIdx = -1;
        let quoteVal = null;
        let caretIdx = -1;
        let caretVal = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const mFence = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
            if (mFence) {
                const ch = mFence[1][0];
                const ln = mFence[1].length;
                if (!inFence) {
                    inFence = true;
                    fenceChar = ch;
                    fenceLen = ln;
                } else if (ch === fenceChar && ln >= fenceLen && !mFence[2].trim()) {
                    inFence = false;
                }
                continue;
            }
            if (inFence) continue;

            if (quoteIdx === -1) {
                const qm = line.match(/^[ \t]*["“]([^"”\r\n]{2,800})["”][ \t]*$/);
                if (qm) {
                    quoteIdx = i;
                    quoteVal = qm[1].trim();
                }
            }
            if (caretIdx === -1) {
                const cm = line.match(/^[ \t]*\^([^\^\r\n]{2,800})\^[ \t]*$/);
                if (cm) {
                    caretIdx = i;
                    caretVal = cm[1].trim();
                }
            }
        }

        const matchedIdx = quoteIdx !== -1 ? quoteIdx : caretIdx;
        const matchedVal = quoteIdx !== -1 ? quoteVal : caretVal;
        if (matchedIdx === -1 || !matchedVal) {
            return { excerpt: null, body: text };
        }

        const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const shouldStrip = !existingDesc || (norm(matchedVal) === norm(existingDesc));
        if (shouldStrip) {
            lines.splice(matchedIdx, 1);
        }
        return {
            excerpt: !existingDesc ? matchedVal : null,
            body: lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
        };
    }

    // Helper: Markdown Frontmatter & Metadata Parser
    function parseMarkdown(raw, filename = '', folder = '') {
        const targetRaw = raw || '';
        const { rawMeta, body: extractedBody } = extractFrontmatter(targetRaw);
        let body = extractedBody || targetRaw;

        const plainBodyForTitle = stripFencedBlocks(body || targetRaw || '');
        const titleMatch = plainBodyForTitle.match(/^#[ \t]+([^\r\n]+)/m);
        const inferredTitle = titleMatch
            ? titleMatch[1].trim()
            : (filename ? filename.replace(/\.md$/i, '').split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : "Test Note");

        const meta = {
            title: '',
            date: '',
            description: '',
            author: 'pxecore',
            tags: [],
            readTime: '',
            category: ''
        };

        if (rawMeta) {
            let currentListKey = null;
            rawMeta.split(/\r?\n/).forEach(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return;

                // Support multi-line YAML lists (e.g. "  - security")
                if (trimmedLine.startsWith('- ') && currentListKey) {
                    const item = trimmedLine.slice(2).trim().replace(/^["']|["']$/g, '').toLowerCase();
                    if (item && (currentListKey === 'tags' || currentListKey === 'topics')) {
                        meta.tags.push(item);
                    }
                    return;
                }

                const colonIndex = line.indexOf(":");
                if (colonIndex < 1) {
                    currentListKey = null;
                    return;
                }
                const key = line.slice(0, colonIndex).trim().toLowerCase();
                let val = line.slice(colonIndex + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }

                currentListKey = (key === 'tags' || key === 'topics') ? 'tags' : null;

                if (key === "title") meta.title = val;
                else if (key === "date") meta.date = val;
                else if (key === "description" || key === "desc" || key === "summary") meta.description = val;
                else if (key === "author" || key === "signer") meta.author = val;
                else if (key === "readtime" || key === "read_time" || key === "read-time") meta.readTime = val;
                else if (key === "category" || key === "cat") meta.category = val;
                else if (key === "image" || key === "cover" || key === "thumbnail") meta.image = val;
                else if (key === "icon" || key === "logo") meta.icon = val;
                else if (key === "tags" || key === "topics") {
                    if (val) {
                        const parsed = val.replace(/[\[\]]/g, "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
                        meta.tags.push(...parsed);
                    }
                }
            });
            meta.tags = Array.from(new Set(meta.tags));
        }

        const excerptRes = extractAndStripExcerpt(body, meta.description);
        const extractedExcerpt = excerptRes.excerpt;
        body = excerptRes.body;

        const lines = body.split(/\r?\n/);
        const bottomTags = [];
        let i = lines.length - 1;
        while (i >= 0 && (lines[i].trim() === '' || /^[.\$,;_\-*~]+$/.test(lines[i].trim()))) {
            lines.pop();
            i--;
        }
        while (i >= 0) {
            const trimmed = lines[i].trim();
            if (/^[ \t]*(?:(?:Tags|Topics|Keywords):?[ \t]*)?(?:#[a-zA-Z0-9_\-/]+(?:\.[a-zA-Z0-9_\-/]+)*[ \t,;\.]*)+$/i.test(trimmed)) {
                const foundTags = trimmed.match(/#([a-zA-Z0-9_\-]+)/g);
                if (foundTags) {
                    const lineTags = [];
                    foundTags.forEach(t => {
                        const tagWord = t.slice(1).trim().toLowerCase();
                        if (tagWord && /[a-zA-Z]/.test(tagWord) && !lineTags.includes(tagWord)) {
                            lineTags.push(tagWord);
                        }
                    });
                    bottomTags.unshift(...lineTags);
                }
                lines.pop();
                i--;
            } else {
                break;
            }
        }
        while (lines.length > 0 && (lines[lines.length - 1].trim() === '' || /^[.\$,;_\-*~]+$/.test(lines[lines.length - 1].trim()))) {
            lines.pop();
        }
        body = removeFirstTopLevelH1(lines.join('\n').trim(), meta.title || inferredTitle);

        // Extract inline #tags only from prose outside code blocks / inline code / hex colors
        const proseOnly = stripFencedBlocks(body)
            .replace(/`[^`\r\n]+`/g, ' ');
        const inlineMatches = proseOnly.match(/(?:^|\s)#([a-zA-Z][a-zA-Z0-9_\-]{1,29})(?=\s|$|[.,;!?])/g) || [];
        const inlineTags = inlineMatches.map(h => h.trim().slice(1).toLowerCase());

        const noiseKeywords = new Set([
            'include','define','pragma','import','ifdef','ifndef','endif','else','error','undef',
            'function','class','const','let','var','return','void','public','private','protected',
            'null','undefined','true','false','struct','int','char','float','double','bool','all'
        ]);

        const combinedTags = Array.from(new Set([...(meta.tags || []), ...bottomTags, ...inlineTags]))
            .filter(t => t.length > 1 && /[a-zA-Z]/.test(t) && !noiseKeywords.has(t));

        meta.title = meta.title || inferredTitle;
        const fallbackDesc = body.slice(0, 160).replace(/[#*`]/g, "").trim();
        meta.description = extractedExcerpt || meta.description || (fallbackDesc ? fallbackDesc + "..." : "");
        meta.tags = combinedTags;
        const cleanFolder = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
        meta.category = meta.category || (cleanFolder ? cleanFolder.toUpperCase() : (combinedTags[0] ? combinedTags[0].toUpperCase() : "Research"));
        const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
        meta.readTime = meta.readTime || `${Math.max(1, Math.ceil(wordCount / 200))} min read`;

        // Natural image extraction: First genuine image in frontmatter, markdown, or body
        let firstImage = meta.image || meta.cover || meta.thumbnail || null;
        if (!firstImage) {
            const mdImgMatch = body.match(/!\[([^\]]*)\]\((https?:\/\/[^\s\)]+|[^\s\)]+\.(?:png|jpe?g|webp|gif|svg|avif))\)/i);
            if (mdImgMatch) firstImage = mdImgMatch[2].trim();
        }
        if (!firstImage) {
            const htmlImgMatch = body.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (htmlImgMatch) firstImage = htmlImgMatch[1].trim();
        }
        if (!firstImage) {
            const bareImgMatch = body.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'<>]*)?/i) ||
                                 body.match(/https?:\/\/unavatar\.io\/[^\s"'<>]+/i);
            if (bareImgMatch) firstImage = bareImgMatch[0].trim();
        }

        if (firstImage) {
            firstImage = resolveRawImagePath(firstImage, folder);
        }
        meta.image = firstImage || null;

        return { meta, body };
    }

    // Re-parse any cached post that still carries its original raw markdown so stale browser caches self-heal.
    function rehydrateCachedPost(p) {
        if (!p || typeof p !== 'object') return p;
        const folder = p.folder || (p.meta && p.meta.folder) || (p.slug && p.slug.includes('--') ? p.slug.split('--')[0] : '');
        const existingLen = typeof p.content === 'string' ? p.content.length : 0;
        if (typeof p.rawContent === 'string' && p.rawContent.trim().length > 0 && p.meta?._mdRev !== 2 && p.rawContent.length >= existingLen) {
            const filename = p.filename || `${p.slug || 'note'}.md`;
            const parsed = parseMarkdown(p.rawContent, filename, folder);
            const prevDate = p.meta && p.meta.date;
            if (!parsed.meta.date && prevDate) {
                parsed.meta.date = prevDate;
            }
            if (folder) {
                parsed.meta.folder = folder;
                p.folder = folder;
            }
            parsed.meta._mdRev = 2;
            p.meta = parsed.meta;
            p.content = parsed.body;
        }
        return p;
    }

    // Hoisted: used by both parseMarkdown (cover image) and renderMarkdownHTML (inline images).
    function resolveRawImagePath(pathStr, folder = '') {
        if (!pathStr || typeof pathStr !== 'string') return '';
        const cleanRaw = pathStr.trim();
        if (cleanRaw.startsWith('http://') || cleanRaw.startsWith('https://') || cleanRaw.startsWith('data:')) {
            return cleanRaw;
        }
        const hadParentPrefix = cleanRaw.startsWith('../');
        const clean = cleanRaw.replace(/^(?:\.\.\/)+/, '').replace(/^\.?\//, '');
        if (!clean) return '';
        if (clean.startsWith(`${postsFolder}/`)) {
            return `https://raw.githubusercontent.com/${reposOwner}/${reposName}/main/${clean}`;
        }
        const cleanFolder = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
        if (cleanFolder && !hadParentPrefix && !clean.startsWith(`${cleanFolder}/`) && !clean.startsWith('assets/')) {
            return `https://raw.githubusercontent.com/${reposOwner}/${reposName}/main/${postsFolder}/${cleanFolder}/${clean}`;
        }
        return `https://raw.githubusercontent.com/${reposOwner}/${reposName}/main/${postsFolder}/${clean}`;
    }

    // KaTeX Dynamic Loader (Lazy-loaded on demand from local vendor assets; zero overhead if no math is present)
    let katexLoadPromise = null;
    function ensureKaTeXLoaded() {
        if (typeof window !== 'undefined' && window.katex) return Promise.resolve(window.katex);
        if (katexLoadPromise) return katexLoadPromise;

        katexLoadPromise = new Promise((resolve) => {
            if (typeof document === 'undefined') return resolve(null);
            if (!document.getElementById('katex-css')) {
                const link = document.createElement('link');
                link.id = 'katex-css';
                link.rel = 'stylesheet';
                link.href = 'vendor/katex/katex.min.css';
                document.head.appendChild(link);
            }
            if (window.katex) {
                resolve(window.katex);
                return;
            }
            const script = document.createElement('script');
            script.src = 'vendor/katex/katex.min.js';
            script.async = true;
            script.onload = () => resolve(window.katex);
            script.onerror = () => {
                console.warn('[KaTeX] Local bundle not reachable, skipping.');
                katexLoadPromise = null;
                resolve(null);
            };
            document.head.appendChild(script);
        });
        return katexLoadPromise;
    }

    function hydratePendingMath(container) {
        if (!container || typeof window === 'undefined' || !window.katex) return;
        container.querySelectorAll('.katex-math-pending').forEach(el => {
            const math = el.getAttribute('data-math');
            const display = el.getAttribute('data-display') === 'true';
            if (math) {
                try {
                    const rendered = window.katex.renderToString(math, {
                        displayMode: display,
                        throwOnError: false
                    });
                    el.outerHTML = rendered;
                } catch (e) {
                    console.warn('[KaTeX] Hydration error:', e);
                }
            }
        });
    }

    // Helper: Markdown to HTML Converter (extracts code/math blocks before prose HTML sanitization)
    function renderMarkdownHTML(md, folder = '') {
        if (!md) return '';
        let html = String(md).replace(/\x00/g, '');
        let ph = 'PXE0PH';
        while (html.includes(ph)) {
            ph += Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
        }
        const codeBlocks = [];
        const inlineCodes = [];
        const mathBlocks = [];

        // 1 & 2. Line-anchored fenced math and code blocks (CommonMark §4.5: unclosed fence closes at EOF)
        {
            const fenceLines = html.split(/\r?\n/);
            const fenceOut = [];
            let fi = 0;
            while (fi < fenceLines.length) {
                const fm = fenceLines[fi].match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
                if (!fm) {
                    fenceOut.push(fenceLines[fi]);
                    fi++;
                    continue;
                }
                const fChar = fm[1][0];
                const fLen = fm[1].length;
                const fInfo = fm[2].trim();
                const fLang = (fInfo.split(/\s+/)[0] || '').replace(/[^a-zA-Z0-9_-]/g, '');
                const isMdFence = (fLang.toLowerCase() === 'markdown' || fLang.toLowerCase() === 'md');
                let nestedDepth = 0;
                const fBuf = [];
                let fj = fi + 1;
                while (fj < fenceLines.length) {
                    const closeCheck = fenceLines[fj].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
                    if (closeCheck) {
                        if (isMdFence && nestedDepth > 0) {
                            nestedDepth--;
                            fBuf.push(fenceLines[fj]);
                            fj++;
                            continue;
                        }
                        if (closeCheck[1][0] === fChar && closeCheck[1].length >= fLen) {
                            break;
                        }
                    } else if (isMdFence && /^[ \t]*(`{3,}|~{3,})[ \t]*\S/.test(fenceLines[fj])) {
                        nestedDepth++;
                    }
                    fBuf.push(fenceLines[fj]);
                    fj++;
                }
                while (fBuf.length > 0 && fBuf[fBuf.length - 1] === '') {
                    fBuf.pop();
                }
                const fCode = fBuf.join('\n');
                if (fLang.toLowerCase() === 'math') {
                    const placeholder = `${ph}MB${mathBlocks.length}E`;
                    mathBlocks.push({ code: fCode.trim(), display: true });
                    fenceOut.push('', placeholder, '');
                } else {
                    const placeholder = `${ph}CB${codeBlocks.length}E`;
                    codeBlocks.push(`<pre><code class="language-${escapeHTML(fLang)}">${escapeHTML(fCode)}</code></pre>`);
                    fenceOut.push('', placeholder, '');
                }
                fi = fj < fenceLines.length ? fj + 1 : fenceLines.length;
            }
            html = fenceOut.join('\n');
        }

        // 3. Inline code blocks (single-line only so stray backticks cannot swallow paragraphs)
        html = html.replace(/``([^\r\n]+?)``/g, (_, code) => {
            const placeholder = `${ph}IC${inlineCodes.length}E`;
            inlineCodes.push(`<code>${escapeHTML(code.trim())}</code>`);
            return placeholder;
        });
        html = html.replace(/(?<!`)`([^`\r\n]+)`(?!`)/g, (_, code) => {
            const placeholder = `${ph}IC${inlineCodes.length}E`;
            inlineCodes.push(`<code>${escapeHTML(code)}</code>`);
            return placeholder;
        });

        // Strip dangerous raw HTML from remaining prose only
        html = sanitizeRawHTML(html);

        // 4. Protect escaped dollars: \$
        html = html.replace(/\\(\$)/g, `${ph}ED`);

        // 5. Display Math: $$...$$ or \[...\]
        html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, code) => {
            const placeholder = `${ph}MB${mathBlocks.length}E`;
            mathBlocks.push({ code: code.trim(), display: true });
            return `\n\n${placeholder}\n\n`;
        });
        html = html.replace(/\\\[([\s\S]+?)\\\]/g, (_, code) => {
            const placeholder = `${ph}MB${mathBlocks.length}E`;
            mathBlocks.push({ code: code.trim(), display: true });
            return `\n\n${placeholder}\n\n`;
        });

        // 6. Inline Math: $...$ or \(...\)
        html = html.replace(/(?<!\\)\$((?!\s)[^$\r\n]+?(?<!\s))\$/g, (_, code) => {
            const placeholder = `${ph}MB${mathBlocks.length}E`;
            mathBlocks.push({ code: code.trim(), display: false });
            return placeholder;
        });
        html = html.replace(/\\\(((?!\s)[^\r\n]+?(?<!\s))\\\)/g, (_, code) => {
            const placeholder = `${ph}MB${mathBlocks.length}E`;
            mathBlocks.push({ code: code.trim(), display: false });
            return placeholder;
        });

        html = html.replace(/^(?:---|\*\*\*|___)\s*$/gim, '\n\n<hr>\n\n');
        html = html.replace(/^#### (.*$)/gim, '\n\n<h4>$1</h4>\n\n');
        html = html.replace(/^### (.*$)/gim, '\n\n<h3>$1</h3>\n\n');
        html = html.replace(/^## (.*$)/gim, '\n\n<h2>$1</h2>\n\n');
        html = html.replace(/^# (.*$)/gim, '\n\n<h1>$1</h1>\n\n');
        html = html.replace(/^>[ \t]*\[!([A-Za-z]+)\][ \t]*((?:\r?\n>[ \t]?.*)+)/gm, (_, type, rest) => {
            const alertLines = rest.replace(/^\r?\n/, '').split(/\r?\n/).map(l => l.replace(/^>[ \t]?/, '').trim()).filter(Boolean);
            const safeType = escapeHTML(type.toUpperCase());
            return `\n\n<blockquote class="alert alert-${safeType}"><strong>${safeType}:</strong> ${alertLines.join('<br>')}</blockquote>\n\n`;
        });
        html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
        html = html.replace(/<\/blockquote>\s*<blockquote>/gim, '<br>');
        html = html.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/g, m => `\n\n${m}\n\n`);
        // Lists (parsed before inline italics so asterisk bullets are not misinterpreted)
        html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<ol-li>$1</ol-li>');
        html = html.replace(/(<ol-li>.*<\/ol-li>)/gim, '<ol>$1</ol>');
        html = html.replace(/<\/ol>\s*<ol>/gim, '');
        html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<ul-li>$1</ul-li>');
        html = html.replace(/(<ul-li>.*<\/ul-li>)/gim, '<ul>$1</ul>');
        html = html.replace(/<\/ul>\s*<ul>/gim, '');
        html = html.replace(/<ol-li>/gim, '<li>').replace(/<\/ol-li>/gim, '</li>');
        html = html.replace(/<ul-li>/gim, '<li>').replace(/<\/ul-li>/gim, '</li>');
        html = html.replace(/<ol>[\s\S]*?<\/ol>/g, m => `\n\n${m}\n\n`);
        html = html.replace(/<ul>[\s\S]*?<\/ul>/g, m => `\n\n${m}\n\n`);

        html = html.replace(/~~([^~\r\n]+?)~~/g, '<del>$1</del>');
        html = html.replace(/\*\*([^*\r\n]+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*\r\n]+?)\*/g, '<em>$1</em>');
        const phRe = new RegExp(`${ph}(?:MB|CB|IC)\\d+E`, 'g');
        const cleanAttrPh = (s) => String(s).split(`${ph}ED`).join('$').replace(phRe, '');
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
            const finalSrc = resolveRawImagePath(cleanAttrPh(src), folder);
            const safeSrc = sanitizeURL(finalSrc);
            const safeAlt = escapeHTML(cleanAttrPh(alt));
            return `<img src="${safeSrc}" alt="${safeAlt}" decoding="async" referrerpolicy="no-referrer">`;
        });
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
            const safeHref = sanitizeURL(cleanAttrPh(href));
            return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        });
        html = html.replace(/^[ \t]*(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'<>]*)?|https?:\/\/unavatar\.io\/[^\s"'<>]+)[ \t]*$/gim, (_, rawUrl) => {
            const safeSrc = sanitizeURL(cleanAttrPh(rawUrl));
            return `\n\n<img src="${safeSrc}" alt="Note image" decoding="async" referrerpolicy="no-referrer">\n\n`;
        });
        // GFM Pipe Tables
        {
            const tLines = html.split('\n');
            const tOut = [];
            let ti = 0;
            const splitCells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            const isSepRow = (row) => /^\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?$/.test(row.trim());
            while (ti < tLines.length) {
                if (
                    ti + 1 < tLines.length &&
                    tLines[ti].includes('|') &&
                    isSepRow(tLines[ti + 1])
                ) {
                    const headers = splitCells(tLines[ti]);
                    if (headers.length >= 1 && headers.some(Boolean)) {
                        const thHtml = headers.map(h => `<th>${h}</th>`).join('');
                        ti += 2;
                        const bodyRows = [];
                        while (ti < tLines.length && tLines[ti].trim().includes('|') && !isSepRow(tLines[ti])) {
                            const cells = splitCells(tLines[ti]);
                            const tdHtml = headers.map((_, ci) => `<td>${cells[ci] !== undefined ? cells[ci] : ''}</td>`).join('');
                            bodyRows.push(`<tr>${tdHtml}</tr>`);
                            ti++;
                        }
                        const tbodyHtml = bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : '';
                        tOut.push(`\n\n<table><thead><tr>${thHtml}</tr></thead>${tbodyHtml}</table>\n\n`);
                        continue;
                    }
                }
                tOut.push(tLines[ti]);
                ti++;
            }
            html = tOut.join('\n');
        }

        const mbParaRe = new RegExp(`^${ph}MB(\\d+)E$`);
        html = html.split(/\n{2,}/).map(para => {
            para = para.trim();
            if (!para) return '';
            const mathMatch = para.match(mbParaRe);
            const isDisplayMath = mathMatch && mathBlocks[parseInt(mathMatch[1], 10)]?.display;
            if (para.startsWith('<h') || para.startsWith('<pre') || para.startsWith('<ul') || para.startsWith('<ol') || para.startsWith('<hr') || para.startsWith('<blockquote') || para.startsWith('<table') || para.startsWith('<img') || para.startsWith(`${ph}CB`) || isDisplayMath) {
                return para;
            }
            return `<p>${para.replace(/\n/g, '<br>')}</p>`;
        }).filter(Boolean).join('\n');

        // Restore Escaped Dollars, Inline Codes, and Code Blocks BEFORE DOMParser sanitization
        html = html.split(`${ph}ED`).join('$');
        inlineCodes.forEach((code, idx) => {
            html = html.replace(`${ph}IC${idx}E`, () => code);
        });
        codeBlocks.forEach((block, idx) => {
            html = html.replace(`${ph}CB${idx}E`, () => block);
        });

        html = sanitizeRenderedHTML(html, folder);

        // Strip any remaining math placeholders that ended up inside HTML tags/attributes
        const mbTagRe = new RegExp(`${ph}MB\\d+E`, 'g');
        html = html.replace(/<[^>]*>/g, tag => tag.replace(mbTagRe, ''));

        // Restore Math (after sanitizeRenderedHTML so KaTeX HTML/MathML stays intact)
        mathBlocks.forEach((m, idx) => {
            let rendered = '';
            if (typeof window !== 'undefined' && window.katex) {
                try {
                    rendered = window.katex.renderToString(m.code, { displayMode: m.display, throwOnError: false });
                } catch (e) {
                    rendered = `<span class="katex-error">${escapeHTML(m.code)}</span>`;
                }
            } else {
                rendered = `<span class="katex-math-pending" data-math="${escapeHTML(m.code)}" data-display="${m.display}">${escapeHTML(m.code)}</span>`;
            }
            html = html.replace(`${ph}MB${idx}E`, () => rendered);
        });

        return html;
    }


    return {
        REPOS_OWNER: reposOwner,
        REPOS_NAME: reposName,
        POSTS_FOLDER: postsFolder,
        escapeHTML,
        sanitizeURL,
        sanitizeRawHTML,
        sanitizeRenderedHTML,
        catmullRomToBezier,
        generateDynamicSparkline,
        formatFriendlyDate,
        TOPIC_ICONS,
        detectLogoType,
        extractFrontmatter,
        parseMarkdown,
        rehydrateCachedPost,
        resolveRawImagePath,
        ensureKaTeXLoaded,
        hydratePendingMath,
        renderMarkdownHTML
    };
})();
