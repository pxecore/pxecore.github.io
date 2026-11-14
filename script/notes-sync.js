// GitHub REST/Trees sync, CORS-simple fallback, and static RSS/HTML fallback manager for Research Notes.
window.pxecore = window.pxecore || {};
window.pxecore.createNotesSync = function createNotesSync(bridge) {
    const {
        reposOwner,
        reposName,
        postsFolder,
        parseMarkdown,
        rehydrateCachedPost,
        resolveRawImagePath,
        ensurePostImage,
        getSyncEls,
        getArticlesList,
        renderUI,
        checkUrlForPost
    } = bridge;

    function hydratePostList(list) {
        if (!Array.isArray(list)) return [];
        list.forEach(p => {
            if (typeof rehydrateCachedPost === 'function') rehydrateCachedPost(p);
            ensurePostImage(p);
        });
        return list;
    }

    let syncState = { status: 'idle', reason: null, source: null };

    // GitHub API Standards & Rate-Limit Telemetry (avoid unnecessary OPTIONS preflight when unauthenticated)
    function getGitHubHeaders(extraHeaders = {}) {
        const headers = {
            'Accept': 'application/vnd.github+json',
            ...extraHeaders
        };
        try {
            const token = sessionStorage.getItem('pxecore_github_token');
            if (token && typeof token === 'string' && token.trim()) {
                headers['Authorization'] = `Bearer ${token.trim()}`;
                headers['X-GitHub-Api-Version'] = '2022-11-28';
            }
        } catch (_) {}
        return headers;
    }

    function recordRateLimitTelemetry(res) {
        if (!res || !res.headers) return null;
        const limit = res.headers.get('x-ratelimit-limit');
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        const retryAfter = res.headers.get('retry-after');

        if (limit === null && remaining === null && reset === null && retryAfter === null) return null;

        const limitNum = limit ? parseInt(limit, 10) : 60;
        const remainingNum = remaining !== null ? parseInt(remaining, 10) : null;
        const resetEpoch = reset
            ? parseInt(reset, 10) * 1000
            : (retryAfter ? Date.now() + parseInt(retryAfter, 10) * 1000 : 0);

        const meta = {
            limit: limitNum,
            remaining: remainingNum,
            resetTime: resetEpoch,
            updatedAt: Date.now()
        };

        try {
            localStorage.setItem('pxecore_ratelimit_meta_v1', JSON.stringify(meta));
            if (meta.remaining === 0 || res.status === 403 || res.status === 429) {
                localStorage.setItem('pxecore_ratelimit_reset_v6', (resetEpoch || (Date.now() + 15 * 60 * 1000)).toString());
            }
        } catch (_) {}
        return meta;
    }

    function getApiTelemetry() {
        try {
            const raw = localStorage.getItem('pxecore_ratelimit_meta_v1');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function getSyncTooltipText(fallback = 'GitHub API') {
        const telemetry = getApiTelemetry();
        let token = null;
        try { token = sessionStorage.getItem('pxecore_github_token'); } catch (_) {}
        const isAuth = Boolean(token && token.trim());
        if (telemetry && typeof telemetry.remaining === 'number') {
            const authPrefix = isAuth ? 'token' : 'public';
            return `${fallback} (${authPrefix} API: ${telemetry.remaining}/${telemetry.limit})`;
        }
        return fallback;
    }

    function getSyncState() {
        return { ...syncState };
    }

    let inFlightSync = null;
    let lastManualSyncAt = 0;

    async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
        if (typeof AbortController === 'undefined') return fetch(url, options);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    // Retry headerless CORS-simple GET when browsers/extensions/file:// reject preflighted headers
    async function fetchGitHubWithCorsFallback(url, headers, forceNoStore) {
        const opts = { headers };
        if (forceNoStore) opts.cache = 'no-store';
        try {
            return await fetchWithTimeout(url, opts);
        } catch (primaryErr) {
            if (!headers || Object.keys(headers).length === 0) throw primaryErr;
            const bareOpts = forceNoStore ? { cache: 'no-store' } : {};
            return fetchWithTimeout(url, bareOpts);
        }
    }

    function sanitizeFallbackBody(bodyEl) {
        if (!bodyEl) return '';
        const clone = bodyEl.cloneNode(true);
        clone.querySelectorAll('script, iframe, object, embed, form, style, svg, math, base, meta, link').forEach(el => el.remove());
        clone.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes || []).forEach(attr => {
                const name = attr.name.toLowerCase();
                const val = String(attr.value || '').trim();
                const compactVal = val.replace(/[\u0000-\u0020]+/g, '');
                if (name.startsWith('on')) {
                    el.removeAttribute(attr.name);
                } else if ((name === 'href' || name === 'src') && /^(?:javascript|data|vbscript):/i.test(compactVal)) {
                    el.removeAttribute(attr.name);
                } else if (name === 'src' && val.startsWith('../')) {
                    el.setAttribute('src', val.replace(/^(\.\.\/)+/, './'));
                }
            });
            if (el.tagName && el.tagName.toUpperCase() === 'IMG') {
                if (el.getAttribute('loading') === 'lazy') {
                    el.removeAttribute('loading');
                }
                if (!el.getAttribute('decoding')) {
                    el.setAttribute('decoding', 'async');
                }
                if (!el.getAttribute('referrerpolicy')) {
                    el.setAttribute('referrerpolicy', 'no-referrer');
                }
            }
        });
        const rawHtml = clone.innerHTML;
        const mdApi = window.pxecore && window.pxecore.notesMarkdown;
        if (mdApi && typeof mdApi.sanitizeRenderedHTML === 'function') {
            return mdApi.sanitizeRenderedHTML(rawHtml, '', { preserveRelativeSrc: true });
        }
        return rawHtml;
    }

    function parseStaticNotePage(htmlText, slug, feedFallback) {
        if (!htmlText || typeof DOMParser === 'undefined') return null;
        try {
            const doc = new DOMParser().parseFromString(htmlText, 'text/html');
            const bodyEl = doc.querySelector('.notes-reader-body');
            if (!bodyEl) return null;

            const titleEl = doc.querySelector('h1.note-title');
            const descEl = doc.querySelector('p.note-desc');
            const crumbsEl = doc.querySelector('p.note-crumbs');
            const keywordsMeta = doc.querySelector('meta[name="keywords"]');
            const dateMeta = doc.querySelector('meta[property="article:published_time"]');

            const rawCrumbs = crumbsEl ? crumbsEl.textContent : '';
            const category = (rawCrumbs.split('/').pop() || feedFallback.category || 'Research').trim();
            const tagsRaw = keywordsMeta ? keywordsMeta.getAttribute('content') || '' : '';
            const tags = tagsRaw
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(Boolean);

            const plainWordCount = (bodyEl.textContent || '').trim().split(/\s+/).filter(Boolean).length;
            const readMins = Math.max(1, Math.ceil(plainWordCount / 220));
            const sanitizedBody = sanitizeFallbackBody(bodyEl);
            const firstImgEl = bodyEl.querySelector('img[src]');
            let firstImgSrc = firstImgEl ? String(firstImgEl.getAttribute('src') || '').trim() : '';
            if (firstImgSrc.startsWith('../')) {
                firstImgSrc = firstImgSrc.replace(/^(\.\.\/)+/, './');
            } else if (firstImgSrc && !/^(?:https?:|data:|\/|\.\/)/i.test(firstImgSrc) && typeof resolveRawImagePath === 'function') {
                firstImgSrc = resolveRawImagePath(firstImgSrc, '');
            }

            return {
                slug,
                filename: `${slug}.md`,
                meta: {
                    title: (titleEl && titleEl.textContent.trim()) || feedFallback.title || slug,
                    description: (descEl && descEl.textContent.trim()) || feedFallback.description || '',
                    category,
                    date: (dateMeta && dateMeta.getAttribute('content')) || feedFallback.date,
                    author: 'pxecore',
                    tags,
                    readTime: `${readMins} min read`,
                    image: firstImgSrc || null
                },
                content: '',
                htmlContent: sanitizedBody
            };
        } catch (_) {
            return null;
        }
    }

    function parsePubDateIso(pubDateStr) {
        if (!pubDateStr) return new Date().toISOString().slice(0, 10);
        const ts = Date.parse(pubDateStr);
        return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    }

    async function fetchStaticFeedFallback() {
        if (typeof DOMParser === 'undefined') return [];
        const feedRes = await fetchWithTimeout('./feed.xml', {}, 6000);
        if (!feedRes || !feedRes.ok) return [];
        const xmlText = await feedRes.text();
        const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
        const items = Array.from(xmlDoc.querySelectorAll('channel > item'));
        if (items.length === 0) return [];

        const jobs = items.map(async (item) => {
            const title = item.querySelector('title')?.textContent?.trim() || 'Research Note';
            const link = item.querySelector('link')?.textContent?.trim() || '';
            const description = item.querySelector('description')?.textContent?.trim() || '';
            const category = item.querySelector('category')?.textContent?.trim() || 'Research';
            const date = parsePubDateIso(item.querySelector('pubDate')?.textContent?.trim());

            const slugMatch = link.match(/\/notes\/([^/?#]+)\/?/);
            const slug = slugMatch ? decodeURIComponent(slugMatch[1]) : '';
            if (!slug) return null;

            const feedMeta = { title, description, category, date };
            try {
                const pageRes = await fetchWithTimeout(`./notes/${encodeURIComponent(slug)}/index.html`, {}, 6000);
                if (pageRes && pageRes.ok) {
                    const htmlText = await pageRes.text();
                    const parsed = parseStaticNotePage(htmlText, slug, feedMeta);
                    if (parsed) return parsed;
                }
            } catch (_) {}

            return {
                slug,
                filename: `${slug}.md`,
                meta: {
                    title,
                    description,
                    category,
                    date,
                    author: 'pxecore',
                    tags: [],
                    readTime: '1 min read'
                },
                content: description
            };
        });

        const settled = await Promise.all(jobs);
        const seen = new Set();
        return settled.filter(p => {
            if (!p || !p.slug || seen.has(p.slug)) return false;
            seen.add(p.slug);
            return true;
        });
    }

    function setTooltip(text) {
        const { syncText } = getSyncEls();
        if (syncText) {
            syncText.textContent = 'Sync';
            if (syncText.parentElement) syncText.parentElement.title = text;
        }
    }

    function syncFromGitHub(force = false, options = {}) {
        if (inFlightSync) {
            // If valid cache appeared while a cold network sync is still in flight, hydrate immediately
            const currentPosts = bridge.getPosts();
            if (!force && (!Array.isArray(currentPosts) || currentPosts.length === 0)) {
                try {
                    const cachedNow = localStorage.getItem('pxecore_cached_posts_v16');
                    const stampNow = localStorage.getItem('pxecore_cached_posts_timestamp_v16');
                    if (cachedNow && stampNow && (Date.now() - parseInt(stampNow, 10)) < 60 * 60 * 1000) {
                        const parsedNow = JSON.parse(cachedNow);
                        if (Array.isArray(parsedNow) && parsedNow.length > 0) {
                            hydratePostList(parsedNow);
                            bridge.setPosts(parsedNow);
                            renderUI();
                            checkUrlForPost();
                        }
                    }
                } catch (_) {}
            }
            return inFlightSync;
        }
        inFlightSync = runSync(force, options).finally(() => {
            inFlightSync = null;
        });
        return inFlightSync;
    }

    async function runSync(force = false, options = {}) {
        let posts = bridge.getPosts();
        const { syncText, syncIcon, resyncBtn } = getSyncEls();
        const articlesList = getArticlesList();
        const CACHE_DURATION = 60 * 60 * 1000;
        const MANUAL_DEBOUNCE_MS = 1500;
        const hasPostsInMemory = Array.isArray(posts) && posts.length > 0;

        let postsChanged = Boolean(force);
        let skipFinallyCheck = false;
        let cached = null;
        let stamp = null;
        let rateLimitReset = 0;
        let metaTelemetry = null;
        try {
            cached = localStorage.getItem('pxecore_cached_posts_v16');
            stamp = localStorage.getItem('pxecore_cached_posts_timestamp_v16');
            rateLimitReset = parseInt(localStorage.getItem('pxecore_ratelimit_reset_v6') || '0', 10);
            metaTelemetry = getApiTelemetry();
            if (metaTelemetry && metaTelemetry.resetTime && metaTelemetry.remaining === 0) {
                rateLimitReset = Math.max(rateLimitReset, metaTelemetry.resetTime);
            }
        } catch (_) {}
        const isRateLimited = Date.now() < rateLimitReset;

        if (force && !options.bypassDebounce && hasPostsInMemory && !isRateLimited && Date.now() - lastManualSyncAt < MANUAL_DEBOUNCE_MS) {
            return;
        }
        if (force && !options.bypassDebounce) lastManualSyncAt = Date.now();

        // 1. Serve valid cache if within window or during rate-limit cooldown
        if (cached && stamp) {
            const age = Date.now() - parseInt(stamp, 10);
            if ((!force && age < CACHE_DURATION) || isRateLimited) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        hydratePostList(parsed);
                        const isIdentical = posts && posts.length === parsed.length && posts[0]?.slug === parsed[0]?.slug && posts[0]?.meta?.title === parsed[0]?.meta?.title;
                        posts = parsed;
                        bridge.setPosts(posts);
                        syncState = { status: 'ok', reason: null, source: isRateLimited ? 'rate-limit-cache' : 'cache' };
                        if (isRateLimited) {
                            const secLeft = Math.max(0, Math.round((rateLimitReset - Date.now()) / 1000));
                            setTooltip(`Local Cache (rate-limited, ${Math.ceil(secLeft / 60)}m cooldown)`);
                        } else {
                            setTooltip(getSyncTooltipText('GitHub API'));
                        }
                        const needsRender = force || !isIdentical || !articlesList || !articlesList.querySelector('.notes-article-card');
                        if (needsRender) {
                            renderUI();
                        }
                        checkUrlForPost();
                        return;
                    }
                } catch (_) {}
            }
        }

        syncState = { status: 'syncing', reason: null, source: null };
        if (syncText) syncText.textContent = 'Sync';
        if (syncIcon) syncIcon.classList.add('fa-spin');
        if (resyncBtn) resyncBtn.classList.add('is-syncing');

        try {
            // Rate-limited with no cache: try same-origin RSS/HTML fallback before failing
            if (isRateLimited) {
                const feedPosts = await fetchStaticFeedFallback().catch(() => []);
                if (feedPosts.length > 0) {
                    feedPosts.forEach(ensurePostImage);
                    posts = feedPosts;
                    bridge.setPosts(posts);
                    postsChanged = true;
                    syncState = { status: 'ok', reason: null, source: 'static-feed' };
                    setTooltip('Static Mirror (GitHub API rate-limited)');
                    return;
                }
                const secLeft = Math.max(0, Math.round((rateLimitReset - Date.now()) / 1000));
                syncState = { status: 'error', reason: 'rate-limited', source: null };
                setTooltip(`Offline Cache (Rate-limit cooldown ${Math.ceil(secLeft / 60)}m)`);
                return;
            }

            // 2. Fetch repo tree via GitHub REST API with ETag + CORS-simple fallback
            const treeUrl = `https://api.github.com/repos/${reposOwner}/${reposName}/git/trees/main?recursive=1`;
            const reqHeaders = getGitHubHeaders();
            let cachedTreeEtag = null;
            try {
                cachedTreeEtag = localStorage.getItem('pxecore_git_tree_etag_v6');
            } catch (_) {}
            const hasLocalPosts = (posts && posts.length > 0) || (cached && cached !== '[]');
            if (cachedTreeEtag && !force && hasLocalPosts) {
                reqHeaders['If-None-Match'] = cachedTreeEtag;
            }

            const treeRes = await fetchGitHubWithCorsFallback(treeUrl, reqHeaders, Boolean(force));
            recordRateLimitTelemetry(treeRes);

            // Case A: 304 Not Modified — repo unchanged
            if (treeRes.status === 304) {
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            posts = hydratePostList(parsed);
                            bridge.setPosts(posts);
                            postsChanged = true;
                        }
                    } catch (_) {}
                }
                if (!posts || posts.length === 0) {
                    try { localStorage.removeItem('pxecore_git_tree_etag_v6'); } catch (_) {}
                    skipFinallyCheck = true;
                    return runSync(true, { bypassDebounce: true });
                }
                try {
                    localStorage.setItem('pxecore_cached_posts_timestamp_v16', Date.now().toString());
                } catch (_) {}
                syncState = { status: 'ok', reason: null, source: '304' };
                setTooltip(getSyncTooltipText('GitHub API: 304 Not Modified'));
                if (!articlesList || !articlesList.querySelector('.notes-article-card')) {
                    postsChanged = true;
                }
                return;
            }

            if (treeRes.status === 429 || (treeRes.status === 403 && (treeRes.headers.get('x-ratelimit-remaining') === '0' || treeRes.headers.get('retry-after')))) {
                const resetEpoch = treeRes.headers.get('x-ratelimit-reset');
                const retryAfter = treeRes.headers.get('retry-after');
                const resetTime = resetEpoch
                    ? parseInt(resetEpoch, 10) * 1000
                    : (retryAfter ? Date.now() + parseInt(retryAfter, 10) * 1000 : Date.now() + 15 * 60 * 1000);
                try {
                    localStorage.setItem('pxecore_ratelimit_reset_v6', resetTime.toString());
                } catch (_) {}
                throw new Error(treeRes.status === 429 ? 'SECONDARY_RATE_LIMIT_EXCEEDED' : 'RATE_LIMIT_EXCEEDED');
            }

            if (!treeRes.ok) {
                throw new Error(`TREE_HTTP_${treeRes.status}`);
            }

            const treeData = await treeRes.json();
            if (!treeData || !Array.isArray(treeData.tree)) {
                throw new Error('INVALID_TREE_STRUCTURE');
            }

            const newEtag = treeRes.headers.get('etag');
            if (newEtag) {
                try {
                    localStorage.setItem('pxecore_git_tree_etag_v6', newEtag);
                } catch (_) {}
            }

            const mdFiles = treeData.tree.filter(item =>
                item.type === 'blob' &&
                item.path &&
                item.path.startsWith(`${postsFolder}/`) &&
                item.path.endsWith('.md')
            );

            if (mdFiles.length === 0) {
                throw new Error('NO_MARKDOWN_POSTS_FOUND');
            }

            // 3. Fetch raw markdown blobs via raw.githubusercontent.com
            let storedDates = null;
            try {
                storedDates = localStorage.getItem('pxecore_commit_dates_cache_v11') || localStorage.getItem('pxecore_commit_dates_cache_v6');
            } catch (_) {}
            let dateRegistry = {};
            if (storedDates) {
                try {
                    const parsedDates = JSON.parse(storedDates);
                    if (parsedDates && typeof parsedDates === 'object' && !Array.isArray(parsedDates)) {
                        dateRegistry = parsedDates;
                    }
                } catch (_) {}
            }
            let registryUpdated = false;

            const fetchJobs = mdFiles.map(async (fileItem) => {
                const filePath = fileItem.path;
                const parts = filePath.split('/');
                const filename = parts[parts.length - 1];
                const folder = parts.length > 2 ? parts[1] : null;
                const slug = folder ? `${folder}--${filename.replace(/\.md$/i, '')}` : filename.replace(/\.md$/i, '');

                try {
                    const rawUrl = `https://raw.githubusercontent.com/${reposOwner}/${reposName}/main/${encodeURI(filePath)}`;
                    const rawRes = await fetchWithTimeout(rawUrl, force ? { cache: 'no-store' } : {});
                    if (!rawRes.ok) return null;
                    const rawText = await rawRes.text();
                    let { meta, body } = parseMarkdown(rawText, filename, folder || '');

                    if (folder && !meta.category) {
                        meta.category = folder.toUpperCase();
                    }
                    meta.folder = folder || undefined;

                    return {
                        slug,
                        filename,
                        filePath,
                        folder: folder || undefined,
                        meta,
                        content: body,
                        rawContent: rawText
                    };
                } catch (_) {
                    return null;
                }
            });

            const results = await Promise.all(fetchJobs);
            const seenSlugs = new Set();
            const fetchedPosts = results.filter(p => {
                if (!p || !p.slug || typeof p.content !== 'string') return false;
                if (seenSlugs.has(p.slug)) return false;
                seenSlugs.add(p.slug);
                return true;
            });

            if (fetchedPosts.length > 0) {
                let repoLatestDate = null;
                if (fetchedPosts.some(p => !p.meta.date && !dateRegistry[p.filePath])) {
                    try {
                        const commitRes = await fetchGitHubWithCorsFallback(
                            `https://api.github.com/repos/${reposOwner}/${reposName}/commits?per_page=1`,
                            getGitHubHeaders(),
                            false
                        );
                        recordRateLimitTelemetry(commitRes);
                        if (commitRes.ok) {
                            const commits = await commitRes.json();
                            if (Array.isArray(commits) && commits.length > 0) {
                                repoLatestDate = commits[0].commit?.committer?.date?.slice(0, 10) ||
                                                 commits[0].commit?.author?.date?.slice(0, 10);
                            }
                        }
                    } catch (_) {}
                }
                fetchedPosts.forEach(p => {
                    if (p.meta.date) {
                        dateRegistry[p.filePath] = p.meta.date;
                        registryUpdated = true;
                    } else if (dateRegistry[p.filePath]) {
                        p.meta.date = dateRegistry[p.filePath];
                    } else if (repoLatestDate) {
                        p.meta.date = repoLatestDate;
                        dateRegistry[p.filePath] = repoLatestDate;
                        registryUpdated = true;
                    } else {
                        p.meta.date = new Date().toISOString().slice(0, 10);
                    }
                    delete p.filePath;
                });
                if (registryUpdated) {
                    try {
                        localStorage.setItem('pxecore_commit_dates_cache_v11', JSON.stringify(dateRegistry));
                    } catch (_) {}
                }
                fetchedPosts.forEach(ensurePostImage);
                posts = fetchedPosts;
                bridge.setPosts(posts);
                postsChanged = true;
                syncState = { status: 'ok', reason: null, source: 'github' };
                try {
                    localStorage.setItem('pxecore_cached_posts_v16', JSON.stringify(posts));
                    localStorage.setItem('pxecore_cached_posts_timestamp_v16', Date.now().toString());
                } catch (_) {}
                setTooltip(getSyncTooltipText('GitHub API: Live Sync'));
            } else {
                throw new Error('NO_VALID_POSTS_PARSED');
            }
        } catch (err) {
            lastManualSyncAt = 0;
            const msg = String(err && err.message ? err.message : '');
            if (msg !== 'RATE_LIMIT_EXCEEDED' && msg !== 'SECONDARY_RATE_LIMIT_EXCEEDED') {
                console.debug && console.debug('[Notes] Sync fallback triggered:', msg || err);
            }

            // Fallback 1: stale/existing localStorage cache (re-read in case cache landed mid-flight)
            let recovered = false;
            let latestCached = cached;
            try { latestCached = localStorage.getItem('pxecore_cached_posts_v16') || cached; } catch (_) {}
            if (latestCached) {
                try {
                    const parsed = JSON.parse(latestCached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        hydratePostList(parsed);
                        if (!posts || posts.length !== parsed.length || posts[0]?.meta?.title !== parsed[0]?.meta?.title) {
                            posts = parsed;
                            bridge.setPosts(posts);
                            postsChanged = true;
                        }
                        recovered = true;
                        syncState = { status: 'ok', reason: null, source: 'stale-cache' };
                    }
                } catch (_) {}
            }

            // Fallback 2: Same-origin RSS + prebuilt HTML notes (works without GitHub API quota!)
            if (!recovered) {
                try {
                    const feedPosts = await fetchStaticFeedFallback();
                    if (feedPosts.length > 0) {
                        feedPosts.forEach(ensurePostImage);
                        posts = feedPosts;
                        bridge.setPosts(posts);
                        postsChanged = true;
                        recovered = true;
                        syncState = { status: 'ok', reason: null, source: 'static-feed' };
                        setTooltip('Static Mirror (RSS / HTML fallback)');
                    }
                } catch (_) {}
            }

            if (!recovered) {
                const isRateErr = msg === 'RATE_LIMIT_EXCEEDED' || msg === 'SECONDARY_RATE_LIMIT_EXCEEDED';
                const isFileSandbox = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
                syncState = {
                    status: 'error',
                    reason: isRateErr ? 'rate-limited' : (isFileSandbox ? 'file-origin-blocked' : 'network-error'),
                    source: null
                };
                postsChanged = true;
            }

            if (!recovered || syncState.source === 'stale-cache') {
                let rReset = 0;
                try {
                    rReset = parseInt(localStorage.getItem('pxecore_ratelimit_reset_v6') || '0', 10);
                } catch (_) {}
                if (Date.now() < rReset) {
                    const secLeft = Math.max(0, Math.round((rReset - Date.now()) / 1000));
                    setTooltip(`Local Cache (API Rate-Limited, cooldown ${Math.ceil(secLeft / 60)}m)`);
                } else {
                    setTooltip(getSyncTooltipText(recovered ? 'Local Cache' : 'Sync Unavailable'));
                }
            }
        } finally {
            if (syncIcon) syncIcon.classList.remove('fa-spin');
            if (resyncBtn) resyncBtn.classList.remove('is-syncing');
            if (!skipFinallyCheck) {
                if (postsChanged || !articlesList || !articlesList.querySelector('.notes-article-card')) {
                    renderUI();
                }
                checkUrlForPost();
            }
        }
    }

    return {
        getGitHubHeaders,
        recordRateLimitTelemetry,
        getApiTelemetry,
        getSyncTooltipText,
        getSyncState,
        syncFromGitHub
    };
};
