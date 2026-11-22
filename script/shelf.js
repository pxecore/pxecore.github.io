/**
 * pxecore — Personal Shelf (Bookshelf & Films/Series Watchlist)
 * Lazy-mounted when #books, #cinema, or #shelf is activated.
 */
(function (window) {
    'use strict';

    const SHELF_DATA = window.PXECORE_SHELF || { books: [], watchlist: [] };
    const BOOKS = Array.isArray(SHELF_DATA.books) ? SHELF_DATA.books : [];
    const WATCHLIST = Array.isArray(SHELF_DATA.watchlist) ? SHELF_DATA.watchlist : [];

    const HEIGHT_CYCLE = [244, 232, 250, 256, 240, 248, 236, 254, 242, 246];
    let isMounted = false;

    function createSvgIcon(kind) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.4');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('shelf-cover-emblem');

        if (kind === 'book') {
            const p1 = document.createElementNS(ns, 'path');
            p1.setAttribute('d', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
            const p2 = document.createElementNS(ns, 'path');
            p2.setAttribute('d', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z');
            svg.appendChild(p1);
            svg.appendChild(p2);
        } else if (kind === 'series') {
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', '2');
            rect.setAttribute('y', '7');
            rect.setAttribute('width', '20');
            rect.setAttribute('height', '15');
            rect.setAttribute('rx', '2');
            const poly = document.createElementNS(ns, 'polyline');
            poly.setAttribute('points', '17 2 12 7 7 2');
            svg.appendChild(rect);
            svg.appendChild(poly);
        } else {
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', '2');
            rect.setAttribute('y', '3');
            rect.setAttribute('width', '20');
            rect.setAttribute('height', '18');
            rect.setAttribute('rx', '2');
            const line1 = document.createElementNS(ns, 'line');
            line1.setAttribute('x1', '7'); line1.setAttribute('y1', '3');
            line1.setAttribute('x2', '7'); line1.setAttribute('y2', '21');
            const line2 = document.createElementNS(ns, 'line');
            line2.setAttribute('x1', '17'); line2.setAttribute('y1', '3');
            line2.setAttribute('x2', '17'); line2.setAttribute('y2', '21');
            svg.appendChild(rect);
            svg.appendChild(line1);
            svg.appendChild(line2);
        }
        return svg;
    }

    function padTwo(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function isSafeCoverUrl(url) {
        if (typeof url !== 'string' || !url) return false;
        return /^https:\/\/[^\s]+$/i.test(url) || /^media\/[a-zA-Z0-9_./-]+$/.test(url);
    }

    function shortSurname(name) {
        const parts = String(name || '').trim().split(/\s+/);
        return (parts[parts.length - 1] || '').toUpperCase().slice(0, 10);
    }

    function buildSection(cfg) {
        const section = document.createElement('section');
        section.className = 'shelf-section';
        section.id = cfg.id;
        section.setAttribute('data-mode', cfg.mode || 'books');
        section.setAttribute('aria-label', cfg.heading);

        // Top meta row
        const metaRow = document.createElement('div');
        metaRow.className = 'shelf-meta-row';
        const leftMeta = document.createElement('span');
        leftMeta.textContent = cfg.kicker;
        const rightMeta = document.createElement('span');
        rightMeta.textContent = `no. 001–${String(cfg.items.length).padStart(3, '0')}`;
        metaRow.appendChild(leftMeta);
        metaRow.appendChild(rightMeta);

        // Title + subtitle
        const h2 = document.createElement('h2');
        h2.className = 'shelf-heading';
        h2.textContent = cfg.heading;
        const dot = document.createElement('span');
        dot.className = 'shelf-heading-dot';
        dot.textContent = '.';
        h2.appendChild(dot);

        const sub = document.createElement('p');
        sub.className = 'shelf-subtitle';
        sub.textContent = cfg.subtitle;

        // Controls (filters + arrows)
        const controls = document.createElement('div');
        controls.className = 'shelf-controls';
        const filtersEl = document.createElement('div');
        filtersEl.className = 'shelf-filters';

        const arrowsEl = document.createElement('div');
        arrowsEl.className = 'shelf-arrows';
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'shelf-arrow-btn';
        prevBtn.setAttribute('aria-label', `Previous ${cfg.id}`);
        prevBtn.textContent = '←';
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'shelf-arrow-btn';
        nextBtn.setAttribute('aria-label', `Next ${cfg.id}`);
        nextBtn.textContent = '→';
        arrowsEl.appendChild(prevBtn);
        arrowsEl.appendChild(nextBtn);

        controls.appendChild(filtersEl);
        controls.appendChild(arrowsEl);

        // Stage + Multi-Row Track Container
        const stage = document.createElement('div');
        stage.className = 'shelf-stage';
        stage.setAttribute('role', 'listbox');
        stage.setAttribute('aria-label', cfg.heading);

        // Scrubber
        const scrubWrap = document.createElement('div');
        scrubWrap.className = 'shelf-scrubber-wrap';
        const scrubber = document.createElement('input');
        scrubber.type = 'range';
        scrubber.className = 'shelf-scrubber';
        scrubber.min = '0';
        scrubber.value = '0';
        scrubber.setAttribute('aria-label', `Scroll ${cfg.heading}`);
        scrubWrap.appendChild(scrubber);

        // Detail Bar
        const detailBar = document.createElement('div');
        detailBar.className = 'shelf-detail-bar';
        const detailMain = document.createElement('div');
        detailMain.className = 'shelf-detail-main';
        const detailNum = document.createElement('span');
        detailNum.className = 'shelf-detail-num';
        const detailTitle = document.createElement('span');
        detailTitle.className = 'shelf-detail-title';
        const detailCreator = document.createElement('span');
        detailCreator.className = 'shelf-detail-creator';
        detailMain.appendChild(detailNum);
        detailMain.appendChild(detailTitle);
        detailMain.appendChild(detailCreator);

        const detailStatus = document.createElement('span');
        detailStatus.className = 'shelf-detail-status';
        detailBar.appendChild(detailMain);
        detailBar.appendChild(detailStatus);

        const detailNote = document.createElement('p');
        detailNote.className = 'shelf-detail-note';

        section.appendChild(metaRow);
        section.appendChild(h2);
        section.appendChild(sub);
        section.appendChild(controls);
        section.appendChild(stage);
        section.appendChild(scrubWrap);
        section.appendChild(detailBar);
        section.appendChild(detailNote);

        // State
        let activeFilter = 'all';
        let filtered = cfg.items.slice();
        let activeIdx = Math.max(0, cfg.items.findIndex(it => it.status === cfg.defaultFocusStatus));
        if (activeIdx === -1) activeIdx = 0;

        function renderFilters() {
            filtersEl.textContent = '';
            cfg.filters.forEach((f) => {
                const count = f === 'all' ? cfg.items.length : cfg.items.filter(it => it.status === f).length;
                if (f !== 'all' && count === 0) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'shelf-filter-btn' + (activeFilter === f ? ' is-active' : '');
                if (f !== 'all') {
                    const fDot = document.createElement('span');
                    fDot.className = 'shelf-filter-dot';
                    btn.appendChild(fDot);
                }
                const label = document.createElement('span');
                label.textContent = f;
                const cnt = document.createElement('span');
                cnt.className = 'shelf-filter-count';
                cnt.textContent = padTwo(count);
                btn.appendChild(label);
                btn.appendChild(cnt);

                btn.addEventListener('click', () => {
                    if (activeFilter === f) return;
                    activeFilter = f;
                    filtered = f === 'all' ? cfg.items.slice() : cfg.items.filter(it => it.status === f);
                    activeIdx = 0;
                    renderFilters();
                    renderItems();
                });
                filtersEl.appendChild(btn);
            });
        }

        function ensureCoverLoaded(btn, highPriority = false) {
            const img = btn && btn.querySelector('img[data-src]');
            if (!img) return;
            if (highPriority) img.fetchPriority = 'high';
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        }

        function updateSelection(scrollIntoView = true) {
            const buttons = stage.querySelectorAll('.shelf-item');
            buttons.forEach((b, idx) => {
                const active = idx === activeIdx;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
                if (active) {
                    ensureCoverLoaded(b, true);
                    if (scrollIntoView) {
                        b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }
            });

            const item = filtered[activeIdx];
            scrubber.max = String(Math.max(0, filtered.length - 1));
            scrubber.value = String(activeIdx);
            prevBtn.disabled = activeIdx <= 0;
            nextBtn.disabled = activeIdx >= filtered.length - 1;

            if (!item) {
                detailNum.textContent = '00';
                detailTitle.textContent = 'empty';
                detailCreator.textContent = '';
                detailStatus.textContent = activeFilter;
                detailNote.textContent = '';
                return;
            }

            const origIdx = cfg.items.indexOf(item) + 1;
            detailNum.textContent = padTwo(origIdx);
            detailTitle.textContent = item.title;
            detailCreator.textContent = `${item.creator} · ${item.year}`;
            detailStatus.textContent = (item.kind && item.kind !== 'book' ? `${item.kind} · ` : '') + item.status;
            detailNote.textContent = item.note || '';
            detailNote.hidden = !item.note;
        }

        function getPerShelf() {
            const w = window.innerWidth;
            if (w <= 640) return Math.max(1, filtered.length);
            if (w <= 860) return cfg.mode === 'cinema' ? 12 : 10;
            return cfg.mode === 'cinema' ? 16 : 14;
        }

        function renderItems() {
            stage.textContent = '';
            const perShelf = getPerShelf();

            for (let start = 0; start < Math.max(1, filtered.length); start += perShelf) {
                const slice = filtered.slice(start, start + perShelf);
                const rowWrap = document.createElement('div');
                rowWrap.className = 'shelf-row';
                const track = document.createElement('div');
                track.className = 'shelf-track';

                slice.forEach((item, localIdx) => {
                    const idx = start + localIdx;
                const origIdx = cfg.items.indexOf(item) + 1;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'shelf-item';
                btn.setAttribute('role', 'option');
                btn.style.setProperty('--item-bg', item.color || '#2B241E');
                btn.style.setProperty('--item-h', HEIGHT_CYCLE[origIdx % HEIGHT_CYCLE.length] + 'px');

                // Spine
                const spine = document.createElement('span');
                spine.className = 'shelf-spine';
                const sTitle = document.createElement('span');
                sTitle.className = 'shelf-spine-title';
                sTitle.textContent = item.title;
                const sMeta = document.createElement('span');
                sMeta.className = 'shelf-spine-meta';
                const sAuthor = document.createElement('span');
                sAuthor.className = 'shelf-spine-author';
                sAuthor.textContent = shortSurname(item.creator);
                const sNum = document.createElement('span');
                sNum.className = 'shelf-spine-num';
                sNum.textContent = padTwo(origIdx);
                sMeta.appendChild(sAuthor);
                sMeta.appendChild(sNum);
                spine.appendChild(sTitle);
                spine.appendChild(sMeta);

                // Cover
                const cover = document.createElement('span');
                cover.className = 'shelf-cover';
                const cTop = document.createElement('span');
                cTop.className = 'shelf-cover-top';
                const cCreator = document.createElement('span');
                cCreator.textContent = shortSurname(item.creator);
                const cYear = document.createElement('span');
                cYear.textContent = item.year;
                cTop.appendChild(cCreator);
                cTop.appendChild(cYear);

                const cArt = document.createElement('span');
                cArt.className = 'shelf-cover-art';
                const rawCover = item.cover || (item.isbn ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(item.isbn)}-M.jpg?default=false` : '');
                const coverUrl = isSafeCoverUrl(rawCover) ? rawCover : '';
                if (coverUrl) {
                    const img = document.createElement('img');
                    img.dataset.src = coverUrl;
                    img.alt = item.title;
                    img.width = 170;
                    img.height = 260;
                    img.decoding = 'async';
                    img.referrerPolicy = 'no-referrer';
                    img.addEventListener('load', () => {
                        btn.classList.add('has-cover-img');
                    }, { once: true });
                    img.addEventListener('error', () => {
                        btn.classList.remove('has-cover-img');
                        cArt.textContent = '';
                        cArt.appendChild(createSvgIcon(item.kind || 'book'));
                    }, { once: true });
                    cArt.appendChild(img);
                    btn.addEventListener('pointerenter', () => ensureCoverLoaded(btn), { once: true });
                    btn.addEventListener('focus', () => ensureCoverLoaded(btn), { once: true });
                } else {
                    cArt.appendChild(createSvgIcon(item.kind || 'book'));
                }

                const cBottom = document.createElement('span');
                cBottom.className = 'shelf-cover-bottom';
                const cTitle = document.createElement('span');
                cTitle.className = 'shelf-cover-title';
                cTitle.textContent = item.title;
                const cFoot = document.createElement('span');
                cFoot.className = 'shelf-cover-foot';
                const cKind = document.createElement('span');
                cKind.textContent = item.kind || 'book';
                const cNum = document.createElement('span');
                cNum.textContent = `${padTwo(origIdx)} / ${padTwo(cfg.items.length)}`;
                cFoot.appendChild(cKind);
                cFoot.appendChild(cNum);
                cBottom.appendChild(cTitle);
                cBottom.appendChild(cFoot);

                cover.appendChild(cTop);
                cover.appendChild(cArt);
                cover.appendChild(cBottom);

                if (cfg.mode === 'cinema') {
                    const shutter = document.createElement('span');
                    shutter.className = 'shelf-floppy-shutter';
                    shutter.setAttribute('aria-hidden', 'true');
                    const notch = document.createElement('span');
                    notch.className = 'shelf-floppy-notch';
                    notch.setAttribute('aria-hidden', 'true');
                    btn.appendChild(shutter);
                    btn.appendChild(notch);
                }

                btn.appendChild(spine);
                btn.appendChild(cover);

                    btn.addEventListener('click', () => {
                        activeIdx = idx;
                        updateSelection(true);
                    });

                    track.appendChild(btn);
                });

                const ledge = document.createElement('div');
                ledge.className = 'shelf-ledge';
                ledge.setAttribute('aria-hidden', 'true');
                rowWrap.appendChild(track);
                rowWrap.appendChild(ledge);
                stage.appendChild(rowWrap);
                if (filtered.length === 0) break;
            }

            updateSelection(false);
        }

        prevBtn.addEventListener('click', () => {
            if (activeIdx > 0) {
                activeIdx--;
                updateSelection(true);
            }
        });

        nextBtn.addEventListener('click', () => {
            if (activeIdx < filtered.length - 1) {
                activeIdx++;
                updateSelection(true);
            }
        });

        scrubber.addEventListener('input', () => {
            const next = parseInt(scrubber.value, 10);
            if (!isNaN(next) && next !== activeIdx) {
                activeIdx = Math.max(0, Math.min(filtered.length - 1, next));
                updateSelection(true);
            }
        });

        stage.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && activeIdx > 0) {
                e.preventDefault();
                activeIdx--;
                updateSelection(true);
            } else if (e.key === 'ArrowRight' && activeIdx < filtered.length - 1) {
                e.preventDefault();
                activeIdx++;
                updateSelection(true);
            }
        });

        let lastWheelStep = 0;
        stage.addEventListener('wheel', (e) => {
            const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            if (Math.abs(delta) < 8) return;
            if (delta > 0 && activeIdx < filtered.length - 1) {
                e.preventDefault();
                const now = performance.now();
                if (now - lastWheelStep < 110) return;
                lastWheelStep = now;
                activeIdx++;
                updateSelection(true);
            } else if (delta < 0 && activeIdx > 0) {
                e.preventDefault();
                const now = performance.now();
                if (now - lastWheelStep < 110) return;
                lastWheelStep = now;
                activeIdx--;
                updateSelection(true);
            }
        }, { passive: false });

        let lastPerShelf = getPerShelf();
        let resizeTimer = 0;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const nextPerShelf = getPerShelf();
                if (nextPerShelf !== lastPerShelf) {
                    lastPerShelf = nextPerShelf;
                    renderItems();
                }
            }, 160);
        }, { passive: true });

        renderFilters();
        renderItems();
        return section;
    }

    function mount(focusTarget) {
        const root = document.getElementById('shelf-root');
        if (!root) return;

        if (!isMounted) {
            isMounted = true;
            root.textContent = '';

            // Top bar inside shelf view
            const navBar = document.createElement('div');
            navBar.className = 'shelf-nav-bar';

            const backLink = document.createElement('a');
            backLink.href = '#resume';
            backLink.className = 'shelf-back-btn';
            backLink.textContent = '← resume';
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.switchView === 'function') {
                    window.switchView('resume', true);
                }
            });

            const jumpLinks = document.createElement('div');
            jumpLinks.className = 'shelf-jump-links';
            const booksJump = document.createElement('a');
            booksJump.href = '#books';
            booksJump.className = 'shelf-jump-link';
            booksJump.textContent = '/ books';
            const cinemaJump = document.createElement('a');
            cinemaJump.href = '#cinema';
            cinemaJump.className = 'shelf-jump-link';
            cinemaJump.textContent = '/ cinema';
            jumpLinks.appendChild(booksJump);
            jumpLinks.appendChild(cinemaJump);

            navBar.appendChild(backLink);
            navBar.appendChild(jumpLinks);
            root.appendChild(navBar);

            root.appendChild(buildSection({
                id: 'shelf-books',
                mode: 'books',
                kicker: 'reading log',
                heading: 'bookshelf',
                subtitle: 'books i am reading or finished.',
                items: BOOKS,
                filters: ['all', 'reading', 'read', 'next'],
                defaultFocusStatus: 'read'
            }));

            root.appendChild(buildSection({
                id: 'shelf-cinema',
                mode: 'cinema',
                kicker: 'films & series',
                heading: 'watchlist',
                subtitle: 'things i have watched or want to watch.',
                items: WATCHLIST,
                filters: ['all', 'watching', 'watched', 'queued'],
                defaultFocusStatus: 'watched'
            }));
        }

        const links = root.querySelectorAll('.shelf-jump-link');
        links.forEach((l) => {
            const target = l.getAttribute('href').replace('#', '');
            l.classList.toggle('is-active', target === (focusTarget || 'books'));
        });

        if (focusTarget === 'cinema') {
            const el = document.getElementById('shelf-cinema');
            if (el) {
                requestAnimationFrame(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
        }
    }

    window.pxecore = window.pxecore || {};
    window.pxecore.shelf = { mount };
})(window);
