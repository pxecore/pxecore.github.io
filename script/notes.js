// Notes module coordinator (deck UI, reader, lightbox, routing).
function initResearchNotes() {
    const mdApi = window.pxecore.notesMarkdown;
    const {
        REPOS_OWNER: reposOwner,
        REPOS_NAME: reposName,
        POSTS_FOLDER: postsFolder,
        escapeHTML,
        sanitizeURL,
        sanitizeRenderedHTML,
        resolveRawImagePath,
        generateDynamicSparkline,
        formatFriendlyDate,
        detectLogoType,
        parseMarkdown,
        rehydrateCachedPost,
        ensureKaTeXLoaded,
        hydratePendingMath,
        renderMarkdownHTML
    } = mdApi;

    // clipboard helper
    function copyTextToClipboard(text) {
        if (typeof window.safeCopyToClipboard === 'function') {
            return new Promise((resolve) => {
                window.safeCopyToClipboard(text, resolve);
            });
        }
        if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).catch(() => fallbackExecCopy(text));
        }
        return fallbackExecCopy(text);
    }

    function fallbackExecCopy(text) {
        return new Promise((resolve, reject) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
                ta.setAttribute('readonly', '');
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) resolve();
                else reject(new Error('Copy command failed'));
            } catch (err) {
                reject(err);
            }
        });
    }

    // post permalink
    function getCleanPostUrl(slug) {
        const isLocalFile = window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null';
        const baseUrl = isLocalFile
            ? 'https://pxecore.github.io'
            : `${window.location.origin}${window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')}`;
        const cleanSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
        return `${baseUrl}/notes/${cleanSlug}/`;
    }

    function ensurePostImage(p) {
        if (!p) return;
        if (!p.meta) p.meta = {};
        const folder = p.folder || p.meta.folder || '';
        if (!p.meta.image) {
            const text = `${p.rawContent || ''} ${p.content || ''} ${p.htmlContent || ''}`;
            const fmImg = text.match(/(?:^|\r?\n)[ \t]*(?:image|cover|thumbnail):\s*["']?([^"'\r\n]+)["']?/i);
            if (fmImg) {
                p.meta.image = fmImg[1].trim();
            } else {
                const mdImg = text.match(/!\[([^\]]*)\]\((https?:\/\/[^\s\)]+|[^\s\)]+\.(?:png|jpe?g|webp|gif|svg|avif))\)/i);
                if (mdImg) {
                    p.meta.image = mdImg[2].trim();
                } else {
                    const htmlImg = text.match(/<img[^>]+src=["']([^"']+)["']/i);
                    if (htmlImg) {
                        p.meta.image = htmlImg[1].trim();
                    } else {
                        const bareImg = text.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s"'<>]*)?/i) ||
                            text.match(/https?:\/\/unavatar\.io\/[^\s"'<>]+/i);
                        if (bareImg) p.meta.image = bareImg[0].trim();
                    }
                }
            }
        }
        if (p.meta.image && typeof resolveRawImagePath === 'function' && !/^(?:\.\/|\/)/.test(p.meta.image)) {
            p.meta.image = resolveRawImagePath(p.meta.image, folder);
        }
    }

    // State Variables (Populated live via GitHub Sync & verified cache)
    let posts = [];
    try {
        const cached = localStorage.getItem('pxecore_cached_posts_v16');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) posts = parsed;
        }
    } catch (_) { }
    posts.forEach(p => {
        if (typeof rehydrateCachedPost === 'function') rehydrateCachedPost(p);
        ensurePostImage(p);
    });
    let activeCategories = [];
    let activeTags = [];
    let searchQuery = '';
    let sortOption = 'newest';
    let showAllTags = false;
    const postsPerPage = 3;
    let currentPage = 1;
    let activePostSlug = null;
    let blogViews = {};
    let inlineGraphEngine = null;
    let modalGraphEngine = null;
    let notesSyncApi = null;

    // Safe View Count Reader (Protects against prototype pollution & invalid keys)
    function getViewCount(slug) {
        if (!slug || typeof slug !== 'string' || !Object.prototype.hasOwnProperty.call(blogViews, slug)) {
            return 1;
        }
        const val = blogViews[slug];
        return (typeof val === 'number' && Number.isFinite(val) && val >= 1) ? Math.floor(val) : 1;
    }

    function ensurePostViewsSeeded(list) {
        (list || []).forEach(p => {
            if (p && p.slug && p.slug !== '__proto__' && p.slug !== 'constructor' && p.slug !== 'prototype' &&
                !Object.prototype.hasOwnProperty.call(blogViews, p.slug)) {
                blogViews[p.slug] = 1;
            }
        });
    }

    function getTotalPostViews() {
        return posts.reduce((sum, p) => sum + getViewCount(p && p.slug), 0) || posts.length || 1;
    }

    try {
        const storedViews = localStorage.getItem('pxecore_views_ledger_v3');
        if (storedViews) {
            const parsed = JSON.parse(storedViews);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.keys(parsed).forEach(k => {
                    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                        const num = Number(parsed[k]);
                        if (Number.isFinite(num) && num >= 1) {
                            blogViews[k] = Math.floor(num);
                        }
                    }
                });
            }
        }
    } catch (_) { }

    ensurePostViewsSeeded(posts);


    // DOM Elements
    const deckView = document.getElementById('notes-deck-view');
    const readerView = document.getElementById('notes-reader-view');
    const articlesList = document.getElementById('notes-articles-list');
    const countBadge = document.getElementById('notes-count-badge');
    const searchInput = document.getElementById('notes-search-input');
    const categoryChips = document.getElementById('notes-category-chips');
    const tagChips = document.getElementById('notes-tag-chips');
    const clearCatBtn = document.getElementById('clear-category-btn');
    const clearTagBtn = document.getElementById('clear-tag-btn');
    const sortSelect = document.getElementById('notes-sort-select');
    const resyncBtn = document.getElementById('notes-resync-btn');
    const syncText = document.getElementById('notes-sync-btn-text');
    const syncIcon = document.getElementById('notes-sync-icon');
    const tagsShowMoreBtn = document.getElementById('notes-tags-show-more');
    const paginationEl = document.getElementById('notes-pagination');
    const matchesCountEl = document.getElementById('notes-matches-count');
    const cumulativeViewsEl = document.getElementById('notes-cumulative-views');
    const trafficListEl = document.getElementById('notes-traffic-list');

    const inlineContainer = document.getElementById('notes-mindmap-container');
    const mindmapSvg = document.getElementById('notes-mindmap-svg');
    const expandMindmapBtn = document.getElementById('notes-expand-mindmap-btn');
    const mindmapModal = document.getElementById('notes-mindmap-modal');
    const modalBackdrop = document.getElementById('notes-mindmap-backdrop');
    const closeMindmapBtn = document.getElementById('notes-close-mindmap-btn');
    const modalContainer = document.getElementById('notes-modal-svg-container');
    const modalSvg = document.getElementById('notes-modal-mindmap-svg');
    const modalZoomIn = document.getElementById('modal-zoom-in');
    const modalZoomOut = document.getElementById('modal-zoom-out');
    const modalZoomReset = document.getElementById('modal-zoom-reset');

    const readerReturnBtn = document.getElementById('reader-return-btn');
    const readerBottomReturnBtn = document.getElementById('reader-bottom-return-btn');
    const readerTopBtn = document.getElementById('reader-top-btn');
    const readerShareBtn = document.getElementById('reader-share-btn');
    const readerShareText = document.getElementById('reader-share-text');
    const readerTitle = document.getElementById('reader-title');
    const readerDesc = document.getElementById('reader-description');
    const readerCategory = document.getElementById('reader-category');
    const readerDate = document.getElementById('reader-date');
    const readerReadTime = document.getElementById('reader-read-time');
    const readerContent = document.getElementById('reader-content');
    const readerSigner = document.getElementById('reader-signer');
    const readerTopicsList = document.getElementById('reader-topics-list');
    const readerViewsCount = document.getElementById('reader-views-count');
    const readerSharePct = document.getElementById('reader-share-pct');
    const readerSparkline = document.getElementById('reader-sparkline');
    const readerProgressBar = document.getElementById('notes-reader-progress-bar');
    const readerCard = document.getElementById('notes-reader-card');

    const lightboxModal = document.getElementById('notes-lightbox-modal');
    const lightboxImg = document.getElementById('notes-lightbox-img');
    const lightboxCaption = document.getElementById('notes-lightbox-caption');
    const lightboxClose = document.getElementById('notes-lightbox-close');
    const lightboxBackdrop = document.getElementById('notes-lightbox-backdrop');

    function getFilteredPosts() {
        return posts.filter(post => {
            const meta = post.meta || {};
            if (activeCategories.length > 0 && !activeCategories.includes(meta.category || '')) {
                return false;
            }
            if (activeTags.length > 0) {
                const postTags = (meta.tags || []).map(t => t.toLowerCase());
                const matchesAnyTag = activeTags.some(t => postTags.includes(t.toLowerCase()));
                if (!matchesAnyTag) return false;
            }
            if (searchQuery.trim().length > 0) {
                const q = searchQuery.toLowerCase();
                const title = (meta.title || '').toLowerCase();
                const desc = (meta.description || '').toLowerCase();
                const tags = (meta.tags || []).join(' ').toLowerCase();
                const content = (post.content || '').toLowerCase();
                if (!title.includes(q) && !desc.includes(q) && !tags.includes(q) && !content.includes(q)) {
                    return false;
                }
            }
            return true;
        }).sort((a, b) => {
            if (sortOption === 'newest') return (b.meta.date || '').localeCompare(a.meta.date || '');
            if (sortOption === 'oldest') return (a.meta.date || '').localeCompare(b.meta.date || '');
            if (sortOption === 'alphabetical') return (a.meta.title || '').localeCompare(b.meta.title || '');
            return 0;
        });
    }

    function renderFilters() {
        if (!categoryChips || !tagChips) return;
        const categoriesSet = new Set();
        posts.forEach(p => { if (p.meta?.category) categoriesSet.add(p.meta.category); });
        const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

        categoryChips.innerHTML = `
            <button type="button" class="notes-chip notranslate ${activeCategories.length === 0 ? 'active' : ''}" translate="no" data-category="All">All</button>
            ${categories.map(cat => {
            const isActive = activeCategories.includes(cat);
            const safeCat = escapeHTML(cat);
            return `<button type="button" class="notes-chip notranslate ${isActive ? 'active' : ''}" translate="no" data-category="${safeCat}">${isActive ? '✓ ' : ''}${safeCat}</button>`;
        }).join('')}
        `;
        if (clearCatBtn) clearCatBtn.style.display = activeCategories.length > 0 ? 'inline-block' : 'none';

        const tagsSet = new Set();
        posts.forEach(p => (p.meta?.tags || []).forEach(t => tagsSet.add(t)));
        const tagList = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
        const limit = 8;

        // tags list
        const visibleTags = showAllTags
            ? tagList
            : tagList.filter((tag, idx) => idx < limit || activeTags.includes(tag.toLowerCase()));

        tagChips.innerHTML = `
            <button type="button" class="notes-chip notranslate ${activeTags.length === 0 ? 'active' : ''}" translate="no" data-tag="All">All</button>
            ${visibleTags.map(tag => {
            const isActive = activeTags.includes(tag.toLowerCase());
            const safeTag = escapeHTML(tag);
            return `<button type="button" class="notes-chip notranslate ${isActive ? 'active' : ''}" translate="no" data-tag="${safeTag}">${isActive ? '✓ ' : ''}#${safeTag}</button>`;
        }).join('')}
        `;
        if (tagsShowMoreBtn) {
            const hiddenCount = tagList.length - visibleTags.length;
            if (hiddenCount > 0 || (showAllTags && tagList.length > limit)) {
                tagsShowMoreBtn.style.display = 'inline-block';
                tagsShowMoreBtn.textContent = showAllTags ? 'SHOW LESS [-]' : `SHOW MORE (+${hiddenCount})`;
            } else {
                tagsShowMoreBtn.style.display = 'none';
            }
        }
        if (clearTagBtn) {
            clearTagBtn.style.display = activeTags.length > 0 ? 'inline-block' : 'none';
            clearTagBtn.textContent = `✕ clear (${activeTags.length})`;
        }
    }

    function renderArticles() {
        if (!articlesList || !countBadge) return;

        // 1. Initial / syncing / failed state when no posts are loaded yet
        if (!posts || posts.length === 0) {
            const syncInfo = (notesSyncApi && typeof notesSyncApi.getSyncState === 'function')
                ? notesSyncApi.getSyncState()
                : { status: 'syncing', reason: null };

            if (syncInfo.status === 'error') {
                const detailMsg = syncInfo.reason === 'file-origin-blocked'
                    ? 'Local file:// security rules in this browser blocked remote note fetching. Open over http(s):// or retry.'
                    : (syncInfo.reason === 'rate-limited'
                        ? 'GitHub API rate limit reached and no offline mirror was reachable right now.'
                        : 'Could not reach GitHub or the local feed mirror to sync research notes.');
                countBadge.textContent = 'Sync paused';
                articlesList.innerHTML = `
                    <div class="notes-profile-card notes-sync-placeholder" style="text-align: center; padding: 52px 20px;">
                        <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.45rem; color: var(--accent); margin-bottom: 14px; opacity: 0.9;"></i>
                        <h3 style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; font-family: var(--font-mono, monospace);">Notes sync unavailable</h3>
                        <p style="font-size: 0.8rem; color: var(--text-secondary); max-width: 390px; margin: 0 auto 16px; line-height: 1.55;">${escapeHTML(detailMsg)}</p>
                        <button type="button" id="notes-retry-sync-btn" class="notes-resync-mini-btn notranslate" translate="no" style="display: inline-flex; margin: 0 auto;">
                            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                            <span>Retry Sync</span>
                        </button>
                    </div>
                `;
            } else {
                countBadge.textContent = 'Syncing...';
                articlesList.innerHTML = `
                    <div class="notes-profile-card notes-sync-placeholder" style="text-align: center; padding: 56px 20px;">
                        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; color: var(--accent); margin-bottom: 14px; opacity: 0.85;"></i>
                        <h3 style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; font-family: var(--font-mono, monospace);">Syncing notes from repository...</h3>
                        <p style="font-size: 0.8rem; color: var(--text-secondary); max-width: 360px; margin: 0 auto; line-height: 1.5;">Please wait while the latest research notes are fetched from GitHub.</p>
                    </div>
                `;
            }
            if (paginationEl) paginationEl.innerHTML = '';
            renderTraffic();
            if (inlineGraphEngine) {
                inlineGraphEngine.applyHoverStyles();
            }
            if (modalGraphEngine && mindmapModal && mindmapModal.classList.contains('is-open')) {
                modalGraphEngine.applyHoverStyles();
            }
            return;
        }

        const filtered = getFilteredPosts();
        countBadge.textContent = `${filtered.length} post${filtered.length === 1 ? '' : 's'} matching`;
        if (filtered.length === 0) {
            articlesList.innerHTML = `
                <div class="notes-profile-card" style="text-align: center; padding: 40px 20px;">
                    <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; color: var(--accent); opacity: 0.5; margin-bottom: 12px;"></i>
                    <h3 style="font-size: 1rem; color: var(--text-primary); margin-bottom: 4px;">No matching notes found.</h3>
                    <p style="font-size: 0.8rem; color: var(--text-secondary);">Try clearing your search, categories, or tags.</p>
                </div>
            `;
            if (paginationEl) paginationEl.innerHTML = '';
            renderTraffic();
            if (inlineGraphEngine) {
                inlineGraphEngine.applyHoverStyles();
            }
            if (modalGraphEngine && mindmapModal && mindmapModal.classList.contains('is-open')) {
                modalGraphEngine.applyHoverStyles();
            }
            return;
        }
        const totalPages = Math.ceil(filtered.length / postsPerPage);
        if (currentPage > totalPages) currentPage = 1;
        const startIndex = (currentPage - 1) * postsPerPage;
        const paginated = filtered.slice(startIndex, startIndex + postsPerPage);
        articlesList.innerHTML = paginated.map((post, idx) => {
            const meta = post.meta || {};
            const logoIcon = detectLogoType(post);
            const friendlyDate = escapeHTML(formatFriendlyDate(meta.date));
            const tagsHtml = (meta.tags || []).map(t => `<span class="notes-tag-pill notranslate" translate="no" data-card-tag="${escapeHTML(t)}"><span>#</span>${escapeHTML(t)}</span>`).join('');
            const hasImage = Boolean(meta.image);
            const curViews = getViewCount(post.slug);
            const safeSlug = escapeHTML(post.slug);
            const safeTitle = escapeHTML(meta.title || post.slug);
            const safeDesc = escapeHTML(meta.description || '');
            const safeCat = escapeHTML(meta.category || 'Research');
            const safeReadTime = escapeHTML(meta.readTime || '1 min read');
            const safeImage = sanitizeURL(meta.image);

            return `
                <article class="notes-article-card ${hasImage ? 'has-thumb' : 'no-thumb'} is-cascade" style="--card-idx: ${idx};" data-slug="${safeSlug}" tabindex="0" aria-label="${safeTitle}">
                    <div class="notes-article-left">
                        <div class="notes-article-icon">${logoIcon}</div>
                        <div class="notes-article-content">
                            <div class="notes-article-meta">
                                <span class="notes-badge">${safeCat}</span>
                            </div>
                            <h3 class="notes-article-title">${safeTitle}</h3>
                            <p class="notes-article-desc">${safeDesc}</p>
                            ${tagsHtml ? `<div class="notes-article-tags">${tagsHtml}</div>` : ''}
                        </div>
                    </div>
                    <div class="notes-article-right">
                        <button type="button" class="notes-card-share-btn" data-share-slug="${safeSlug}" title="Copy Direct Link">
                            <i class="fa-solid fa-share-nodes"></i> <span>Share</span>
                        </button>
                        ${hasImage ? `
                        <div class="notes-article-thumb">
                            <img src="${safeImage}" alt="${safeTitle}" loading="eager" decoding="async" referrerpolicy="no-referrer" />
                        </div>` : ''}
                        <div class="notes-thumb-stats font-mono">
                            <span class="notes-thumb-date">${friendlyDate}</span>
                            <span class="notes-thumb-read">${safeReadTime}</span>
                            <span class="notes-thumb-views">${curViews} ${curViews === 1 ? 'view' : 'views'}</span>
                        </div>
                    </div>
                </article>`;
        }).join('');

        articlesList.querySelectorAll('.notes-article-thumb img').forEach(img => {
            const removeThumb = () => {
                const c = img.closest('.notes-article-card');
                if (c) {
                    c.classList.remove('has-thumb');
                    c.classList.add('no-thumb');
                }
                img.closest('.notes-article-thumb')?.remove();
            };
            if (img.complete && img.naturalWidth === 0) {
                removeThumb();
            } else {
                img.addEventListener('error', removeThumb, { once: true });
            }
        });

        // Pagination Deck
        if (paginationEl) {
            if (totalPages > 1) {
                paginationEl.innerHTML = Array.from({ length: totalPages }).map((_, index) => {
                    const pageNum = index + 1;
                    const isActive = currentPage === pageNum;
                    return `
                        <button type="button" class="notes-page-pill ${isActive ? 'active' : ''}" data-page="${pageNum}">
                            <span class="notes-page-dot page-shape-${pageNum}"></span>
                            Part ${pageNum}
                        </button>
                    `;
                }).join('');
            } else {
                paginationEl.innerHTML = '';
            }
        }

        renderTraffic();
        if (inlineGraphEngine) {
            inlineGraphEngine.applyHoverStyles();
        }
        if (modalGraphEngine && mindmapModal && mindmapModal.classList.contains('is-open')) {
            modalGraphEngine.applyHoverStyles();
        }
    }

    function renderTraffic() {
        const bpmEl = document.getElementById('notes-bpm');
        if (bpmEl) {
            const env = window.__pxecoreAudioEnvelope;
            bpmEl.textContent = String((env && env.active && env.bpm) ? env.bpm : 74);
        }
        ensurePostViewsSeeded(posts);
        const totalViews = getTotalPostViews();
        const filtered = getFilteredPosts();
        if (cumulativeViewsEl) {
            cumulativeViewsEl.innerHTML = `${totalViews} <span class="dim">total</span>`;
            const cumSvg = cumulativeViewsEl.parentElement.parentElement.querySelector('.notes-sparkline-svg');
            if (cumSvg) {
                const postViewValues = posts.map(p => getViewCount(p.slug));
                const cdf = generateDynamicSparkline(postViewValues.length ? postViewValues : [1], 100, 30, 'cdf');
                cumSvg.innerHTML = `
                    <defs>
                        <linearGradient id="notes-cum-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.30" />
                            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
                        </linearGradient>
                    </defs>
                    <path d="${cdf.areaPath}" fill="url(#notes-cum-grad)" />
                    <path d="${cdf.strokePath}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="${cdf.endpoint.x.toFixed(1)}" cy="${cdf.endpoint.y.toFixed(1)}" r="2.5" fill="var(--accent)" />
                `;
            }
        }
        if (matchesCountEl) {
            matchesCountEl.innerHTML = `${filtered.length} <span class="dim">loaded</span>`;
            const matchSvg = matchesCountEl.parentElement.parentElement.querySelector('.notes-sparkline-svg');
            if (matchSvg) {
                const matchValues = filtered.map(p => getViewCount(p.slug));
                const kde = generateDynamicSparkline(matchValues, 100, 30, 'gaussian');
                matchSvg.innerHTML = `
                    <defs>
                        <linearGradient id="notes-match-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25" />
                            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
                        </linearGradient>
                    </defs>
                    <path d="${kde.areaPath}" fill="url(#notes-match-grad)" />
                    <path d="${kde.strokePath}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="${kde.endpoint.x.toFixed(1)}" cy="${kde.endpoint.y.toFixed(1)}" r="2.5" fill="var(--accent)" />
                `;
            }
        }
        if (trafficListEl) {
            const sorted = [...posts].sort((a, b) => getViewCount(b.slug) - getViewCount(a.slug)).slice(0, 3);
            trafficListEl.innerHTML = sorted.map(p => {
                const views = getViewCount(p.slug);
                const share = totalViews > 0 ? ((views / totalViews) * 100).toFixed(1) : '0.0';
                const safeTitle = escapeHTML(p.meta?.title || p.slug);
                return `<div class="notes-traffic-row notranslate" translate="no"><span class="notes-traffic-name notranslate" translate="no" title="${safeTitle}">${safeTitle}</span><span class="notes-traffic-val notranslate" translate="no">${views} (${share}%)</span></div>`;
            }).join('');
        }
    }


    // Initialize Graph Engines
    const getGraphFilterState = () => ({
        activeTags,
        activeCategories,
        searchQuery,
        activePostSlug,
        filteredPosts: getFilteredPosts()
    });

    inlineGraphEngine = new window.pxecore.QuartzGraphEngine(
        mindmapSvg,
        inlineContainer,
        false,
        {
            escapeHTML,
            getFilterState: getGraphFilterState,
            onSelectPost: (slug) => openArticle(slug),
            onSelectTag: (tag) => {
                activeTags = [tag.toLowerCase()];
                currentPage = 1;
                renderUI();
            }
        }
    );

    modalGraphEngine = new window.pxecore.QuartzGraphEngine(
        modalSvg,
        modalContainer,
        true,
        {
            escapeHTML,
            getFilterState: getGraphFilterState,
            onSelectPost: (slug) => { hideModal(); openArticle(slug); },
            onSelectTag: (tag) => {
                activeTags = [tag.toLowerCase()];
                currentPage = 1;
                hideModal();
                renderUI();
            }
        }
    );

    // Listen to theme switch events so graph view re-evaluates all node styles immediately
    window.addEventListener('theme-changed', () => {
        if (inlineGraphEngine && inlineGraphEngine.nodes && inlineGraphEngine.nodes.length > 0) {
            inlineGraphEngine.applyHoverStyles();
        }
        if (modalGraphEngine && mindmapModal && mindmapModal.classList.contains('is-open')) {
            modalGraphEngine.applyHoverStyles();
        }
    });

    let hideModalTimer = null;
    let hideLightboxTimer = null;

    const isNotesViewVisible = () => {
        const notesView = document.getElementById('view-notes');
        return Boolean(notesView && notesView.classList.contains('site-view-active') && !notesView.hasAttribute('hidden'));
    };

    // Modal Control Events
    if (expandMindmapBtn && mindmapModal) {
        expandMindmapBtn.addEventListener('click', () => {
            if (hideModalTimer) {
                clearTimeout(hideModalTimer);
                hideModalTimer = null;
            }
            mindmapModal.style.display = 'flex';
            mindmapModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            requestAnimationFrame(() => {
                mindmapModal.classList.add('is-open');
                const modalBody = document.getElementById('notes-modal-svg-container');
                if (modalBody) {
                    const rect = modalBody.getBoundingClientRect();
                    if (rect.width > 50) modalGraphEngine.width = rect.width;
                    if (rect.height > 50) modalGraphEngine.height = rect.height;
                }
                modalGraphEngine.resize();
                modalGraphEngine.setPosts(posts);
                modalGraphEngine.viewport = { x: 0, y: 0, k: 1 };
                modalGraphEngine.updateViewportTransform();
                modalGraphEngine.alpha = 1.2;
                modalGraphEngine.startSimulation();
            });
        });
    }

    const hideModal = () => {
        if (!mindmapModal) return;
        mindmapModal.classList.remove('is-open');
        mindmapModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (modalGraphEngine && modalGraphEngine.isSimulating) {
            modalGraphEngine.isSimulating = false;
            if (modalGraphEngine.animFrameId) {
                cancelAnimationFrame(modalGraphEngine.animFrameId);
                modalGraphEngine.animFrameId = null;
            }
        }
        if (hideModalTimer) clearTimeout(hideModalTimer);
        hideModalTimer = setTimeout(() => {
            hideModalTimer = null;
            if (!mindmapModal.classList.contains('is-open')) {
                mindmapModal.style.display = 'none';
                if (isNotesViewVisible()) inlineGraphEngine.resize(false);
            }
        }, 450);
    };

    function openLightbox(src, alt) {
        if (!lightboxModal || !lightboxImg) return;
        if (hideLightboxTimer) {
            clearTimeout(hideLightboxTimer);
            hideLightboxTimer = null;
        }
        lightboxImg.referrerPolicy = 'no-referrer';
        lightboxImg.src = sanitizeURL(src);
        lightboxImg.alt = alt || '';
        if (lightboxCaption) lightboxCaption.textContent = alt || '';
        lightboxModal.style.display = 'flex';
        lightboxModal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            lightboxModal.classList.add('is-open');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        if (!lightboxModal || (lightboxModal.style.display === 'none' && !lightboxModal.classList.contains('is-open'))) return;
        lightboxModal.classList.remove('is-open');
        lightboxModal.setAttribute('aria-hidden', 'true');
        if (hideLightboxTimer) clearTimeout(hideLightboxTimer);
        hideLightboxTimer = setTimeout(() => {
            hideLightboxTimer = null;
            if (!lightboxModal.classList.contains('is-open')) {
                lightboxModal.style.display = 'none';
                if (!mindmapModal || !mindmapModal.classList.contains('is-open')) {
                    document.body.style.overflow = '';
                }
            }
        }, 360);
    }

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxBackdrop) lightboxBackdrop.addEventListener('click', closeLightbox);

    let readingProgressRafId = null;
    function updateReadingProgress() {
        if (!activePostSlug) {
            if (readerProgressBar && readerProgressBar.style.width !== '0%') {
                readerProgressBar.style.width = '0%';
            }
            return;
        }
        if (readingProgressRafId) return;
        readingProgressRafId = requestAnimationFrame(() => {
            readingProgressRafId = null;
            if (!isNotesViewVisible()) {
                if (readerProgressBar) readerProgressBar.style.width = '0%';
                if (document.body.classList.contains('reader-focused')) {
                    document.body.classList.remove('reader-focused');
                }
                return;
            }
            if (!activePostSlug || !readerView || readerView.style.display === 'none' || !readerProgressBar) return;
            const scrollY = window.scrollY || document.documentElement.scrollTop;
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            if (maxScroll <= 0) {
                readerProgressBar.style.width = '100%';
                return;
            }
            const progress = Math.min(100, Math.max(0, (scrollY / maxScroll) * 100));
            readerProgressBar.style.width = `${progress}%`;
        });
    }

    window.addEventListener('scroll', updateReadingProgress, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (inlineGraphEngine && inlineGraphEngine.isSimulating) {
                inlineGraphEngine.isSimulating = false;
                if (inlineGraphEngine.animFrameId) {
                    cancelAnimationFrame(inlineGraphEngine.animFrameId);
                    inlineGraphEngine.animFrameId = null;
                }
            }
            if (modalGraphEngine && modalGraphEngine.isSimulating) {
                modalGraphEngine.isSimulating = false;
                if (modalGraphEngine.animFrameId) {
                    cancelAnimationFrame(modalGraphEngine.animFrameId);
                    modalGraphEngine.animFrameId = null;
                }
            }
        }
    });

    if (modalBackdrop) modalBackdrop.addEventListener('click', hideModal);
    if (closeMindmapBtn) closeMindmapBtn.addEventListener('click', hideModal);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (lightboxModal && (lightboxModal.classList.contains('is-open') || lightboxModal.style.display === 'flex')) {
                closeLightbox();
                return;
            }
            if (mindmapModal && (mindmapModal.classList.contains('is-open') || mindmapModal.style.display === 'flex')) {
                hideModal();
                return;
            }
            if (activePostSlug && readerView && (readerView.style.display === 'flex' || document.body.classList.contains('reader-focused'))) {
                returnToDeck();
                return;
            }
            const searchInputEl = document.getElementById('notes-search-input');
            if (searchInputEl && (document.activeElement === searchInputEl || (searchQuery && searchQuery.trim().length > 0))) {
                searchInputEl.value = '';
                searchQuery = '';
                currentPage = 1;
                renderArticles();
                searchInputEl.blur();
                return;
            }
        }
        if (
            e.key === '/' &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName) &&
            !(document.activeElement && document.activeElement.isContentEditable)
        ) {
            const searchInput = document.getElementById('notes-search-input');
            if (searchInput && isNotesViewVisible() && (!readerView || readerView.style.display === 'none')) {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        }
    });

    if (modalZoomIn) modalZoomIn.addEventListener('click', () => modalGraphEngine.zoom('in'));
    if (modalZoomOut) modalZoomOut.addEventListener('click', () => modalGraphEngine.zoom('out'));
    if (modalZoomReset) modalZoomReset.addEventListener('click', () => modalGraphEngine.zoom('reset'));

    window.addEventListener('resize', () => {
        if (isNotesViewVisible()) {
            inlineGraphEngine.resize();
        }
        if (mindmapModal && mindmapModal.style.display === 'flex') {
            modalGraphEngine.resize();
        }
    });

    let notesActivationTimer = null;
    window.addEventListener('notes-view-activated', () => {
        if (notesActivationTimer) clearTimeout(notesActivationTimer);
        // If graph is not pre-warmed yet, initialize after entrance settles
        if (!inlineGraphEngine.nodes || inlineGraphEngine.nodes.length === 0) {
            notesActivationTimer = setTimeout(() => {
                if (!isNotesViewVisible()) return;
                inlineGraphEngine.setPosts(posts);
            }, 420);
        }
    });

    window.addEventListener('notes-view-deactivated', () => {
        returnToDeck(false);
        if (notesActivationTimer) {
            clearTimeout(notesActivationTimer);
            notesActivationTimer = null;
        }
        if (mindmapModal && mindmapModal.classList.contains('is-open')) {
            hideModal();
        }
        if (inlineGraphEngine && inlineGraphEngine.isSimulating) {
            inlineGraphEngine.isSimulating = false;
            if (inlineGraphEngine.animFrameId) {
                cancelAnimationFrame(inlineGraphEngine.animFrameId);
                inlineGraphEngine.animFrameId = null;
            }
        }
        if (modalGraphEngine && modalGraphEngine.isSimulating) {
            modalGraphEngine.isSimulating = false;
            if (modalGraphEngine.animFrameId) {
                cancelAnimationFrame(modalGraphEngine.animFrameId);
                modalGraphEngine.animFrameId = null;
            }
        }
    });

    // Hex glyph pools aligned with tabular-nums for title scramble
    const GLYPH_POOLS = {
        digit: '0123456789',
        narrowLower: '1fce',
        lower: '0123456789abcdef',
        narrowUpper: '1FCE',
        upper: '0123456789ABCDEF'
    };
    let titleDecryptRafId = null;
    let activeDecryptElement = null;

    function cancelTitleDecrypt() {
        if (titleDecryptRafId !== null) {
            cancelAnimationFrame(titleDecryptRafId);
            titleDecryptRafId = null;
        }
        if (activeDecryptElement) {
            activeDecryptElement.style.minHeight = '';
            activeDecryptElement.style.maxHeight = '';
            activeDecryptElement = null;
        }
    }

    function fnv1a32(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    function pickClassGlyph(ch, seed) {
        if (/[\s\p{P}\p{S}]/u.test(ch)) return ch;
        let pool;
        if (/[0-9]/.test(ch)) pool = GLYPH_POOLS.digit;
        else if (/^[ijltf]$/.test(ch)) pool = GLYPH_POOLS.narrowLower;
        else if (/^[IJLT]$/.test(ch)) pool = GLYPH_POOLS.narrowUpper;
        else if (ch === ch.toLowerCase() && ch !== ch.toUpperCase()) pool = GLYPH_POOLS.lower;
        else pool = GLYPH_POOLS.upper;
        const mixed = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
        return pool[mixed % pool.length];
    }

    /**
     * Reveal heading text left-to-right while keeping its bounding height fixed.
     */
    function animateDecryptTitle(element, targetText) {
        cancelTitleDecrypt();
        if (!element) return;
        const target = String(targetText || '');
        element.setAttribute('aria-label', target);

        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!target || prefersReduced || document.hidden) {
            element.textContent = target;
            return;
        }

        // Lock exact rendered box height so nothing beneath ever shifts by 1px
        element.textContent = target;
        const lockedHeight = element.getBoundingClientRect().height;
        if (lockedHeight > 0) {
            element.style.minHeight = `${lockedHeight}px`;
            element.style.maxHeight = `${Math.ceil(lockedHeight + 2)}px`;
        }
        activeDecryptElement = element;

        const chars = Array.from(target);
        const len = chars.length;
        const baseHash = fnv1a32(target);
        const tailShadow = chars.map((ch, i) => pickClassGlyph(ch, baseHash + i * 2654435761));

        const leadDelay = 70;
        const sweepDuration = Math.min(860, Math.max(400, Math.round(len * 18 + 220)));
        const totalDuration = leadDelay + sweepDuration;
        const frameInterval = 42;
        const beamWidth = len <= 6 ? 2 : (len <= 18 ? 3 : 4);
        let startTime = null;
        let lastDraw = 0;
        let tick = 0;

        const resolvedNode = document.createTextNode('');
        const beamSpan = document.createElement('span');
        beamSpan.className = 'notes-decrypt-beam';
        beamSpan.setAttribute('aria-hidden', 'true');
        const beamNode = document.createTextNode(tailShadow.slice(0, beamWidth).join(''));
        beamSpan.appendChild(beamNode);

        const tailSpan = document.createElement('span');
        tailSpan.className = 'notes-decrypt-tail';
        tailSpan.setAttribute('aria-hidden', 'true');
        const tailNode = document.createTextNode(tailShadow.slice(beamWidth).join(''));
        tailSpan.appendChild(tailNode);

        if (typeof element.replaceChildren === 'function') {
            element.replaceChildren(resolvedNode, beamSpan, tailSpan);
        } else {
            element.textContent = '';
            element.appendChild(resolvedNode);
            element.appendChild(beamSpan);
            element.appendChild(tailSpan);
        }

        const finish = () => {
            element.textContent = target;
            element.style.minHeight = '';
            element.style.maxHeight = '';
            if (activeDecryptElement === element) activeDecryptElement = null;
            titleDecryptRafId = null;
        };

        const step = (now) => {
            if (!activePostSlug || document.hidden) {
                finish();
                return;
            }
            if (startTime === null) startTime = now;
            const elapsed = now - startTime;
            if (elapsed >= totalDuration) {
                finish();
                return;
            }

            if (now - lastDraw >= frameInterval) {
                lastDraw = now;
                tick++;
                const progress = elapsed <= leadDelay ? 0 : Math.min(1, (elapsed - leadDelay) / sweepDuration);
                const resolvedCount = Math.floor(progress * len);
                const beamEnd = Math.min(len, resolvedCount + beamWidth);

                let beamStr = '';
                for (let i = resolvedCount; i < beamEnd; i++) {
                    const depth = i - resolvedCount;
                    // Near-resolved frontier slot settles faster than leading edge
                    const stepPhase = tick + depth * 3;
                    beamStr += pickClassGlyph(chars[i], baseHash ^ (i * 0x45d9f3b) ^ (stepPhase * 0x27d4eb2d));
                }

                resolvedNode.nodeValue = chars.slice(0, resolvedCount).join('');
                beamNode.nodeValue = beamStr;
                tailNode.nodeValue = tailShadow.slice(beamEnd).join('');
            }

            titleDecryptRafId = requestAnimationFrame(step);
        };

        titleDecryptRafId = requestAnimationFrame(step);
    }

    // Article Reader
    function openArticle(slug) {
        const post = posts.find(p => p.slug === slug);
        if (!post) return;

        // Prevent duplicate re-entry animation and decrypt re-run if this exact article is already open
        if (activePostSlug === slug && document.body.classList.contains('reader-focused') && readerView && readerView.style.display !== 'none') {
            return;
        }

        activePostSlug = slug;
        document.body.classList.add('reader-focused');
        const readingCountEl = document.getElementById('notes-reading-count');
        if (readingCountEl) readingCountEl.textContent = '1';

        if (typeof slug === 'string' && slug !== '__proto__' && slug !== 'constructor' && slug !== 'prototype') {
            blogViews[slug] = getViewCount(slug) + 1;
            try {
                localStorage.setItem('pxecore_views_ledger_v3', JSON.stringify(blogViews));
            } catch (_) { }
        }

        if (deckView) deckView.style.display = 'none';
        if (readerView) {
            readerView.style.display = 'flex';
            readerView.classList.remove('is-entering');
            void readerView.offsetWidth;
            readerView.classList.add('is-entering');
        }

        // Authoritative binding: THIS post's meta + THIS post's content. Never re-derive title from filename.
        if (typeof rehydrateCachedPost === 'function') rehydrateCachedPost(post);
        ensurePostImage(post);
        const existingMeta = post.meta || {};
        const needsParse = typeof post.content !== 'string' || !existingMeta.title;
        const folder = post.folder || existingMeta.folder || '';
        const parsed = needsParse ? parseMarkdown(post.rawContent || post.content || '', post.filename || `${slug}.md`, folder) : null;
        const parsedMeta = parsed ? parsed.meta : {};
        const body = (typeof post.content === 'string' && post.content.length > 0)
            ? post.content
            : (parsed ? parsed.body : '');
        const meta = {
            title: existingMeta.title || parsedMeta.title || post.slug,
            description: existingMeta.description || parsedMeta.description || '',
            category: existingMeta.category || parsedMeta.category || 'Research',
            date: existingMeta.date || parsedMeta.date,
            author: existingMeta.author || parsedMeta.author || 'pxecore',
            tags: (existingMeta.tags && existingMeta.tags.length) ? existingMeta.tags : (parsedMeta.tags || []),
            readTime: existingMeta.readTime || parsedMeta.readTime || '1 min read',
            image: existingMeta.image || parsedMeta.image || null
        };

        if (readerTitle) {
            animateDecryptTitle(readerTitle, meta.title || post.slug);
        }
        if (readerDesc) readerDesc.textContent = meta.description || '';
        if (readerCategory) readerCategory.textContent = (meta.category || 'Research').toUpperCase();
        if (readerDate) readerDate.textContent = formatFriendlyDate(meta.date);
        if (readerReadTime) readerReadTime.textContent = meta.readTime || '1 min read';
        if (readerContent) {
            try {
                if (typeof body === 'string' && body.length > 0) {
                    readerContent.innerHTML = renderMarkdownHTML(body, folder);
                } else if (typeof post.htmlContent === 'string' && post.htmlContent.length > 0) {
                    readerContent.innerHTML = sanitizeRenderedHTML ? sanitizeRenderedHTML(post.htmlContent, folder) : post.htmlContent;
                    readerContent.querySelectorAll('.katex-math[data-math]').forEach(el => {
                        el.classList.add('katex-math-pending');
                    });
                } else {
                    readerContent.innerHTML = renderMarkdownHTML('');
                }
                if (readerContent.querySelector('.katex-math-pending')) {
                    ensureKaTeXLoaded()
                        .then(() => {
                            hydratePendingMath(readerContent);
                        })
                        .catch(() => {});
                }
            } catch (renderErr) {
                console.warn('[Notes] Markdown render fallback:', renderErr);
                readerContent.textContent = body || '';
            }
        }
        if (readerSigner) readerSigner.textContent = `@${meta.author || 'pxecore'}`;

        // Code block frames, header bar, copy buttons & image zoom
        if (readerContent) {
            readerContent.querySelectorAll('pre').forEach(pre => {
                if (pre.closest('.notes-code-frame') || pre.querySelector('.notes-code-copy-btn')) return;

                const codeEl = pre.querySelector('code');
                const langMatch = (codeEl?.className || '').match(/language-([a-zA-Z0-9_+-]+)/);
                const langLabel = (langMatch && langMatch[1] && langMatch[1] !== 'text' && langMatch[1] !== 'plaintext')
                    ? langMatch[1].toUpperCase()
                    : 'CODE';

                const frame = document.createElement('div');
                frame.className = 'notes-code-frame notranslate';
                frame.setAttribute('translate', 'no');

                const header = document.createElement('div');
                header.className = 'notes-code-header';

                const langSpan = document.createElement('span');
                langSpan.className = 'notes-code-lang font-mono';
                langSpan.textContent = langLabel;

                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'notes-code-copy-btn font-mono';
                copyBtn.setAttribute('aria-label', 'Copy code snippet');
                copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> <span>Copy</span>';
                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const code = codeEl?.innerText || pre.innerText;
                    try {
                        await copyTextToClipboard(code);
                        copyBtn.classList.add('is-copied');
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>copied!</span>';
                        setTimeout(() => {
                            copyBtn.classList.remove('is-copied');
                            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> <span>Copy</span>';
                        }, 2000);
                    } catch (_) { }
                });

                header.appendChild(langSpan);
                header.appendChild(copyBtn);
                pre.parentNode.insertBefore(frame, pre);
                frame.appendChild(header);
                frame.appendChild(pre);
            });

            readerContent.querySelectorAll('img').forEach(img => {
                // Force eager decoding + no-referrer so Konqueror/QtWebEngine fetches images inside active transitions
                img.loading = 'eager';
                img.decoding = 'async';
                img.setAttribute('referrerpolicy', 'no-referrer');
                img.addEventListener('click', () => {
                    openLightbox(img.src, img.alt || 'Technical diagram');
                });
            });
        }

        // Dynamic TOC: inline (mobile/tablet) + fixed side nav (large screens, nullpt.rs style)
        const tocBox = document.getElementById('notes-reader-toc-box');
        const tocList = document.getElementById('notes-reader-toc');
        const sideToc = document.getElementById('notes-side-toc');
        const sideTocNav = document.getElementById('notes-side-toc-nav');
        if (readerView) readerView.classList.remove('reader-has-toc');

        if (readerContent && tocList && tocBox) {
            // Collect body headings (h1..h4)
            const headings = Array.from(readerContent.querySelectorAll('h1, h2, h3, h4')).filter(h => h.textContent.trim().length > 0);
            if (headings.length > 0) {
                tocBox.style.display = 'block';
                const safeSlugId = String(slug || '').replace(/[^a-zA-Z0-9_-]/g, '-');
                const items = headings.map((h, idx) => {
                    const hId = `sec-${safeSlugId}-${idx}`;
                    h.id = hId;
                    const level = h.tagName === 'H4' ? 4 : (h.tagName === 'H3' ? 3 : (h.tagName === 'H1' ? 1 : 2));
                    const safeText = escapeHTML(h.textContent.trim());
                    return { hId, level, safeText, el: h };
                });

                // Inline CONTENTS (chips) — used below xl breakpoint
                tocList.innerHTML = items.map(({ hId, level, safeText }) => `
                    <a href="#${hId}" class="notes-toc-link ${level >= 3 ? 'is-h3' : ''}" data-heading-id="${hId}">
                        <span class="notes-toc-dot"></span>
                        <span class="notes-toc-text">${safeText}</span>
                    </a>
                `).join('');

                tocList.querySelectorAll('.notes-toc-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        const hId = link.getAttribute('data-heading-id');
                        const target = document.getElementById(hId);
                        if (target) {
                            scrollToHeading(target);
                            if (tocList) {
                                tocList.querySelectorAll('.notes-toc-link').forEach(l => {
                                    l.classList.toggle('is-active', l.getAttribute('data-heading-id') === hId);
                                });
                            }
                            if (sideTocNav) {
                                sideTocNav.querySelectorAll('.notes-side-toc-item').forEach(l => {
                                    l.classList.toggle('is-active', l.getAttribute('data-heading-id') === hId);
                                });
                            }
                        }
                    });
                });

                // Side TOC — CSS shows only ≥1240px when .is-open is set
                if (sideToc && sideTocNav) {
                    sideToc.hidden = false;
                    sideToc.classList.add('is-open');
                    if (readerView) readerView.classList.add('reader-has-toc');
                    sideTocNav.innerHTML = items.map(({ hId, level, safeText }) => `
                        <button type="button" class="notes-side-toc-item ${level >= 3 ? 'is-h3' : ''}" data-heading-id="${hId}">
                            ${safeText}
                        </button>
                    `).join('');
                    sideTocNav.querySelectorAll('.notes-side-toc-item').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            const hId = btn.getAttribute('data-heading-id');
                            const target = document.getElementById(hId);
                            if (target) {
                                scrollToHeading(target);
                                if (sideTocNav) {
                                    sideTocNav.querySelectorAll('.notes-side-toc-item').forEach(l => {
                                        l.classList.toggle('is-active', l.getAttribute('data-heading-id') === hId);
                                    });
                                }
                                if (tocList) {
                                    tocList.querySelectorAll('.notes-toc-link').forEach(l => {
                                        l.classList.toggle('is-active', l.getAttribute('data-heading-id') === hId);
                                    });
                                }
                            }
                        });
                    });
                }

                setupTocScrollspy(headings, tocList, sideTocNav);
            } else {
                tocBox.style.display = 'none';
                if (sideToc) {
                    sideToc.hidden = true;
                    sideToc.classList.remove('is-open');
                }
            }
        }

        // Update Reader Toolbar Stats
        const totalViews = getTotalPostViews();
        const curViews = getViewCount(slug);
        // Clamp to [0, 100] — single-post decks otherwise show 100%+ noise after first open
        const sharePct = Math.min(100, Math.max(0, (curViews / totalViews) * 100)).toFixed(1);

        if (readerViewsCount) readerViewsCount.textContent = curViews;
        if (readerSharePct) readerSharePct.textContent = `${sharePct}%`;
        if (readerSparkline) {
            const trendValues = [0.25, 0.55, 0.82, 1].map(f => Math.max(1, Math.min(curViews, Math.round(curViews * f))));
            const spark = generateDynamicSparkline(trendValues, 100, 30);
            const endX = spark.endpoint ? spark.endpoint.x.toFixed(1) : '95';
            const endY = spark.endpoint ? spark.endpoint.y.toFixed(1) : '15';
            readerSparkline.innerHTML = `
                <path d="${spark.strokePath || ''}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="${endX}" cy="${endY}" r="2.5" fill="var(--accent)" />
            `;
        }

        // Indexed Topics in Reader
        if (readerTopicsList) {
            const tags = meta.tags || [];
            if (tags.length > 0) {
                readerTopicsList.innerHTML = tags.map(t => {
                    const safeTag = escapeHTML(t);
                    return `<span class="notes-chip" data-reader-tag="${safeTag}"><span style="color: var(--accent);">#</span>${safeTag}</span>`;
                }).join('');
                readerTopicsList.querySelectorAll('[data-reader-tag]').forEach(chip => {
                    chip.addEventListener('click', () => {
                        const tag = chip.getAttribute('data-reader-tag');
                        if (tag) {
                            activeTags = [tag.toLowerCase()];
                            currentPage = 1;
                            returnToDeck();
                        }
                    });
                });
            } else {
                readerTopicsList.innerHTML = '<span class="dim" style="font-size: 0.75rem;">No automatic hash topics indexed for this log.</span>';
            }
        }

        // Update URL query (encode slug so share links & deep-links stay consistent)
        try {
            const encodedSlug = encodeURIComponent(slug);
            const targetHash = `#notes?p=${encodedSlug}`;
            if (window.location.protocol === 'file:') {
                window.location.hash = targetHash;
            } else {
                history.pushState(null, '', targetHash);
            }
        } catch (_) { }

        // Update document title + social meta tags so browser share / OG previews show the real post
        try {
            const shareTitle = meta.title || post.slug || 'pxecore';
            document.title = `${shareTitle} · pxecore`;
            setMetaTag('meta[property="og:title"]', shareTitle);
            setMetaTag('meta[name="twitter:title"]', shareTitle);
            setMetaTag('meta[property="og:description"]', meta.description || defaultMetaSnapshot['meta[property="og:description"]'] || '');
            setMetaTag('meta[name="twitter:description"]', meta.description || defaultMetaSnapshot['meta[name="twitter:description"]'] || '');
            if (meta.image) {
                setMetaTag('meta[property="og:image"]', meta.image);
                setMetaTag('meta[name="twitter:image"]', meta.image);
            }
        } catch (_) { }

        if (readerProgressBar) readerProgressBar.style.width = '0%';
        requestAnimationFrame(updateReadingProgress);
        window.scrollTo(0, 0);
    }

    const META_SELECTORS = [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[property="og:image"]',
        'meta[name="twitter:image"]'
    ];
    const defaultMetaSnapshot = {};
    META_SELECTORS.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) defaultMetaSnapshot[sel] = el.getAttribute('content') || '';
    });
    function setMetaTag(sel, val) {
        const el = document.querySelector(sel);
        if (el) el.setAttribute('content', val);
    }

    function returnToDeck(updateUrlAndTitle = true) {
        cancelTitleDecrypt();
        if (tocScrollHandler) {
            window.removeEventListener('scroll', tocScrollHandler);
            tocScrollHandler = null;
        }
        activePostSlug = null;
        document.body.classList.remove('reader-focused');
        const readingCountEl = document.getElementById('notes-reading-count');
        if (readingCountEl) readingCountEl.textContent = '0';
        if (readerProgressBar) readerProgressBar.style.width = '0%';
        closeLightbox();
        if (readerView) {
            readerView.style.display = 'none';
            readerView.classList.remove('reader-has-toc');
        }
        const sideToc = document.getElementById('notes-side-toc');
        if (sideToc) {
            sideToc.hidden = true;
            sideToc.classList.remove('is-open');
        }
        if (deckView) {
            deckView.style.display = 'grid';
        }

        if (updateUrlAndTitle) {
            try {
                if (window.location.protocol === 'file:') {
                    window.location.hash = '#notes';
                } else {
                    history.replaceState(null, '', '#notes');
                }
                document.title = 'pxecore · notes';
                setMetaTag('meta[property="og:title"]', 'pxecore · notes');
                setMetaTag('meta[name="twitter:title"]', 'pxecore · notes');
                setMetaTag('meta[property="og:description"]', defaultMetaSnapshot['meta[property="og:description"]'] || '');
                setMetaTag('meta[name="twitter:description"]', defaultMetaSnapshot['meta[name="twitter:description"]'] || '');
                if (defaultMetaSnapshot['meta[property="og:image"]']) {
                    setMetaTag('meta[property="og:image"]', defaultMetaSnapshot['meta[property="og:image"]']);
                }
                if (defaultMetaSnapshot['meta[name="twitter:image"]']) {
                    setMetaTag('meta[name="twitter:image"]', defaultMetaSnapshot['meta[name="twitter:image"]']);
                }
            } catch (_) { }
        }

        renderUI();

        if (updateUrlAndTitle) {
            if (deckView) {
                deckView.classList.remove('is-entering');
                void deckView.offsetWidth;
                deckView.classList.add('is-entering');
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
        }
    }

    // UI Rendering
    function renderUI() {
        renderFilters();
        renderArticles();
        if (isNotesViewVisible()) {
            if (!inlineGraphEngine.nodes || inlineGraphEngine.nodes.length === 0) {
                inlineGraphEngine.setPosts(posts);
            }
            inlineGraphEngine.applyHoverStyles();
        }
        if (modalGraphEngine && mindmapModal && mindmapModal.style.display === 'flex') {
            modalGraphEngine.applyHoverStyles();
        }
    }


    notesSyncApi = window.pxecore.createNotesSync({
        reposOwner,
        reposName,
        postsFolder,
        parseMarkdown,
        rehydrateCachedPost,
        resolveRawImagePath,
        ensurePostImage,
        getPosts: () => posts,
        setPosts: (nextPosts) => {
            posts = nextPosts;
            ensurePostViewsSeeded(posts);
        },
        getSyncEls: () => ({ syncText, syncIcon, resyncBtn }),
        getArticlesList: () => articlesList,
        renderUI,
        checkUrlForPost
    });
    const {
        getApiTelemetry,
        getSyncTooltipText,
        syncFromGitHub
    } = notesSyncApi;

    function normalizePostSlug(s) {
        return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    // Check URL parameters for direct deep-link to an article
    function checkUrlForPost() {
        const hash = window.location.hash || '';
        let targetSlug = null;

        if (hash.includes('?p=')) {
            targetSlug = hash.split('?p=')[1]?.split('&')[0];
        } else if (/^#notes\/([^?#]+)/i.test(hash)) {
            targetSlug = hash.replace(/^#notes\//i, '').split(/[?&]/)[0];
        } else {
            const params = new URLSearchParams(window.location.search);
            targetSlug = params.get('p');
        }

        if (targetSlug) {
            try {
                targetSlug = decodeURIComponent(targetSlug);
            } catch (_) { }
            const targetLower = targetSlug.toLowerCase();
            const targetNorm = normalizePostSlug(targetSlug);
            const match = posts.find(p =>
                p.slug === targetSlug ||
                encodeURIComponent(p.slug) === targetSlug ||
                p.slug.toLowerCase() === targetLower ||
                encodeURIComponent(p.slug).toLowerCase() === targetLower ||
                normalizePostSlug(p.slug) === targetNorm ||
                (p.meta?.title && p.meta.title.toLowerCase() === targetLower)
            );
            if (match) {
                const notesView = document.getElementById('view-notes');
                const isNotesActive = notesView && !notesView.hasAttribute('hidden') && notesView.classList.contains('site-view-active');
                if (!isNotesActive) {
                    if (typeof window.switchView === 'function') {
                        window.switchView('notes', false);
                    }
                }
                if (activePostSlug === match.slug && document.body.classList.contains('reader-focused') && readerView && readerView.style.display !== 'none') {
                    return;
                }
                openArticle(match.slug);
            }
        }
    }

    // Event Listeners
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            currentPage = 1;
            renderArticles();
        });
        const searchWrapper = searchInput.closest('.notes-search-wrapper');
        if (searchWrapper) {
            searchWrapper.addEventListener('click', (e) => {
                if (e.target !== searchInput) {
                    searchInput.focus();
                }
            });
        }
    }

    if (categoryChips) {
        categoryChips.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-category]');
            if (!btn) return;
            const cat = btn.getAttribute('data-category');
            if (cat === 'All') {
                activeCategories = [];
            } else {
                if (activeCategories.includes(cat)) {
                    activeCategories = activeCategories.filter(c => c !== cat);
                } else {
                    activeCategories.push(cat);
                }
            }
            currentPage = 1;
            renderUI();
        });
    }

    if (tagChips) {
        tagChips.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tag]');
            if (!btn) return;
            const tag = btn.getAttribute('data-tag');
            if (tag === 'All') {
                activeTags = [];
            } else {
                const low = tag.toLowerCase();
                if (activeTags.includes(low)) {
                    activeTags = activeTags.filter(t => t !== low);
                } else {
                    activeTags.push(low);
                }
            }
            currentPage = 1;
            renderUI();
        });
    }

    if (clearCatBtn) {
        clearCatBtn.addEventListener('click', () => {
            activeCategories = [];
            currentPage = 1;
            renderUI();
        });
    }

    if (clearTagBtn) {
        clearTagBtn.addEventListener('click', () => {
            activeTags = [];
            currentPage = 1;
            renderUI();
        });
    }

    if (tagsShowMoreBtn) {
        tagsShowMoreBtn.addEventListener('click', () => {
            showAllTags = !showAllTags;
            renderFilters();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            sortOption = e.target.value;
            currentPage = 1;
            renderArticles();
        });
    }

    const customSort = document.getElementById('notes-custom-sort');
    const sortTrigger = document.getElementById('notes-sort-trigger');
    const sortMenu = document.getElementById('notes-sort-menu');
    const sortSelectedLabel = document.getElementById('notes-sort-selected-label');
    const sortOptions = document.querySelectorAll('.notes-custom-select-option');

    if (customSort && sortTrigger && sortMenu) {
        sortTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = customSort.classList.toggle('is-open');
            sortTrigger.setAttribute('aria-expanded', String(isOpen));
            sortMenu.setAttribute('aria-hidden', String(!isOpen));
        });

        sortOptions.forEach((opt) => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = opt.getAttribute('data-value');
                const labelText = opt.querySelector('.notes-sort-option-text')?.textContent || opt.textContent.trim();

                sortOptions.forEach((o) => {
                    o.classList.remove('is-selected');
                    o.setAttribute('aria-selected', 'false');
                });
                opt.classList.add('is-selected');
                opt.setAttribute('aria-selected', 'true');

                if (sortSelectedLabel) sortSelectedLabel.textContent = labelText;
                if (sortSelect) {
                    sortSelect.value = val;
                    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                customSort.classList.remove('is-open');
                sortTrigger.setAttribute('aria-expanded', 'false');
                sortMenu.setAttribute('aria-hidden', 'true');
            });
        });

        document.addEventListener('click', (e) => {
            if (customSort && !customSort.contains(e.target)) {
                customSort.classList.remove('is-open');
                sortTrigger.setAttribute('aria-expanded', 'false');
                sortMenu.setAttribute('aria-hidden', 'true');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && customSort && customSort.classList.contains('is-open')) {
                customSort.classList.remove('is-open');
                sortTrigger.setAttribute('aria-expanded', 'false');
                sortMenu.setAttribute('aria-hidden', 'true');
                sortTrigger.focus();
            }
        });
    }

    if (resyncBtn) {
        resyncBtn.addEventListener('click', () => {
            syncFromGitHub(true).catch(err => {
                console.warn('[Notes] Manual resync handled:', err);
            });
        });
    }

    if (readerReturnBtn) readerReturnBtn.addEventListener('click', returnToDeck);
    if (readerBottomReturnBtn) readerBottomReturnBtn.addEventListener('click', returnToDeck);
    if (readerTopBtn) readerTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    const sideTocBack = document.getElementById('notes-side-toc-back');
    if (sideTocBack) sideTocBack.addEventListener('click', returnToDeck);

    async function shareOrCopyPost(slug, btnEl, labelEl, idleHtml, idleText) {
        if (!slug) return;
        const postUrl = getCleanPostUrl(slug);
        try {
            await copyTextToClipboard(postUrl);
            if (btnEl) btnEl.classList.add('is-copied');
            if (labelEl) labelEl.textContent = 'copied!';
            else if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-check"></i> <span class="notranslate" translate="no">copied!</span>';
            setTimeout(() => {
                if (btnEl) btnEl.classList.remove('is-copied');
                if (labelEl && idleText) labelEl.textContent = idleText;
                else if (btnEl && idleHtml) btnEl.innerHTML = idleHtml;
            }, 2000);
        } catch (err) {
            console.warn && console.warn('[Notes] Share copy failed:', err);
        }
    }

    // Event delegation for article cards and pagination
    if (articlesList) {
        articlesList.addEventListener('click', async (e) => {
            const retryBtn = e.target.closest('#notes-retry-sync-btn');
            if (retryBtn) {
                e.preventDefault();
                e.stopPropagation();
                syncFromGitHub(true, { bypassDebounce: true }).catch(() => {});
                return;
            }

            const shareBtn = e.target.closest('.notes-card-share-btn');
            if (shareBtn) {
                e.preventDefault();
                e.stopPropagation();
                await shareOrCopyPost(
                    shareBtn.getAttribute('data-share-slug'),
                    shareBtn,
                    null,
                    '<i class="fa-solid fa-share-nodes"></i> <span class="notranslate" translate="no">Share</span>'
                );
                return;
            }

            const tagPill = e.target.closest('[data-card-tag]');
            if (tagPill) {
                e.preventDefault();
                e.stopPropagation();
                const tag = tagPill.getAttribute('data-card-tag');
                if (tag) {
                    const low = tag.toLowerCase();
                    if (!activeTags.includes(low)) {
                        activeTags = [low];
                    } else {
                        activeTags = activeTags.filter(t => t !== low);
                    }
                    currentPage = 1;
                    renderUI();
                }
                return;
            }

            const card = e.target.closest('.notes-article-card[data-slug]');
            if (card) {
                const slug = card.getAttribute('data-slug');
                if (slug) openArticle(slug);
            }
        });

        articlesList.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target.closest('button, a, [data-card-tag]')) return;
            const card = e.target.closest('.notes-article-card[data-slug]');
            if (card) {
                e.preventDefault();
                const slug = card.getAttribute('data-slug');
                if (slug) openArticle(slug);
            }
        });
    }

    if (paginationEl) {
        paginationEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-page]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const targetPage = parseInt(btn.getAttribute('data-page'), 10) || 1;
                if (targetPage === currentPage) return;
                currentPage = targetPage;
                if (articlesList) {
                    articlesList.classList.remove('page-turn-anim');
                    void articlesList.offsetWidth;
                    articlesList.classList.add('page-turn-anim');
                }
                renderArticles();
                // Smoothly scroll back to the top of the cards deck if scrolled past, without leaping all the way past the cards to the page header
                const deckAnchor = document.querySelector('.notes-center-deck') || articlesList;
                if (deckAnchor) {
                    const rect = deckAnchor.getBoundingClientRect();
                    if (rect.top < 70) {
                        const currentScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
                        const targetY = currentScroll + rect.top - 76;
                        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
                    }
                }
            }
        });
    }

    if (articlesList) {
        articlesList.addEventListener('animationend', (e) => {
            if (e.animationName === 'parchmentPageTurn') {
                articlesList.classList.remove('page-turn-anim');
            }
        });
    }

    if (readerShareBtn && readerShareText) {
        readerShareBtn.addEventListener('click', () => shareOrCopyPost(activePostSlug, readerShareBtn, readerShareText, null, 'Share Post'));
    }

    // toc click scroll: fixed-duration eased scroll that re-reads the target each
    // frame (late layout shifts cannot derail it) and pauses the scrollspy.
    let tocScrollLock = false;
    let tocScrollRaf = 0;
    function scrollToHeading(target) {
        const offset = 88; // matches scroll-margin-top: 5.5rem
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const startY = window.scrollY;
        const targetY = () => Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
        cancelAnimationFrame(tocScrollRaf);
        if (reduce) {
            window.scrollTo(0, targetY());
            return;
        }
        const duration = Math.min(900, Math.max(420, Math.abs(targetY() - startY) * 0.35));
        const t0 = performance.now();
        const cancel = () => {
            cancelAnimationFrame(tocScrollRaf);
            tocScrollLock = false;
            ['wheel', 'touchstart', 'keydown'].forEach(ev => window.removeEventListener(ev, cancel));
        };
        tocScrollLock = true;
        ['wheel', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, cancel, { passive: true }));
        const step = (now) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            window.scrollTo(0, startY + (targetY() - startY) * eased);
            if (p < 1) {
                tocScrollRaf = requestAnimationFrame(step);
            } else {
                cancel();
            }
        };
        tocScrollRaf = requestAnimationFrame(step);
    }

    // toc scrollspy (inline + side rail)
    let tocScrollHandler = null;

    function setupTocScrollspy(headings, tocList, sideTocNav) {
        if (tocScrollHandler) {
            window.removeEventListener('scroll', tocScrollHandler);
            tocScrollHandler = null;
        }

        const headingEls = Array.from(headings || []);
        if (headingEls.length === 0) return;

        function setActive(id) {
            if (!id) return;
            if (tocList) {
                tocList.querySelectorAll('.notes-toc-link').forEach(l => {
                    l.classList.toggle('is-active', l.getAttribute('data-heading-id') === id);
                });
            }
            if (sideTocNav) {
                sideTocNav.querySelectorAll('.notes-side-toc-item').forEach(l => {
                    l.classList.toggle('is-active', l.getAttribute('data-heading-id') === id);
                });
            }
        }

        let ticking = false;
        tocScrollHandler = () => {
            if (!ticking && !tocScrollLock) {
                requestAnimationFrame(() => {
                    const offset = 140; // Clearance under fixed header
                    let activeId = headingEls[0].id;
                    for (let i = 0; i < headingEls.length; i++) {
                        const top = headingEls[i].getBoundingClientRect().top;
                        if (top <= offset) {
                            activeId = headingEls[i].id;
                        } else {
                            break;
                        }
                    }
                    setActive(activeId);
                    ticking = false;
                });
                ticking = true;
            }
        };

        window.addEventListener('scroll', tocScrollHandler, { passive: true });
        // Initial active section calculation
        tocScrollHandler();
    }



    // Namespace encapsulation under window.pxecore.notes
    window.pxecore = window.pxecore || {};
    window.pxecore.notes = {
        sync: syncFromGitHub,
        getApiTelemetry,
        returnToDeck,
        renderMarkdown: renderMarkdownHTML,
        getPosts: () => posts
    };

    // Global deck return hook for navbar & routing (backward compatibility)
    window.__returnToNotesDeck = returnToDeck;
    window.__pxecoreNotesSync = syncFromGitHub;
    window.__pxecoreGetApiTelemetry = getApiTelemetry;
    window.__pxecoreRenderMarkdown = renderMarkdownHTML;

    // Popstate & hashchange event for back/forward navigation & deep-linking
    function handleNotesRouting() {
        const rawHash = window.location.hash || '';
        const h = rawHash.replace('#', '').split('?')[0].split('/')[0];
        const params = new URLSearchParams(window.location.search);
        const hasPost = rawHash.includes('?p=') || /^#notes\/[^?#]+/i.test(rawHash) || params.has('p');

        if (h === 'notes' || hasPost) {
            ensureNotesRendered();
        }
        if (hasPost) {
            checkUrlForPost();
        } else {
            if (activePostSlug || (readerView && readerView.style.display !== 'none') || document.body.classList.contains('reader-focused')) {
                returnToDeck(false);
            }
        }
    }
    window.addEventListener('popstate', handleNotesRouting);
    window.addEventListener('hashchange', handleNotesRouting);
    window.addEventListener('notes-view-activated', () => {
        ensureNotesRendered();
        checkUrlForPost();
        // If notes are empty or showing placeholder, auto-sync immediately!
        if (!posts || posts.length === 0 || !articlesList || !articlesList.querySelector('.notes-article-card')) {
            syncFromGitHub(true).catch(() => { });
        }
    });

    // pre-warm graph engine (posts already hydrated from localStorage at module start)
    const prewarmGraph = () => {
        if (!inlineGraphEngine.nodes || inlineGraphEngine.nodes.length === 0) {
            if (!inlineGraphEngine.width || inlineGraphEngine.width <= 50) {
                inlineGraphEngine.width = 228;
                inlineGraphEngine.height = 320;
            }
            inlineGraphEngine.setPosts(posts);
        }
    };

    let hasRenderedNotes = false;
    const ensureNotesRendered = () => {
        if (hasRenderedNotes && posts && posts.length > 0 && articlesList && articlesList.querySelector('.notes-article-card')) return;
        hasRenderedNotes = true;
        renderUI();
        prewarmGraph();
    };
    window.__ensureNotesPrewarmed = ensureNotesRendered;

    const activeHashRaw = (window.location.hash || '').replace('#', '');
    const activeHash = activeHashRaw.split('?')[0].split('/')[0];
    const isNotesActive = activeHash === 'notes' || activeHashRaw.includes('?p=') || new URLSearchParams(window.location.search).has('p');
    const shouldForceSync = !posts || posts.length === 0;

    if (isNotesActive) {
        ensureNotesRendered();
        checkUrlForPost();
        syncFromGitHub(shouldForceSync).catch(err => {
            console.warn('[Notes] Initial background sync handled:', err);
        });
    } else {
        const runPrewarm = () => {
            ensureNotesRendered();
            setTimeout(() => {
                syncFromGitHub(shouldForceSync).catch(() => { });
            }, 350);
        };
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(runPrewarm, { timeout: 2600 });
        } else {
            setTimeout(runPrewarm, 2200);
        }
    }
}

