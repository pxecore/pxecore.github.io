// Force-directed knowledge graph renderer for Research Notes.
window.pxecore = window.pxecore || {};
window.pxecore.QuartzGraphEngine = (function () {
    // Force-Directed Graph Engine
    class QuartzGraphEngine {
        constructor(svgEl, containerEl, isExpanded, options = {}) {
            this.svg = svgEl;
            this.container = containerEl;
            this.isExpanded = isExpanded;
            this.options = options;
            this.nodes = [];
            this.edges = [];
            this.nodeMap = new Map();
            this.viewport = { x: 0, y: 0, k: 1 };
            this.alpha = 1.0;
            this.hoveredNodeId = null;
            this.draggedNode = null;
            this.dragStartPos = null;
            this.mousePos = null;
            this.isPanning = false;
            this.lastPanPos = { x: 0, y: 0 };
            this.animFrameId = null;
            const dims = this.getFallbackDims();
            this.width = dims.width;
            this.height = dims.height;
            this.posts = [];
            this.isSimulating = false;

            // SVG DOM layers are initialized on-demand in rebuildGraph()
            this.initEvents();

            if (!this.isExpanded && this.container && typeof ResizeObserver !== 'undefined') {
                this._resizeRaf = null;
                this._resizeObserver = new ResizeObserver(() => {
                    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
                    this._resizeRaf = requestAnimationFrame(() => {
                        this._resizeRaf = null;
                        this.resize();
                    });
                });
                this._resizeObserver.observe(this.container);
            }
        }

        getFallbackDims() {
            return {
                width: this.isExpanded ? 1000 : 228,
                height: this.isExpanded ? 600 : 320
            };
        }

        initSvgDom() {
            if (!this.svg) return;
            this.svg.innerHTML = `
                <g class="quartz-viewport-layer">
                    <g class="quartz-edges-layer"></g>
                    <g class="quartz-nodes-layer"></g>
                </g>
            `;
            this.viewportLayer = this.svg.querySelector('.quartz-viewport-layer');
            this.edgesLayer = this.svg.querySelector('.quartz-edges-layer');
            this.nodesLayer = this.svg.querySelector('.quartz-nodes-layer');
        }

        setPosts(postList) {
            const list = postList || [];
            if (this.posts && this.posts.length === list.length && this.nodes && this.nodes.length > 0) {
                let same = true;
                for (let i = 0; i < list.length; i++) {
                    const prev = this.posts[i];
                    const next = list[i];
                    if (prev?.slug !== next?.slug ||
                        (prev?.meta?.title || '') !== (next?.meta?.title || '') ||
                        (prev?.meta?.tags || []).join(',') !== (next?.meta?.tags || []).join(',')) {
                        same = false;
                        break;
                    }
                }
                if (same) return;
            }
            this.posts = list;
            this.resize(true);
        }

        resize(forceRebuild = false) {
            if (this.container) {
                const rect = this.container.getBoundingClientRect();
                if (rect.width > 50 && rect.height > 50) {
                    const widthChanged = Math.abs(this.width - rect.width) > 2;
                    const heightChanged = Math.abs(this.height - rect.height) > 2;
                    if (!widthChanged && !heightChanged && !forceRebuild && this.nodes && this.nodes.length > 0) {
                        return;
                    }
                    this.width = rect.width;
                    this.height = rect.height;
                    if (!this.isExpanded && (widthChanged || heightChanged)) {
                        this.viewport = { x: 0, y: 0, k: 1 };
                        this.updateViewportTransform();
                    }
                } else if (!this.width || !this.height) {
                    const dims = this.getFallbackDims();
                    this.width = dims.width;
                    this.height = dims.height;
                } else if (!forceRebuild && this.nodes && this.nodes.length > 0) {
                    return; // Container is hidden and nodes are already pre-warmed
                }
            } else if (!forceRebuild && this.nodes && this.nodes.length > 0) {
                return;
            }
            this.rebuildGraph();
        }

        rebuildGraph() {
            if (!this.viewportLayer) {
                this.initSvgDom();
            }
            if (!this.posts || this.posts.length === 0) {
                if (this.edgesLayer) this.edgesLayer.innerHTML = '';
                if (this.nodesLayer) this.nodesLayer.innerHTML = '';
                this.nodes = [];
                this.edges = [];
                this.nodeMap = new Map();
                return;
            }

            const fallback = this.getFallbackDims();
            const width = this.width || fallback.width;
            const height = this.height || fallback.height;
            if (this.svg) {
                this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
                this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            }
            const cX = width / 2;
            const cY = height / 2;
            const isExpanded = this.isExpanded;

            const noiseKeywords = new Set([
                'include','define','pragma','import','ifdef','ifndef','endif','else','error','undef',
                'function','class','const','let','var','return','void','public','private','protected',
                'null','undefined','true','false','struct','int','char','float','double','bool','all'
            ]);

            // Cap nodes and tags in the compact sidebar preview
            let postsToUse = this.posts;
            let maxTags = Infinity;
            if (!isExpanded) {
                const MAX_INLINE_POSTS = 7;
                const MAX_INLINE_TAGS = 9;
                postsToUse = this.posts.slice(0, MAX_INLINE_POSTS);
                maxTags = MAX_INLINE_TAGS;
            }

            const postTagMap = new Map();
            const tagPostCount = new Map();

            postsToUse.forEach(post => {
                const rawTags = (post.meta?.tags || []).map(t => t.toLowerCase());
                const content = post.content || '';
                const hashMatches = content.match(/#([a-zA-Z][a-zA-Z0-9_\-]{1,29})/g) || [];
                const inline = hashMatches.map(h => h.slice(1).toLowerCase());
                const combined = Array.from(new Set([...rawTags, ...inline])).filter(t => t.length > 1 && !noiseKeywords.has(t));
                postTagMap.set(post.slug, combined);
                combined.forEach(t => {
                    const tagId = `tag-${t}`;
                    tagPostCount.set(tagId, (tagPostCount.get(tagId) || 0) + 1);
                });
            });

            // Rank tags by connection frequency and take top hub topics
            let allTags = Array.from(tagPostCount.keys()).map(id => id.slice(4));
            allTags.sort((a, b) => {
                const countDiff = (tagPostCount.get(`tag-${b}`) || 0) - (tagPostCount.get(`tag-${a}`) || 0);
                if (countDiff !== 0) return countDiff;
                return a.length - b.length;
            });

            const selectedTags = !isExpanded ? allTags.slice(0, maxTags) : allTags;
            const selectedTagSet = new Set(selectedTags);

            const nodesList = [];
            const edgesList = [];

            // 1. Initial Tag Cluster Placement (Aspect-ratio matched ellipse)
            const rx = width * (isExpanded ? 0.38 : 0.34);
            const ry = height * (isExpanded ? 0.38 : 0.32);
            selectedTags.forEach((tag, i) => {
                const tagId = `tag-${tag}`;
                const count = tagPostCount.get(tagId) || 1;
                const angle = (i / Math.max(1, selectedTags.length)) * Math.PI * 2 - Math.PI / 2;
                const tx = cX + Math.cos(angle) * rx;
                const ty = cY + Math.sin(angle) * ry;

                const size = isExpanded
                    ? (5.2 + Math.min(count * 0.7, 3.8))
                    : (3.8 + Math.min(count * 0.5, 2.2));

                nodesList.push({
                    id: tagId,
                    label: tag,
                    type: 'tag',
                    tagVal: tag,
                    x: tx,
                    y: ty,
                    vx: 0,
                    vy: 0,
                    size,
                    connections: count
                });
            });

            // 2. Initial Blog Nodes Placement Orbiting Their Primary Tag
            postsToUse.forEach((post, i) => {
                const tags = (postTagMap.get(post.slug) || []).filter(t => selectedTagSet.has(t));
                const primaryTagId = tags.length > 0 ? `tag-${tags[0]}` : null;
                const primaryTagNode = primaryTagId ? nodesList.find(n => n.id === primaryTagId) : null;

                const angle = i * 2.39996;
                const branchDist = isExpanded ? 135 : 44;
                const sx = primaryTagNode
                    ? primaryTagNode.x + Math.cos(angle) * branchDist
                    : cX + Math.cos(angle) * (rx * 0.55);
                const sy = primaryTagNode
                    ? primaryTagNode.y + Math.sin(angle) * branchDist
                    : cY + Math.sin(angle) * (ry * 0.55);

                const size = isExpanded
                    ? (4.2 + Math.min((tags.length || 1) * 0.6, 2.8))
                    : (3.2 + Math.min((tags.length || 1) * 0.4, 1.8));

                nodesList.push({
                    id: post.slug,
                    label: post.meta?.title || post.slug,
                    type: 'post',
                    slug: post.slug,
                    x: sx,
                    y: sy,
                    vx: 0,
                    vy: 0,
                    size,
                    connections: tags.length
                });

                tags.forEach(tag => {
                    edgesList.push({ source: `tag-${tag}`, target: post.slug });
                });
            });

            // 3. Pre-relax layout in memory before rendering SVG
            const preSteps = isExpanded ? 36 : 34;
            const nodeMap = new Map();
            nodesList.forEach(n => nodeMap.set(n.id, n));
            this.nodeMap = nodeMap;

            for (let step = 0; step < preSteps; step++) {
                this.stepPhysics({
                    nodes: nodesList,
                    edges: edgesList,
                    nodeMap,
                    width,
                    height,
                    cX,
                    cY,
                    gravity: isExpanded ? 0.0020 : 0.005,
                    charge: isExpanded ? 2800 : 720,
                    repelMargin: isExpanded ? 82 : 32,
                    repelSlope: isExpanded ? 0.25 : 0.20,
                    linkLen: isExpanded ? 175 : 52,
                    linkK: isExpanded ? 0.032 : 0.055,
                    tagWeight: 0.3,
                    postWeight: 0.7,
                    useUnifiedEdgeWeight: true,
                    stepScale: 0.65,
                    damping: 0.78,
                    padFixed: isExpanded ? 38 : 16,
                    maxSpeed: Infinity,
                    bounce: 0
                });
            }

            this.nodes = nodesList;
            this.edges = edgesList;

            this.mountDomElements();
            this.viewport = { x: 0, y: 0, k: 1 };
            this.updateViewportTransform();
            this.alpha = isExpanded ? 1.0 : 0.20;
            this.startSimulation();
        }

        stepPhysics(opts) {
            const {
                nodes, edges, nodeMap, width, height, cX, cY,
                gravity, charge, repelMargin, repelSlope,
                linkLen, linkK, useUnifiedEdgeWeight,
                stepScale, damping, padFixed, maxSpeed, bounce,
                floatPhase
            } = opts;
            const draggedId = this.draggedNode ? this.draggedNode.id : null;

            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (n.id === draggedId) continue;
                n.vx += (cX - n.x) * gravity;
                n.vy += (cY - n.y) * gravity;
            }

            for (let i = 0; i < nodes.length; i++) {
                const na = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const nb = nodes[j];
                    const dx = nb.x - na.x;
                    const dy = nb.y - na.y;
                    const d2 = dx * dx + dy * dy || 1;
                    const d = Math.sqrt(d2);
                    const minDist = na.size + nb.size + repelMargin;
                    let f = charge / (d2 + (useUnifiedEdgeWeight ? 40 : 50));
                    if (d < minDist) {
                        f += (minDist - d) * repelSlope;
                    }
                    const fx = (dx / d) * f;
                    let fy = (dy / d) * f;
                    // Anisotropic label-band clearance in expanded view so horizontal labels never collide with neighbor circles
                    if (repelMargin >= 60 && Math.abs(dy) < 22 && Math.abs(dx) < 130) {
                        const nudgeDir = dy >= 0 ? 1 : -1;
                        fy += nudgeDir * 0.45;
                    }
                    if (na.id !== draggedId) { na.vx -= fx; na.vy -= fy; }
                    if (nb.id !== draggedId) { nb.vx += fx; nb.vy += fy; }
                }
            }

            for (let i = 0; i < edges.length; i++) {
                const edge = edges[i];
                const na = nodeMap.get(edge.source);
                const nb = nodeMap.get(edge.target);
                if (!na || !nb) continue;
                const dx = nb.x - na.x;
                const dy = nb.y - na.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = (d - linkLen) * linkK;
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                const wA = useUnifiedEdgeWeight ? 0.3 : (na.type === 'tag' ? 0.25 : 0.75);
                const wB = useUnifiedEdgeWeight ? 0.7 : (nb.type === 'tag' ? 0.25 : 0.75);
                if (na.id !== draggedId) { na.vx += fx * wA; na.vy += fy * wA; }
                if (nb.id !== draggedId) { nb.vx -= fx * wB; nb.vy -= fy * wB; }
            }

            if (floatPhase) {
                const { time, amp } = floatPhase;
                for (let idx = 0; idx < nodes.length; idx++) {
                    const node = nodes[idx];
                    if (node.id === draggedId) continue;
                    node.vx += Math.sin(time + idx * 0.7) * amp;
                    node.vy += Math.cos(time - idx * 0.6) * amp;
                }
            }

            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (n.id === draggedId && this.mousePos) {
                    n.x = this.mousePos.graphX;
                    n.y = this.mousePos.graphY;
                    n.vx = 0;
                    n.vy = 0;
                    continue;
                }
                if (maxSpeed < Infinity) {
                    const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
                    if (sp > maxSpeed) {
                        n.vx = (n.vx / sp) * maxSpeed;
                        n.vy = (n.vy / sp) * maxSpeed;
                    }
                }
                n.x += n.vx * stepScale;
                n.y += n.vy * stepScale;
                n.vx *= damping;
                n.vy *= damping;
                const pad = padFixed !== null ? padFixed : (n.size + (this.isExpanded ? 30 : 16));
                if (n.x < pad) { n.x = pad; n.vx = bounce ? Math.abs(n.vx) * bounce : 0; }
                if (n.x > width - pad) { n.x = width - pad; n.vx = bounce ? -Math.abs(n.vx) * bounce : 0; }
                if (n.y < pad) { n.y = pad; n.vy = bounce ? Math.abs(n.vy) * bounce : 0; }
                if (n.y > height - pad) { n.y = height - pad; n.vy = bounce ? -Math.abs(n.vy) * bounce : 0; }
            }
        }

        mountDomElements() {
            if (!this.edgesLayer || !this.nodesLayer) return;
            this.edgesLayer.innerHTML = '';
            this.nodesLayer.innerHTML = '';

            // Create Edge DOM Lines
            this.edges.forEach(edge => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('class', 'notes-mindmap-edge-line');
                line.setAttribute('stroke-width', this.isExpanded ? '1.0' : '0.8');
                line.setAttribute('stroke-linecap', 'round');
                this.edgesLayer.appendChild(line);
                edge.lineEl = line;
            });

            // Create Node DOM Groups
            this.nodes.forEach(node => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('class', 'quartz-node');
                g.setAttribute('data-id', node.id);
                g.style.cursor = 'grab';

                // Hover/active ring
                const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                halo.setAttribute('r', (node.size + (this.isExpanded ? 5 : 3.5)).toFixed(1));
                halo.setAttribute('fill', 'var(--accent)');
                halo.setAttribute('fill-opacity', '0.12');
                halo.setAttribute('stroke', 'var(--accent)');
                halo.setAttribute('stroke-width', '1.0');
                halo.style.display = 'none';
                g.appendChild(halo);
                node.haloEl = halo;

                // Main circle (Topics & Articles clean node markers)
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('r', node.size.toFixed(1));
                const isTag = node.type === 'tag';
                circle.setAttribute('class', isTag ? 'notes-mindmap-tag-circle' : 'notes-mindmap-post-circle');
                circle.setAttribute('fill', isTag ? 'var(--graph-tag-fill)' : 'var(--graph-post-fill)');
                circle.setAttribute('stroke', isTag ? 'var(--graph-tag-stroke)' : 'var(--graph-post-stroke)');
                circle.setAttribute('stroke-width', this.isExpanded ? '1.2' : '1.0');
                circle.style.filter = 'none';
                g.appendChild(circle);
                node.circleEl = circle;

                // Label Text
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('class', node.type === 'tag' ? 'notes-mindmap-tag-text' : 'notes-mindmap-post-text');
                text.style.pointerEvents = 'none';
                text.style.userSelect = 'none';

                if (node.type === 'tag') {
                    text.setAttribute('x', '0');
                    text.setAttribute('y', (node.size + (this.isExpanded ? 11 : 8)).toFixed(1));
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('font-size', this.isExpanded ? '10px' : '8px');
                    text.textContent = `#${node.label}`;
                    if (!this.isExpanded) {
                        text.style.display = 'none';
                    }
                } else {
                    text.setAttribute('x', (node.size + (this.isExpanded ? 5 : 4)).toFixed(1));
                    text.setAttribute('y', '3');
                    text.setAttribute('text-anchor', 'start');
                    text.setAttribute('font-size', this.isExpanded ? '9.5px' : '7.5px');
                    const maxLen = this.isExpanded ? 28 : 13;
                    text.textContent = node.label.length > maxLen ? node.label.slice(0, maxLen).trim() + '…' : node.label;
                    if (!this.isExpanded) {
                        text.style.display = 'none';
                    }
                }
                g.appendChild(text);
                node.textEl = text;

                // Bind node pointer events
                g.addEventListener('pointerdown', (e) => this.handleNodePointerDown(e, node));
                g.addEventListener('pointerenter', () => this.handleNodeHover(node.id));
                g.addEventListener('pointerleave', () => this.handleNodeUnhover(node.id));

                this.nodesLayer.appendChild(g);
                node.gEl = g;
            });

            this.updateDomPositions();
        }

        handleNodePointerDown(e, node) {
            e.stopPropagation();
            e.preventDefault();
            this.draggedNode = node;
            this.dragStartPos = { x: e.clientX, y: e.clientY };
            this.isPanning = false;

            try { node.gEl.setPointerCapture(e.pointerId); } catch (_) {}
            node.gEl.style.cursor = 'grabbing';

            const rect = this.svg.getBoundingClientRect();
            const pointerX = e.clientX - rect.left;
            const pointerY = e.clientY - rect.top;
            this.mousePos = {
                graphX: (pointerX - this.viewport.x) / this.viewport.k,
                graphY: (pointerY - this.viewport.y) / this.viewport.k
            };

            this.alpha = 1.0;
            this.startSimulation();
        }

        handleNodeHover(nodeId) {
            this.hoveredNodeId = nodeId;
            this.applyHoverStyles();
            this.showTooltip(nodeId);
        }

        handleNodeUnhover(nodeId) {
            if (this.hoveredNodeId === nodeId) {
                this.hoveredNodeId = null;
                this.applyHoverStyles();
                this.hideTooltip();
            }
        }

        applyHoverStyles() {
            const filterState = (typeof this.options.getFilterState === 'function')
                ? this.options.getFilterState()
                : { activeTags: [], activeCategories: [], searchQuery: '', activePostSlug: null, filteredPosts: this.posts };
            const curActiveTags = filterState.activeTags || [];
            const curActiveCategories = filterState.activeCategories || [];
            const curSearchQuery = filterState.searchQuery || '';
            const curActivePostSlug = filterState.activePostSlug || null;

            // Determine active filter matching nodes
            const hasActiveFilter = (curActiveTags.length > 0) ||
                                   (curActiveCategories.length > 0) ||
                                   (curSearchQuery.trim().length > 0);

            const filteredSlugs = new Set();
            if (hasActiveFilter) {
                const matchedPosts = filterState.filteredPosts || [];
                matchedPosts.forEach(p => filteredSlugs.add(p.slug));
            }

            const activeTagSet = new Set(curActiveTags.map(t => t.toLowerCase()));
            const filteredConnectedTags = new Set();
            if (hasActiveFilter && filteredSlugs.size > 0) {
                this.edges.forEach(e => {
                    if (filteredSlugs.has(e.target) && e.source.startsWith('tag-')) {
                        filteredConnectedTags.add(e.source);
                    }
                });
            }

            const connectedSet = new Set();
            if (this.hoveredNodeId) {
                connectedSet.add(this.hoveredNodeId);
                this.edges.forEach(e => {
                    if (e.source === this.hoveredNodeId) connectedSet.add(e.target);
                    if (e.target === this.hoveredNodeId) connectedSet.add(e.source);
                });
            }

            // Update edges
            this.edges.forEach(edge => {
                if (!edge.lineEl) return;
                let isHL = false;
                let isDim = false;

                if (this.hoveredNodeId) {
                    isHL = (edge.source === this.hoveredNodeId || edge.target === this.hoveredNodeId);
                    isDim = !isHL;
                } else if (hasActiveFilter) {
                    const srcTag = edge.source.startsWith('tag-') ? edge.source.slice(4).toLowerCase() : null;
                    const tgtSlug = edge.target;
                    const srcActive = srcTag && activeTagSet.has(srcTag);
                    const tgtActive = filteredSlugs.has(tgtSlug);
                    if (srcActive || tgtActive) {
                        isHL = true;
                    } else {
                        isDim = true;
                    }
                }

                if (isHL) {
                    edge.lineEl.classList.add('is-highlighted');
                    edge.lineEl.classList.remove('is-dimmed');
                } else if (isDim) {
                    edge.lineEl.classList.add('is-dimmed');
                    edge.lineEl.classList.remove('is-highlighted');
                } else {
                    edge.lineEl.classList.remove('is-highlighted', 'is-dimmed');
                }
            });

            // Update nodes
            this.nodes.forEach(node => {
                if (!node.gEl) return;
                const isTag = node.type === 'tag';
                const tagLow = isTag ? node.tagVal.toLowerCase() : null;
                const isTagSelected = isTag && activeTagSet.has(tagLow);
                const isPostMatching = !isTag && filteredSlugs.has(node.slug);
                const isConnectedTag = isTag && filteredConnectedTags.has(node.id);

                let isHov = this.hoveredNodeId === node.id;
                let isRel = this.hoveredNodeId && connectedSet.has(node.id);
                let isDim = false;
                let isAct = isTagSelected || (curActivePostSlug && curActivePostSlug === node.slug);

                if (this.hoveredNodeId) {
                    isDim = !isHov && !isRel;
                } else if (hasActiveFilter) {
                    const isRelevantToFilter = isTagSelected || isPostMatching || isConnectedTag;
                    isDim = !isRelevantToFilter;
                }

                node.gEl.style.opacity = isDim ? '0.22' : '1.0';

                if (node.haloEl) {
                    node.haloEl.style.display = (isHov || isAct) ? 'block' : 'none';
                }
                if (node.circleEl) {
                    const strokeWidth = (isHov || isAct) ? (this.isExpanded ? '1.8' : '1.4') : (this.isExpanded ? '1.2' : '1.0');
                    node.circleEl.setAttribute('stroke', isTag ? 'var(--graph-tag-stroke)' : 'var(--graph-post-stroke)');
                    node.circleEl.setAttribute('fill', isTag ? 'var(--graph-tag-fill)' : 'var(--graph-post-fill)');
                    node.circleEl.setAttribute('stroke-width', strokeWidth);
                    node.circleEl.style.filter = 'none';
                }
                if (isHov || isAct) {
                    node.gEl.classList.add('is-hovered');
                } else {
                    node.gEl.classList.remove('is-hovered');
                }
                if (node.textEl) {
                    if (!this.isExpanded) {
                        const showLabel = isHov || isRel || isAct || isPostMatching || isTagSelected || isConnectedTag;
                        node.textEl.style.display = showLabel ? 'block' : 'none';
                    } else {
                        if (isTag) {
                            node.textEl.style.display = 'block';
                        } else {
                            node.textEl.style.display = (isHov || isRel || isAct || isPostMatching) ? 'block' : 'none';
                        }
                    }
                    if (!isTag) {
                        const maxLen = this.isExpanded ? 28 : 13;
                        node.textEl.textContent = isHov ? node.label : (node.label.length > maxLen ? node.label.slice(0, maxLen).trim() + '…' : node.label);
                    }
                }
            });
        }

        updateDomPositions() {
            const nodeMap = this.nodeMap;
            this.nodes.forEach(n => {
                if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
                if (n.gEl) {
                    n.gEl.setAttribute('transform', `translate(${n.x.toFixed(1)}, ${n.y.toFixed(1)})`);
                }
            });

            this.edges.forEach(e => {
                if (!e.lineEl) return;
                const na = nodeMap.get(e.source);
                const nb = nodeMap.get(e.target);
                if (na && nb) {
                    e.lineEl.setAttribute('x1', na.x.toFixed(1));
                    e.lineEl.setAttribute('y1', na.y.toFixed(1));
                    e.lineEl.setAttribute('x2', nb.x.toFixed(1));
                    e.lineEl.setAttribute('y2', nb.y.toFixed(1));
                }
            });
        }

        updateViewportTransform() {
            if (this.viewportLayer) {
                this.viewportLayer.setAttribute('transform', `translate(${this.viewport.x.toFixed(1)}, ${this.viewport.y.toFixed(1)}) scale(${this.viewport.k.toFixed(3)})`);
            }
        }

        startSimulation() {
            if (this.isSimulating) return;
            this.isSimulating = true;

            const step = () => {
                if (this.nodes.length === 0) {
                    this.isSimulating = false;
                    return;
                }

                const fallback = this.getFallbackDims();
                const width = this.width || fallback.width;
                const height = this.height || fallback.height;
                const isExpanded = this.isExpanded;

                this.stepPhysics({
                    nodes: this.nodes,
                    edges: this.edges,
                    nodeMap: this.nodeMap,
                    width,
                    height,
                    cX: width / 2,
                    cY: height / 2,
                    gravity: isExpanded ? 0.0022 : 0.004,
                    charge: isExpanded ? 2400 : 700,
                    repelMargin: isExpanded ? 80 : 46,
                    repelSlope: isExpanded ? 0.22 : 0.18,
                    linkLen: isExpanded ? 165 : 75,
                    linkK: isExpanded ? 0.035 : 0.055,
                    useUnifiedEdgeWeight: false,
                    stepScale: Math.max(this.alpha, 0.08),
                    damping: 0.82,
                    padFixed: null,
                    maxSpeed: 4.0,
                    bounce: 0.2,
                    floatPhase: this.alpha > 0.06 ? { time: Date.now() * 0.0008, amp: 0.010 * this.alpha } : null
                });

                this.alpha = Math.max(this.alpha * 0.97, 0.01);
                this.updateDomPositions();

                if (this.alpha > 0.025 || this.draggedNode) {
                    this.animFrameId = requestAnimationFrame(step);
                } else {
                    this.isSimulating = false;
                }
            };

            this.animFrameId = requestAnimationFrame(step);
        }

        initEvents() {
            if (!this.svg) return;

            // Background Panning
            this._onSvgPointerDown = (e) => {
                if (e.target === this.svg || e.target.tagName === 'svg' || e.target === this.viewportLayer) {
                    this.isPanning = true;
                    this.lastPanPos = { x: e.clientX, y: e.clientY };
                    try { this.svg.setPointerCapture(e.pointerId); } catch (_) {}
                    this.svg.style.cursor = 'grabbing';
                }
            };
            this.svg.addEventListener('pointerdown', this._onSvgPointerDown);

            this._onWindowPointerMove = (e) => {
                if (!this.svg || (!this.isPanning && !this.draggedNode)) return;
                const rect = this.svg.getBoundingClientRect();
                const pointerX = e.clientX - rect.left;
                const pointerY = e.clientY - rect.top;
                const graphX = (pointerX - this.viewport.x) / this.viewport.k;
                const graphY = (pointerY - this.viewport.y) / this.viewport.k;

                if (this.isPanning) {
                    const dx = e.clientX - this.lastPanPos.x;
                    const dy = e.clientY - this.lastPanPos.y;
                    this.lastPanPos = { x: e.clientX, y: e.clientY };
                    this.viewport.x += dx;
                    this.viewport.y += dy;
                    this.updateViewportTransform();
                } else if (this.draggedNode) {
                    this.mousePos = { graphX, graphY };
                    this.alpha = 1.0;
                    this.startSimulation();
                }
            };
            window.addEventListener('pointermove', this._onWindowPointerMove);

            this._onWindowPointerUp = (e) => {
                if (this.draggedNode) {
                    if (this.dragStartPos) {
                        const dist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);
                        if (dist < 5) {
                            if (this.draggedNode.type === 'tag' && this.options.onSelectTag) {
                                this.options.onSelectTag(this.draggedNode.tagVal);
                            } else if (this.draggedNode.type === 'post' && this.options.onSelectPost) {
                                this.options.onSelectPost(this.draggedNode.slug);
                            }
                        }
                    }
                    if (this.draggedNode.gEl) {
                        this.draggedNode.gEl.style.cursor = 'grab';
                        try { this.draggedNode.gEl.releasePointerCapture(e.pointerId); } catch (_) {}
                    }
                    this.draggedNode = null;
                    this.dragStartPos = null;
                }

                if (this.isPanning) {
                    this.isPanning = false;
                    if (this.svg) {
                        this.svg.style.cursor = 'grab';
                        try { this.svg.releasePointerCapture(e.pointerId); } catch (_) {}
                    }
                }
            };

            window.addEventListener('pointerup', this._onWindowPointerUp);
            window.addEventListener('pointercancel', this._onWindowPointerUp);

            // Wheel Zooming with Smooth Cursor Focusing
            this._onSvgWheel = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const rect = this.svg.getBoundingClientRect();
                const pointerX = e.clientX - rect.left;
                const pointerY = e.clientY - rect.top;

                const zoomFactor = Math.pow(0.9985, e.deltaY);
                const nextK = Math.max(0.25, Math.min(4.0, this.viewport.k * zoomFactor));
                const ratio = 1 - nextK / this.viewport.k;
                this.viewport.x += (pointerX - this.viewport.x) * ratio;
                this.viewport.y += (pointerY - this.viewport.y) * ratio;
                this.viewport.k = nextK;
                this.updateViewportTransform();
            };
            this.svg.addEventListener('wheel', this._onSvgWheel, { passive: false });
        }

        destroy() {
            this.isSimulating = false;
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }
            if (this._resizeRaf) {
                cancelAnimationFrame(this._resizeRaf);
                this._resizeRaf = null;
            }
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
            if (this.zoomTimer) {
                clearTimeout(this.zoomTimer);
                this.zoomTimer = null;
            }
            if (this._onWindowPointerMove) {
                window.removeEventListener('pointermove', this._onWindowPointerMove);
                this._onWindowPointerMove = null;
            }
            if (this._onWindowPointerUp) {
                window.removeEventListener('pointerup', this._onWindowPointerUp);
                window.removeEventListener('pointercancel', this._onWindowPointerUp);
                this._onWindowPointerUp = null;
            }
            if (this.svg) {
                if (this._onSvgPointerDown) {
                    this.svg.removeEventListener('pointerdown', this._onSvgPointerDown);
                    this._onSvgPointerDown = null;
                }
                if (this._onSvgWheel) {
                    this.svg.removeEventListener('wheel', this._onSvgWheel);
                    this._onSvgWheel = null;
                }
                this.svg = null;
            }
        }

        zoom(direction) {
            if (direction === 'reset') {
                this.viewport = { x: 0, y: 0, k: 1 };
                this.updateViewportTransform();
                this.alpha = 1.0;
                this.startSimulation();
                return;
            }
            const factor = direction === 'in' ? 1.35 : 0.74;
            const nextK = Math.max(0.25, Math.min(4.0, this.viewport.k * factor));
            const cX = this.width / 2;
            const cY = this.height / 2;
            const ratio = 1 - nextK / this.viewport.k;
            this.viewport.x += (cX - this.viewport.x) * ratio;
            this.viewport.y += (cY - this.viewport.y) * ratio;
            this.viewport.k = nextK;
            this.updateViewportTransform();
        }

        showTooltip(id) {
            const node = this.nodes.find(n => n.id === id);
            if (!node || !this.container) return;
            let tooltip = this.container.querySelector('.notes-mindmap-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'notes-mindmap-tooltip';
                this.container.appendChild(tooltip);
            }
            tooltip.style.display = 'block';
            const esc = this.options.escapeHTML || window.pxecore?.notesMarkdown?.escapeHTML || (s => String(s || ''));
            const safeLabel = esc(node.label);
            tooltip.innerHTML = `
                <div class="tooltip-type">${node.type === 'tag' ? 'Topic' : 'Article'}</div>
                <div class="tooltip-title">${node.type === 'tag' ? '#' + safeLabel : safeLabel}</div>
                <div class="tooltip-conn">${node.connections} connection${node.connections !== 1 ? 's' : ''}</div>
            `;
        }

        hideTooltip() {
            if (!this.container) return;
            const tooltip = this.container.querySelector('.notes-mindmap-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        }
    }

    return QuartzGraphEngine;
})();
