// Light-theme foliage physics: 3D tumbling leaves, whirlwind vortex, and wind bursts.
window.pxecore = window.pxecore || {};
window.pxecore.createFoliageEngine = function createFoliageEngine(bridge) {
    const GOLDEN_ANGLE_RAD = (2 * Math.PI) / Math.pow((1 + Math.sqrt(5)) / 2, 2);
    let leaves = [];
    let leavesNeedSort = true;
    let whirlwind = null;
    let windBursts = [];
    let leafCutFlashes = [];
    let windTurbulence = 0;
    let whirlwindCooldown = 0;
    let windClickCount = 0;            // Click-based hurricane trigger counter
    let lastWindClickTime = 0;         // Timestamp of last wind click (for decay)
    let whirlwindSpawnCount = 0;       // Number of whirlwinds spawned this session
    function getWindClickThreshold() {
        return whirlwindSpawnCount === 0 ? 4 : 12;
    }
    const WIND_CLICK_DECAY_TIME = 8000; // 8s without click → counter resets

    // Active light-theme Chroma wash colors
    let activeChromaAccentRgb = '132, 50, 26';
    let activeChromaSecondaryRgb = '175, 82, 42';

    // Leaf palettes (dorsal / ventral)
    let LEAF_3D_PALETTES = [
        {
            // Sunlit Golden Amber
            dorsal:  { r: 218, g: 165, b: 64 },
            ventral: { r: 248, g: 216, b: 142 }
        },
        {
            // Antique Terracotta Copper
            dorsal:  { r: 184, g: 76,  b: 42 },
            ventral: { r: 226, g: 142, b: 110 }
        },
        {
            // Warm Autumn Ochre
            dorsal:  { r: 196, g: 140, b: 48 },
            ventral: { r: 235, g: 198, b: 125 }
        },
        {
            // Crimson Maple Russet
            dorsal:  { r: 162, g: 52,  b: 38 },
            ventral: { r: 212, g: 118, b: 98 }
        },
        {
            // Honey Bronze Amber
            dorsal:  { r: 175, g: 115, b: 45 },
            ventral: { r: 228, g: 180, b: 115 }
        }
    ];

    /**
     * Dynamically harmonize leaf palettes & watercolor wash with active Chroma theme
     */
    function setChromaLeafPalette(accentRgbStr, accentHex) {
        if (!accentRgbStr) return;
        const parts = String(accentRgbStr).split(',').map(s => parseInt(s.trim(), 10));
        if (parts.length < 3 || isNaN(parts[0])) return;
        const [r, g, b] = parts;
        activeChromaAccentRgb = `${r}, ${g}, ${b}`;

        // Compute secondary wash tone
        const secR = Math.min(255, Math.round(r * 1.32 + 10));
        const secG = Math.min(255, Math.round(g * 1.30 + 15));
        const secB = Math.min(255, Math.round(b * 1.25 + 8));
        activeChromaSecondaryRgb = `${secR}, ${secG}, ${secB}`;

        // Derive 5 harmonious foliage palettes around the active accent
        LEAF_3D_PALETTES = [
            // 1. Primary Accent Leaf (true to Chroma)
            {
                dorsal:  { r: r, g: g, b: b },
                ventral: { r: Math.min(255, Math.round(r * 1.28 + 35)), g: Math.min(255, Math.round(g * 1.35 + 40)), b: Math.min(255, Math.round(b * 1.30 + 45)) }
            },
            // 2. Warm Sunlit Ochre
            {
                dorsal:  { r: Math.min(255, Math.round(r * 1.25 + 25)), g: Math.min(255, Math.round(g * 1.45 + 30)), b: Math.max(30, Math.round(b * 0.90 + 20)) },
                ventral: { r: Math.min(255, Math.round(r * 1.40 + 45)), g: Math.min(255, Math.round(g * 1.60 + 50)), b: Math.min(255, Math.round(b * 1.20 + 45)) }
            },
            // 3. Antique Terracotta / Russet
            {
                dorsal:  { r: Math.min(255, Math.round(r * 1.15 + 15)), g: Math.max(20, Math.round(g * 0.85)), b: Math.max(15, Math.round(b * 0.80)) },
                ventral: { r: Math.min(255, Math.round(r * 1.35 + 30)), g: Math.min(255, Math.round(g * 1.15 + 35)), b: Math.min(255, Math.round(b * 1.10 + 35)) }
            },
            // 4. Crimson Maple Glow
            {
                dorsal:  { r: Math.min(255, Math.round(r * 1.05 + 10)), g: Math.max(18, Math.round(g * 0.70)), b: Math.max(15, Math.round(b * 0.75)) },
                ventral: { r: Math.min(255, Math.round(r * 1.25 + 20)), g: Math.min(255, Math.round(g * 1.05 + 30)), b: Math.min(255, Math.round(b * 1.00 + 30)) }
            },
            // 5. Honey Bronze Golden
            {
                dorsal:  { r: Math.min(255, Math.round(r * 1.20 + 20)), g: Math.min(255, Math.round(g * 1.25 + 25)), b: Math.max(25, Math.round(b * 0.95 + 15)) },
                ventral: { r: Math.min(255, Math.round(r * 1.38 + 40)), g: Math.min(255, Math.round(g * 1.48 + 45)), b: Math.min(255, Math.round(b * 1.15 + 35)) }
            }
        ];

        // Smoothly re-tint existing leaves on screen without destroying physics state
        if (Array.isArray(leaves) && leaves.length > 0) {
            for (let i = 0; i < leaves.length; i++) {
                leaves[i].pal = LEAF_3D_PALETTES[i % LEAF_3D_PALETTES.length];
            }
        }
    }

    /**
     * Mitchell's Best-Candidate Windward Spawning with Exact Flux Balancing:
     * Inflow flux: Φ_top = vy * (bridge.getW() + 60), Φ_left = vx * (bridge.getH() + 40).
     * Candidates are evaluated along the windward perimeter to maximize separation from
     * existing nearby leaves, eliminating twin-leaf clustering and dead zones.
     */
    function getOptimalWindwardSpawn(allLeaves, currentLeaf) {
        const screenW = bridge.getW() || window.innerWidth || 1200;
        const screenH = bridge.getH() || window.innerHeight || 800;
        const fluxTop = 0.55 * (screenW * 0.70 + 30);
        const fluxLeft = 0.75 * (screenH * 0.70 + 30);
        const topWeight = fluxTop / (fluxTop + fluxLeft);

        let bestX = -20, bestY = -20;
        let maxMinDist = -1;
        const K = 12;

        for (let k = 0; k < K; k++) {
            let cx, cy;
            if (Math.random() < topWeight) {
                // Top inflow perimeter: strictly spans within 0% to 70% of screen width so windward drift crosses visible area
                cx = -15 + Math.random() * (screenW * 0.70);
                cy = -18 - Math.random() * 22;
            } else {
                // Left inflow perimeter: strictly spans within 0% to 70% of screen height so windward drift crosses visible area
                cx = -18 - Math.random() * 22;
                cy = -15 + Math.random() * (screenH * 0.70);
            }

            let minDist = Infinity;
            if (Array.isArray(allLeaves)) {
                for (let i = 0; i < allLeaves.length; i++) {
                    const other = allLeaves[i];
                    if (other === currentLeaf) continue;
                    // Only compare against active on-screen leaves
                    if (other.x > screenW + 10 || other.y > screenH + 10) continue;
                    const dx = cx - other.x;
                    const dy = cy - other.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < minDist) minDist = d;
                }
            }

            if (minDist > maxMinDist) {
                maxMinDist = minDist;
                bestX = cx;
                bestY = cy;
            }
        }
        return { x: bestX, y: bestY };
    }

    function getTargetLeafCount() {
        const w = bridge.getW() || window.innerWidth || 1200;
        const h = bridge.getH() || window.innerHeight || 800;
        const areaRatio = (w * h) / (1920 * 1080);
        const tier = window.HardwareProfiler ? window.HardwareProfiler.getTier() : 2;
        const baseDesktop = tier <= 1 ? 18 : (tier === 3 ? 28 : 25);
        // Sub-linear area scaling keeps desktop balanced and mobile airy (7-9 leaves on phones)
        const scaled = Math.round(baseDesktop * Math.pow(Math.max(0.10, areaRatio), 0.65));
        return Math.max(6, Math.min(tier <= 1 ? 20 : 32, scaled));
    }

    function initLeaves() {
        leaves = [];
        leafCutFlashes = [];
        windBursts = [];
        leavesNeedSort = true;
        const count = getTargetLeafCount();

        const screenW = bridge.getW() || window.innerWidth || 1200;
        const screenH = bridge.getH() || window.innerHeight || 800;
        const sizeScale = screenW < 480 ? 0.84 : (screenW < 768 ? 0.92 : 1.0);
        const aspect = Math.max(0.45, screenW / (screenH || 1));
        let gridRows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
        let gridCols = Math.max(1, Math.round(gridRows * aspect));
        while (gridRows * gridCols < count) {
            if (gridCols / gridRows < aspect) gridCols++;
            else gridRows++;
        }
        const cellW = screenW / gridCols;
        const cellH = screenH / gridRows;

        // shuffle cells for leaf distribution
        const cellIndices = Array.from({ length: gridCols * gridRows }, (_, idx) => idx);
        for (let idx = cellIndices.length - 1; idx > 0; idx--) {
            const rIdx = Math.floor(Math.random() * (idx + 1));
            const tmp = cellIndices[idx];
            cellIndices[idx] = cellIndices[rIdx];
            cellIndices[rIdx] = tmp;
        }

        for (let i = 0; i < count; i++) {
            const pal = LEAF_3D_PALETTES[i % LEAF_3D_PALETTES.length];
            const frac = i / count;
            let z, baseSize, opacity;

            // Tiered depth stratification:
            // 35% far background (gentle flutter, smaller)
            // 45% midground (standard presence)
            // 20% foreground accents (hero fluttering, vivid detail)
            if (frac < 0.35) {
                z = 0.45 + Math.random() * 0.22;
                baseSize = (9 + Math.random() * 4) * sizeScale;
                opacity = 0.32 + Math.random() * 0.12;
            } else if (frac < 0.80) {
                z = 0.72 + Math.random() * 0.33;
                baseSize = (13 + Math.random() * 4.5) * sizeScale;
                opacity = 0.52 + Math.random() * 0.18;
            } else {
                z = 1.15 + Math.random() * 0.30;
                baseSize = (18 + Math.random() * 4) * sizeScale;
                opacity = 0.76 + Math.random() * 0.14;
            }

            const newSpeedBase = 0.6 + z * 0.4;
            const cell = cellIndices[i];
            const col = cell % gridCols;
            const row = Math.floor(cell / gridCols);
            const initX = Math.max(-20, (col + 0.18 + Math.random() * 0.64) * cellW);
            const initY = Math.max(-20, (row + 0.18 + Math.random() * 0.64) * cellH);

            leaves.push({
                x: initX,
                y: initY,
                z: z,
                size: baseSize,
                vx: 0.75 * newSpeedBase,
                vy: 0.55 * newSpeedBase,
                // 3D Euler angles
                pitch: Math.random() * Math.PI * 2,
                roll: Math.random() * Math.PI * 2,
                yaw: Math.random() * Math.PI * 2,
                // Angular tumble velocities
                vPitch: (Math.random() - 0.5) * 0.024,
                vRoll: 0.018 + Math.random() * 0.028,
                vYaw: (Math.random() - 0.5) * 0.016,
                pal: pal,
                opacity: opacity,
                swayFreq: 0.7 + Math.random() * 0.6,
                swayAmp: 0.8 + Math.random() * 1.3,
                swayPhase: (i * 2.399963) % (Math.PI * 2), // Organic aerodynamic phase decoupling
                driftVarianceX: (Math.random() - 0.5) * 0.22,
                driftVarianceY: (Math.random() - 0.5) * 0.16
            });
        }
    }

    function spawnWhirlwind(x, y) {
        const ctx = bridge.getCtx();
        const isMobile = window.innerWidth < 768;
        const h = isMobile ? 165 : 230;
        // Anchor the whirlwind vortex body so the eye of the storm forms directly on the click location
        const anchoredY = Math.min((bridge.getH() || window.innerHeight || 800) - 10, Math.max(h * 0.5, y + h * 0.5));
        const anchoredX = Math.max(40, Math.min((bridge.getW() || window.innerWidth || 1200) - 40, x));
        let funnelGrad = null;
        if (ctx) {
            funnelGrad = ctx.createLinearGradient(0, anchoredY, 0, anchoredY - h);
            funnelGrad.addColorStop(0,    'rgba(190, 125, 80, 0.30)');
            funnelGrad.addColorStop(0.35, 'rgba(255, 248, 230, 0.46)');
            funnelGrad.addColorStop(0.70, 'rgba(240, 180, 120, 0.32)');
            funnelGrad.addColorStop(1,    'rgba(170, 100, 60, 0.16)');
        }
        whirlwind = {
            x: anchoredX,
            y: anchoredY,
            height: h,
            topRadius: isMobile ? 65 : 95,
            bottomRadius: isMobile ? 12 : 18,
            spinAngle: 0,
            spinSpeed: 0.082,
            age: 0,
            lifetime: 9200, // 9.2s lifetime for wind burst particles
            state: 'growing',
            scale: 0,
            funnelGrad: funnelGrad,
            // 3D debris / golden leaf motes caught in the twister updraft
            debris: Array.from({ length: isMobile ? 12 : 18 }, () => ({
                uHeight: Math.random(), // 0 at ground, 1 at top
                theta: Math.random() * Math.PI * 2,
                orbitSpeed: 0.048 + Math.random() * 0.075,
                size: 1.8 + Math.random() * 2.8,
                pal: LEAF_3D_PALETTES[Math.floor(Math.random() * LEAF_3D_PALETTES.length)],
                tumble: Math.random() * Math.PI * 2,
                tumbleSpeed: 0.035 + Math.random() * 0.045
            })),
            // Ground touchdown debris foot (rotating warm dust & leaf bowl)
            footMotes: Array.from({ length: isMobile ? 8 : 12 }, (_, idx) => ({
                angle: (Math.PI * 2 / (isMobile ? 8 : 12)) * idx,
                radius: 8 + Math.random() * 20,
                speed: 0.08 + Math.random() * 0.06,
                size: 1.2 + Math.random() * 2.0
            }))
        };
    }

    function handleWindClick(x, y) {
        const now = performance.now();

        // Decay: if too long since last wind click, reset the counter
        if (now - lastWindClickTime > WIND_CLICK_DECAY_TIME) {
            windClickCount = 0;
        }
        lastWindClickTime = now;
        windClickCount++;

        // Gentle atmospheric turbulence buildup
        windTurbulence = Math.min(60, windTurbulence + 8);

        // Progressive wind intensity scaling (1.0 to 1.25)
        const currentWindThreshold = getWindClickThreshold();
        const intensityScale = Math.min(1.25, 1.0 + (windClickCount / currentWindThreshold) * 0.25);

        // Wind burst tracking for atmospheric continuity (capped at 4)
        if (windBursts.length >= 4) {
            windBursts.shift();
        }

        const vw = bridge.getW() || window.innerWidth || 1200;
        const vh = bridge.getH() || window.innerHeight || 800;
        const minDim = Math.min(vw, vh);
        const baseMaxR = Math.max(48, Math.min(126, Math.round(minDim * 0.13)));
        const baseStartR = Math.max(5, Math.round(baseMaxR * 0.07));
        windBursts.push({
            x, y,
            startTime: now,
            duration: 680, // Deterministic 680ms for test contracts and ease-out timing
            startRadius: baseStartR,
            maxRadius: Math.round(baseMaxR * intensityScale)
        });

        // ── 1. Leaf direct touch/click slice detection ──
        let slicedCount = 0;
        const currentLen = leaves.length;
        const targetCount = getTargetLeafCount();
        const maxLeaves = Math.max(12, targetCount + Math.min(8, Math.ceil(targetCount * 0.35)));

        for (let i = currentLen - 1; i >= 0; i--) {
            const leaf = leaves[i];
            if (leaf.isFragment) continue; // already sliced
            const z = leaf.z || 1;
            const s = leaf.size * (0.6 + z * 0.4);
            const hitR = Math.max(26, s * 1.6 + 10);
            const dx = leaf.x - x;
            const dy = leaf.y - y;
            if (dx * dx + dy * dy <= hitR * hitR) {
                // Leaf slash spark visual (strictly capped)
                if (leafCutFlashes.length >= 4) {
                    leafCutFlashes.shift();
                }
                leafCutFlashes.push({
                    x: x,
                    y: y,
                    size: s,
                    yaw: leaf.yaw,
                    startTime: now,
                    duration: 550
                });

                // Cleave into two half fragments with immediate physical separation
                leaf.isFragment = true;
                leaf.fragmentSide = 'left';
                const sepDist = Math.max(14, s * 0.6);
                leaf.x -= sepDist;
                leaf.vx -= 1.8;
                leaf.vRoll += 0.08;
                leaf.vPitch += 0.04;

                // Counterpart right half fragment (strictly capped to prevent runaway objects)
                if (leaves.length < maxLeaves) {
                    const rightFragment = {
                        ...leaf,
                        fragmentSide: 'right',
                        isFragment: true,
                        isClone: true,
                        cloneAge: 0,
                        x: leaf.x + sepDist * 2,
                        vx: leaf.vx + 3.6,
                        vRoll: leaf.vRoll - 0.16,
                        vPitch: leaf.vPitch - 0.08
                    };
                    leaves.push(rightFragment);
                }

                slicedCount++;
                if (slicedCount >= 2) break;
            }
        }

        if (leafCutFlashes.length > 8) {
            leafCutFlashes.splice(0, leafCutFlashes.length - 8);
        }

        // ── 2. Radial breeze scatter on nearby leaves ──
        const breezeRadius = 220;
        const breezeForce = 3.6 * intensityScale;
        for (let i = 0; i < leaves.length; i++) {
            const leaf = leaves[i];
            const dx = leaf.x - x;
            const dy = leaf.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq < breezeRadius * breezeRadius && distSq > 4) {
                const dist = Math.sqrt(distSq);
                const leafMul = leaf.isFragment ? 0.6 : 1.0;
                const force = (1 - dist / breezeRadius) * breezeForce * leafMul;
                leaf.vx += (dx / dist) * force;
                leaf.vy += (dy / dist) * force;
                leaf.vRoll += (Math.random() - 0.5) * 0.08;
                leaf.vPitch += (Math.random() - 0.5) * 0.06;
            }
        }

        // ── 3. Whirlwind trigger (4 clicks first time, then 12) ──
        const windThreshold = getWindClickThreshold();
        if (!whirlwind && whirlwindCooldown <= 0 && windClickCount >= windThreshold) {
            windClickCount = 0;
            windTurbulence = 0;
            whirlwindSpawnCount++;
            spawnWhirlwind(x, y);
        }
    }

    function updateWhirlwind(dtMs, dt) {
        // Smoothly decay wind turbulence (~24 per second)
        if (windTurbulence > 0) {
            windTurbulence = Math.max(0, windTurbulence - dtMs * 0.024);
        }
        if (whirlwindCooldown > 0) {
            whirlwindCooldown = Math.max(0, whirlwindCooldown - dtMs);
        }
        // Time-based wind click count decay (reset after 8s idle)
        if (windClickCount > 0 && performance.now() - lastWindClickTime > WIND_CLICK_DECAY_TIME) {
            windClickCount = 0;
        }

        if (!whirlwind) return;
        whirlwind.age += dtMs;
        whirlwind.spinAngle += whirlwind.spinSpeed * dt;

        if (whirlwind.age < 1200) {
            whirlwind.state = 'growing';
            whirlwind.scale = Math.sin((whirlwind.age / 1200) * Math.PI * 0.5);
        } else if (whirlwind.age > whirlwind.lifetime - 1300) {
            whirlwind.state = 'dissipating';
            whirlwind.scale = Math.sin(((whirlwind.lifetime - whirlwind.age) / 1300) * Math.PI * 0.5);
        } else {
            whirlwind.state = 'active';
            whirlwind.scale = 1.0;
        }

        // Update 3D debris spiraling inside the twister
        if (whirlwind.debris) {
            whirlwind.debris.forEach(d => {
                d.theta += d.orbitSpeed * dt;
                d.tumble += d.tumbleSpeed * dt;
                // Accelerating upward draft motion
                d.uHeight += (0.0035 + d.uHeight * 0.003) * dt;
                if (d.uHeight >= 1.0) {
                    d.uHeight = 0.02 + Math.random() * 0.06;
                    d.theta = Math.random() * Math.PI * 2;
                }
            });
        }

        // Update ground touchdown foot motes
        if (whirlwind.footMotes) {
            whirlwind.footMotes.forEach(fm => {
                fm.angle += fm.speed * dt;
            });
        }

        if (whirlwind.age >= whirlwind.lifetime) {
            // Ejection blast when tornado dissipates
            leaves.forEach(leaf => {
                const dx = leaf.x - whirlwind.x;
                const dy = leaf.y - (whirlwind.y - whirlwind.height * 0.5);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < whirlwind.topRadius * 1.6 && dist > 1) {
                    const blast = (1 - dist / (whirlwind.topRadius * 1.6)) * 4.8;
                    leaf.vx += (dx / dist) * blast;
                    leaf.vy += (dy / dist) * blast;
                    leaf.vRoll += (Math.random() - 0.5) * 0.12;
                }
            });
            whirlwind = null;
            whirlwindCooldown = 3000; // 3s calm cooldown
        }
    }

    function updateAndDrawLeaves(timestamp, dt, colors, dtMs) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        const harmonicOrder = bridge.getHarmonicOrder() || { active: false, age: 0, duration: 1, phaseAngle: 0 };
        const deltaMs = (typeof dtMs === 'number') ? dtMs : (dt * 16.67);
        const time = timestamp * 0.001;
        const currentPerfNow = performance.now();

        // Draw wind click ripple
        for (let i = windBursts.length - 1; i >= 0; i--) {
            const wb = windBursts[i];
            const p = Math.min(1.0, (currentPerfNow - wb.startTime) / (wb.duration || 680));
            if (p >= 1.0) {
                windBursts.splice(i, 1);
                continue;
            }

            // Single calm sinusoidal ease-out ripple scaled to burst radius
            const inv = 1 - p;
            const ease1 = Math.sin(p * Math.PI * 0.5);
            const r1 = wb.startRadius + (wb.maxRadius - wb.startRadius) * ease1;
            const alpha1 = Math.pow(inv, 1.55) * 0.80;
            const sizeMul = Math.max(0.55, Math.min(1.1, wb.maxRadius / 110));

            // 1. Soft Chroma watercolor halo
            ctx.beginPath();
            ctx.arc(wb.x, wb.y, r1, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${activeChromaSecondaryRgb}, ${(alpha1 * 0.28).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.9, 3.2 * sizeMul * inv);
            ctx.stroke();

            // 2. Delicate sunlit crest hairline
            ctx.beginPath();
            ctx.arc(wb.x, wb.y, r1, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 253, 248, ${(alpha1 * 0.56).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.45, 0.95 * sizeMul * inv);
            ctx.stroke();

            // Aerodynamic wave push: squared-distance band check skips Math.sqrt for distant leaves
            const waveWidth = 32;
            const minR = Math.max(4, r1 - waveWidth);
            const maxR = r1 + waveWidth;
            const minRSq = minR * minR;
            const maxRSq = maxR * maxR;
            const pushFactor = (1 - p) * 1.8 * dt;
            for (let j = 0; j < leaves.length; j++) {
                const leaf = leaves[j];
                const dx = leaf.x - wb.x;
                const dy = leaf.y - wb.y;
                const distSq = dx * dx + dy * dy;
                if (distSq <= minRSq || distSq >= maxRSq) continue;
                const dist = Math.sqrt(distSq);
                const leafMul = leaf.isFragment ? 0.7 : 1.0;
                const proximity = 1 - Math.abs(dist - r1) / waveWidth;
                const impulse = pushFactor * proximity * leafMul;
                leaf.vx += (dx / dist) * impulse;
                leaf.vy += (dy / dist) * impulse;
                leaf.vRoll += (Math.random() - 0.5) * 0.05 * proximity;
            }
        }

        // Draw cut flash particles
        for (let i = leafCutFlashes.length - 1; i >= 0; i--) {
            const cf = leafCutFlashes[i];
            const p = Math.min(1.0, (currentPerfNow - cf.startTime) / (cf.duration || 550));
            if (p >= 1.0) {
                leafCutFlashes.splice(i, 1);
                continue;
            }
            const life = 1.0 - p;

            ctx.save();
            ctx.translate(cf.x, cf.y);
            ctx.rotate(cf.yaw);

            // Cut spark line
            const slashLen = cf.size * 1.3 * (1 + (1 - life) * 0.4);
            ctx.beginPath();
            ctx.moveTo(0, -slashLen * 0.5);
            ctx.lineTo(0, slashLen * 0.5);
            ctx.strokeStyle = `rgba(255, 220, 130, ${life * 0.95})`;
            ctx.lineWidth = 1.8 * life;
            ctx.stroke();

            // Droplet particles along cut vector
            for (let k = -1; k <= 1; k += 2) {
                const dropDist = (1 - life) * 14 * k;
                ctx.beginPath();
                ctx.arc(dropDist, 0, 1.2 * life, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(225, 145, 65, ${life * 0.85})`;
                ctx.fill();
            }
            ctx.restore();
        }

        // Draw 3D Whirlwind vortex
        if (whirlwind) {
            draw3DWhirlwind();
        }

        // Update leaves with 3D aerodynamic rigid-body physics
        for (let i = leaves.length - 1; i >= 0; i--) {
            const l = leaves[i];

            // 3D Translations with organic aerodynamic sway phase
            l.x += (l.vx + Math.sin(time * l.swayFreq + l.y * 0.0035 + (l.swayPhase || 0)) * l.swayAmp) * dt;
            l.y += (l.vy + Math.cos(time * (l.swayFreq * 0.78) + l.x * 0.0035 + (l.swayPhase || 0)) * 0.38) * dt;

            // 3D Euler rotations
            l.pitch += l.vPitch * dt;
            l.roll  += l.vRoll * dt;
            l.yaw   += l.vYaw * dt;

            // Pairwise aerodynamic wake deflection & soft positional relaxation: prevents leaves from overlapping or clumping together
            for (let j = i - 1; j >= 0; j--) {
                const l2 = leaves[j];
                // If either leaf is already off-screen or right at the exit boundary, skip collision so exits are free and smooth
                if (l.x >= bridge.getW() || l.y >= bridge.getH() || l2.x >= bridge.getW() || l2.y >= bridge.getH()) continue;

                const dx = l.x - l2.x;
                if (Math.abs(dx) > 65) continue;
                const dy = l.y - l2.y;
                if (Math.abs(dy) > 65) continue;
                const distSq = dx * dx + dy * dy;
                const s1 = l.size * (0.6 + (l.z || 1) * 0.4);
                const s2 = l2.size * (0.6 + (l2.z || 1) * 0.4);
                const minDist = (s1 + s2) * 1.05 + 8;
                if (distSq < minDist * minDist) {
                    const dist = Math.sqrt(distSq);
                    const overlap = minDist - dist;
                    let ux = 1, uy = 0;
                    if (dist > 0.001) {
                        ux = dx / dist;
                        uy = dy / dist;
                    } else {
                        const rndAng = ((i + j) * 2.399963) % (Math.PI * 2);
                        ux = Math.cos(rndAng);
                        uy = Math.sin(rndAng);
                    }

                    // Direct soft positional relaxation (physically resolves overlap and prevents clumping)
                    const separationRatio = dist < 14 ? 0.68 : 0.46;
                    const posNudge = overlap * separationRatio * Math.min(1.0, dt * 0.8);
                    l.x += ux * posNudge;
                    l.y += uy * posNudge;
                    l2.x -= ux * posNudge;
                    l2.y -= uy * posNudge;

                    // Aerodynamic velocity repulsion impulse
                    const velPush = (overlap / minDist) * 0.04 * dt;
                    l.vx += ux * velPush;
                    l.vy += uy * velPush;
                    l2.vx -= ux * velPush;
                    l2.vy -= uy * velPush;
                }
            }

            // Fluid drag: smooth, consistent cruising speed with organic individual drift vectors
            const speedBase = 0.6 + (l.z || 1) * 0.4;
            const targetVx = (0.75 + (l.driftVarianceX || 0)) * speedBase;
            const targetVy = (0.55 + (l.driftVarianceY || 0)) * speedBase;
            l.vx += (targetVx - l.vx) * 0.04 * dt;
            l.vy += (targetVy - l.vy) * 0.04 * dt;

            // Symmetric velocity envelope: preserves radial breeze & slice recoil in any direction
            l.vx = Math.max(-3.2 * speedBase, Math.min(3.2 * speedBase, l.vx));
            l.vy = Math.max(-2.8 * speedBase, Math.min(2.8 * speedBase, l.vy));

            l.vRoll += (0.022 - l.vRoll) * 0.025 * dt;
            l.vPitch += (0.008 - l.vPitch) * 0.025 * dt;

            // Whirlwind 3D suction & updraft
            if (whirlwind && whirlwind.scale > 0.08) {
                const wx = whirlwind.x;
                const wy = whirlwind.y;
                const vertDist = wy - l.y;
                if (vertDist >= -30 && vertDist <= whirlwind.height + 40) {
                    const u = Math.max(0, Math.min(1, vertDist / whirlwind.height));
                    const currentRadius = (whirlwind.bottomRadius + Math.pow(u, 1.2) * (whirlwind.topRadius - whirlwind.bottomRadius)) * whirlwind.scale;
                    const dx = wx - l.x;
                    const horizDist = Math.abs(dx);

                    if (horizDist < currentRadius + 65) {
                        const pull = (1 - horizDist / (currentRadius + 65)) * 2.8;
                        l.x += (Math.sign(dx) * pull * 0.85 + Math.cos(whirlwind.spinAngle * 3 + vertDist * 0.04) * pull * 2.4) * dt;
                        l.y -= (pull * 1.8 + 0.6) * dt;
                        l.vRoll += 0.04 * dt;
                        l.vPitch += 0.03 * dt;
                    }
                }
            }

            // Phyllotaxis alignment for leaves
            if (harmonicOrder.active) {
                const progress = harmonicOrder.age / harmonicOrder.duration;
                const env = progress < 0.18
                    ? (progress / 0.18)
                    : (progress > 0.78 ? Math.max(0, (1 - progress) / 0.22) : 1.0);
                const cx = (bridge.getW() || 1200) * 0.5;
                const cy = (bridge.getH() || 800) * 0.5;
                const maxRadius = Math.min(bridge.getW() || 1200, bridge.getH() || 800) * 0.38;
                const scaleC = maxRadius / Math.sqrt(leaves.length + 1);
                const r = scaleC * Math.sqrt(i + 1);
                const theta = i * GOLDEN_ANGLE_RAD + harmonicOrder.phaseAngle;
                const targetX = cx + r * Math.cos(theta);
                const targetY = cy + r * Math.sin(theta);
                l.x += (targetX - l.x) * (0.045 * env) * dt;
                l.y += (targetY - l.y) * (0.045 * env) * dt;
                l.vRoll += 0.015 * env * dt;
                l.vPitch += 0.008 * env * dt;
            }

            // Sliced clone fragment auto-cleanup if held in vortex
            if (l.isClone) {
                l.cloneAge = (l.cloneAge || 0) + deltaMs;
                if (l.cloneAge > 6500) {
                    leaves.splice(i, 1);
                    continue;
                }
            }

            // Screen boundary wrapping and smart windward recycling (clean instant recycling on offscreen exit)
            if (l.x > bridge.getW() + 18 || l.y > bridge.getH() + 18 || l.x < -32 || l.y < -32) {
                if (l.isClone) {
                    leaves.splice(i, 1);
                    continue;
                }
                // Full recycle: restore as a fresh whole leaf with tiered depth
                l.isFragment = false;
                l.fragmentSide = null;
                l.pal = LEAF_3D_PALETTES[Math.floor(Math.random() * LEAF_3D_PALETTES.length)];

                const rollTier = Math.random();
                if (rollTier < 0.35) {
                    l.z = 0.45 + Math.random() * 0.22;
                    l.size = 9 + Math.random() * 4;
                    l.opacity = 0.32 + Math.random() * 0.12;
                } else if (rollTier < 0.80) {
                    l.z = 0.72 + Math.random() * 0.33;
                    l.size = 13 + Math.random() * 4.5;
                    l.opacity = 0.52 + Math.random() * 0.18;
                } else {
                    l.z = 1.15 + Math.random() * 0.30;
                    l.size = 18 + Math.random() * 4;
                    l.opacity = 0.76 + Math.random() * 0.14;
                }

                // Mitchell best-candidate windward placement with exact steady-state flux ratio
                const spawn = getOptimalWindwardSpawn(leaves, l);
                l.x = spawn.x;
                l.y = spawn.y;

                const newSpeedBase = 0.6 + l.z * 0.4;
                l.vx = 0.75 * newSpeedBase;
                l.vy = 0.55 * newSpeedBase;
                l.pitch = Math.random() * Math.PI * 2;
                l.roll = Math.random() * Math.PI * 2;
                l.yaw = Math.random() * Math.PI * 2;
                l.vPitch = (Math.random() - 0.5) * 0.024;
                l.vRoll = 0.018 + Math.random() * 0.028;
                l.vYaw = (Math.random() - 0.5) * 0.016;
                l.swayFreq = 0.7 + Math.random() * 0.6;
                l.swayAmp = 0.8 + Math.random() * 1.3;
                l.swayPhase = Math.random() * Math.PI * 2;
                l.driftVarianceX = (Math.random() - 0.5) * 0.22;
                l.driftVarianceY = (Math.random() - 0.5) * 0.16;
                leavesNeedSort = true;
            }
        }

        // top up leaves
        const targetLeafCount = getTargetLeafCount();
        if (leaves.length < targetLeafCount) {
            const missing = targetLeafCount - leaves.length;
            for (let j = 0; j < missing; j++) {
                const pal = LEAF_3D_PALETTES[Math.floor(Math.random() * LEAF_3D_PALETTES.length)];
                const rollTier = Math.random();
                let z, size, opacity;
                if (rollTier < 0.35) {
                    z = 0.45 + Math.random() * 0.22;
                    size = 9 + Math.random() * 4;
                    opacity = 0.32 + Math.random() * 0.12;
                } else if (rollTier < 0.80) {
                    z = 0.72 + Math.random() * 0.33;
                    size = 13 + Math.random() * 4.5;
                    opacity = 0.52 + Math.random() * 0.18;
                } else {
                    z = 1.15 + Math.random() * 0.30;
                    size = 18 + Math.random() * 4;
                    opacity = 0.76 + Math.random() * 0.14;
                }

                const spawn = getOptimalWindwardSpawn(leaves);
                const newSpeedBase = 0.6 + z * 0.4;
                leaves.push({
                    x: spawn.x,
                    y: spawn.y,
                    z: z,
                    size: size,
                    vx: (0.68 + Math.random() * 0.20) * newSpeedBase,
                    vy: (0.48 + Math.random() * 0.18) * newSpeedBase,
                    pitch: Math.random() * Math.PI * 2,
                    roll: Math.random() * Math.PI * 2,
                    yaw: Math.random() * Math.PI * 2,
                    vPitch: (Math.random() - 0.5) * 0.024,
                    vRoll: 0.018 + Math.random() * 0.028,
                    vYaw: (Math.random() - 0.5) * 0.016,
                    pal: pal,
                    opacity: opacity,
                    swayFreq: 0.7 + Math.random() * 0.6,
                    swayAmp: 0.8 + Math.random() * 1.3,
                    swayPhase: Math.random() * Math.PI * 2,
                    driftVarianceX: (Math.random() - 0.5) * 0.22,
                    driftVarianceY: (Math.random() - 0.5) * 0.16
                });
            }
            leavesNeedSort = true;
        }

        // Depth sort: only when leaves wrap or cadenced during active whirlwind
        if (leavesNeedSort || (whirlwind && (Math.floor(timestamp / 80) % 3 === 0))) {
            leaves.sort((a, b) => (a.z || 1) - (b.z || 1));
            leavesNeedSort = false;
        }

        // Draw each 3D fluttering leaf with dual-sided lighting
        for (let i = 0, len = leaves.length; i < len; i++) {
            const l = leaves[i];
            const z = l.z || 1;
            const s = l.size * (0.6 + z * 0.4);

            // 3D Surface normal: Nz = cos(roll) * cos(pitch)
            const cosRoll = Math.cos(l.roll);
            const cosPitch = Math.cos(l.pitch);
            const Nz = cosRoll * cosPitch;

            // Dual-sided shading: Dorsal (top) vs Ventral (underside)
            const isDorsal = Nz >= 0;
            const col = isDorsal ? l.pal.dorsal : l.pal.ventral;
            const lightShade = isDorsal ? (0.75 + 0.25 * Math.abs(Nz)) : (0.85 + 0.15 * Math.abs(Nz));

            const cr = Math.min(255, Math.round(col.r * lightShade));
            const cg = Math.min(255, Math.round(col.g * lightShade));
            const cb = Math.min(255, Math.round(col.b * lightShade));
            const leafAlpha = l.opacity * (0.5 + Math.abs(Nz) * 0.5);

            ctx.save();
            ctx.translate(l.x, l.y);
            ctx.rotate(l.yaw);

            // 3D Foreshortening scales
            const scaleX = cosRoll;
            const scaleY = cosPitch;
            ctx.scale(scaleX, scaleY);

            if (l.isFragment) {
                // 3D Sliced Half-Leaf Geometry
                ctx.beginPath();
                ctx.moveTo(0, -s * 0.52);
                ctx.lineTo(0, s * 0.52); // Cleaved spine cut edge
                if (l.fragmentSide === 'left') {
                    ctx.quadraticCurveTo(-s * 0.42, -s * 0.12, 0, -s * 0.52);
                } else {
                    ctx.quadraticCurveTo(s * 0.42, -s * 0.12, 0, -s * 0.52);
                }
                ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${leafAlpha})`;
                ctx.fill();

                // Cleaved cut edge highlight
                ctx.strokeStyle = `rgba(255, 235, 190, ${leafAlpha * 0.85})`;
                ctx.lineWidth = 0.9;
                ctx.stroke();
            } else {
                // whole leaf
                ctx.beginPath();
                ctx.moveTo(0, -s * 0.56);
                ctx.bezierCurveTo(s * 0.26, -s * 0.34, s * 0.44, s * 0.04, 0, s * 0.46);
                ctx.bezierCurveTo(-s * 0.44, s * 0.04, -s * 0.26, -s * 0.34, 0, -s * 0.56);
                ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${leafAlpha})`;
                ctx.fill();

                ctx.strokeStyle = `rgba(${Math.round(cr * 0.72)}, ${Math.round(cg * 0.72)}, ${Math.round(cb * 0.72)}, ${leafAlpha * 0.78})`;
                ctx.lineWidth = Math.max(0.55, 0.9 * (1 - Math.abs(Nz)));
                ctx.stroke();

                // stem & midrib
                ctx.beginPath();
                ctx.moveTo(0, -s * 0.50);
                ctx.lineTo(0, s * 0.62);
                ctx.strokeStyle = isDorsal
                    ? `rgba(${Math.round(cr * 0.62)}, ${Math.round(cg * 0.62)}, ${Math.round(cb * 0.62)}, ${leafAlpha * 0.78})`
                    : `rgba(255, 250, 235, ${leafAlpha * 0.42})`;
                ctx.lineWidth = Math.max(0.6, s * 0.032);
                ctx.lineCap = 'round';
                ctx.stroke();

                // lateral veins
                ctx.beginPath();
                ctx.moveTo(0, -s * 0.20);
                ctx.quadraticCurveTo(s * 0.14, -s * 0.12, s * 0.21, -s * 0.02);
                ctx.moveTo(0, -s * 0.20);
                ctx.quadraticCurveTo(-s * 0.14, -s * 0.12, -s * 0.21, -s * 0.02);
                ctx.moveTo(0, s * 0.06);
                ctx.quadraticCurveTo(s * 0.16, s * 0.13, s * 0.22, s * 0.22);
                ctx.moveTo(0, s * 0.06);
                ctx.quadraticCurveTo(-s * 0.16, s * 0.13, -s * 0.22, s * 0.22);
                ctx.lineWidth = Math.max(0.4, s * 0.02);
                ctx.strokeStyle = isDorsal
                    ? `rgba(${Math.round(cr * 0.68)}, ${Math.round(cg * 0.68)}, ${Math.round(cb * 0.68)}, ${leafAlpha * 0.45})`
                    : `rgba(255, 250, 235, ${leafAlpha * 0.26})`;
                ctx.stroke();
            }

            ctx.restore();
        }
    }

    function draw3DWhirlwind() {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        if (!whirlwind || whirlwind.scale <= 0.05) return;
        const { x, y, height, topRadius, bottomRadius, spinAngle, scale, debris, footMotes, funnelGrad } = whirlwind;

        ctx.save();

        // 1. Dynamic 3D Precessing Spine Function
        function getSpine(u) {
            // u from 0 (ground touchdown) to 1 (storm cloud apex)
            const sx = x + Math.sin(spinAngle * 1.35 + u * 2.8) * (14 * scale) + Math.sin(u * 1.6) * (7 * scale);
            const sy = y - u * height;
            const sz = Math.cos(spinAngle * 1.1 + u * 2.4) * (13 * scale);
            const sr = (bottomRadius + Math.pow(u, 1.35) * (topRadius - bottomRadius)) * scale;
            return { sx, sy, sz, sr };
        }

        // ── 2. Ground Touchdown Debris Bowl & Rotating Foot Swirl (u = 0) ──
        const groundSpine = getSpine(0);
        const footR = (bottomRadius * 1.75) * scale;
        const footAspect = 0.36;

        // Concentric soft ground contact dust rings (zero dynamic shader/gradient allocation)
        ctx.beginPath();
        ctx.ellipse(groundSpine.sx, groundSpine.sy, footR * 1.35, footR * 1.35 * footAspect, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(185, 125, 80, ${0.18 * scale})`;
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(groundSpine.sx, groundSpine.sy, footR * 0.75, footR * 0.75 * footAspect, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(215, 160, 110, ${0.28 * scale})`;
        ctx.fill();

        // Rotating ground debris particles
        if (footMotes) {
            for (let m = 0, fLen = footMotes.length; m < fLen; m++) {
                const fm = footMotes[m];
                const fmAngle = fm.angle + spinAngle * 2.6;
                const fx = groundSpine.sx + Math.cos(fmAngle) * (fm.radius * scale);
                const fy = groundSpine.sy + Math.sin(fmAngle) * (fm.radius * scale) * footAspect;
                ctx.beginPath();
                ctx.arc(fx, fy, fm.size * scale, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(210, 150, 95, ${0.65 * scale})`;
                ctx.fill();
            }
        }

        // 3. Funnel wall sheath
        const segments = 14;
        ctx.beginPath();
        for (let i = 0; i <= segments; i++) {
            const s = getSpine(i / segments);
            if (i === 0) ctx.moveTo(s.sx - s.sr, s.sy);
            else ctx.lineTo(s.sx - s.sr, s.sy);
        }
        for (let i = segments; i >= 0; i--) {
            const s = getSpine(i / segments);
            ctx.lineTo(s.sx + s.sr, s.sy);
        }
        ctx.closePath();
        const prevFunnelAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevFunnelAlpha * Math.max(0, Math.min(1, scale));
        ctx.fillStyle = funnelGrad || 'rgba(220, 170, 110, 0.32)';
        ctx.fill();
        ctx.globalAlpha = prevFunnelAlpha;

        // 4. Back helical streamers (z < 0)
        const streamers = 4;
        const steps = 18;
        for (let s = 0; s < streamers; s++) {
            const baseTheta = (Math.PI * 2 / streamers) * s + spinAngle * 2.4;
            ctx.beginPath();
            let first = true;
            for (let i = 0; i <= steps; i++) {
                const u = i / steps;
                const { sx, sy, sz, sr } = getSpine(u);
                const theta = baseTheta + u * 6.2;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);
                const px = sx + cosT * sr;
                const pz = sz + sinT * sr;

                if (pz <= 3) {
                    if (first) { ctx.moveTo(px, sy); first = false; }
                    else ctx.lineTo(px, sy);
                } else {
                    first = true;
                }
            }
            ctx.strokeStyle = `rgba(170, 90, 50, ${0.45 * scale})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // 5. Updraft debris particles
        if (debris) {
            for (let k = 0, dLen = debris.length; k < dLen; k++) {
                const d = debris[k];
                const { sx, sy, sz, sr } = getSpine(d.uHeight);
                const cosT = Math.cos(d.theta);
                const sinT = Math.sin(d.theta);
                const px = sx + cosT * sr;
                const pz = sz + sinT * sr;
                const isForeground = pz >= 0;
                const dSize = (isForeground ? d.size * 1.35 : d.size * 0.72) * scale;
                const dAlpha = (isForeground ? 0.85 : 0.40) * scale;

                ctx.beginPath();
                ctx.ellipse(px, sy, dSize, dSize * 0.45, d.tumble, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${d.pal.dorsal.r}, ${d.pal.dorsal.g}, ${d.pal.dorsal.b}, ${dAlpha})`;
                ctx.fill();
            }
        }

        // 6. Front helical streamers (z > 0)
        for (let s = 0; s < streamers; s++) {
            const baseTheta = (Math.PI * 2 / streamers) * s + spinAngle * 2.4;
            ctx.beginPath();
            let first = true;
            for (let i = 0; i <= steps; i++) {
                const u = i / steps;
                const { sx, sy, sz, sr } = getSpine(u);
                const theta = baseTheta + u * 6.2;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);
                const px = sx + cosT * sr;
                const pz = sz + sinT * sr;

                if (pz >= -2) {
                    if (first) { ctx.moveTo(px, sy); first = false; }
                    else ctx.lineTo(px, sy);
                } else {
                    first = true;
                }
            }
            ctx.strokeStyle = `rgba(255, 250, 235, ${0.80 * scale})`;
            ctx.lineWidth = 2.0;
            ctx.stroke();
        }

        // 7. Top cap sheath
        const topSpine = getSpine(1.0);
        ctx.beginPath();
        ctx.ellipse(topSpine.sx, topSpine.sy, topSpine.sr * 1.4, topSpine.sr * 0.45, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(235, 185, 130, ${0.16 * scale})`;
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(topSpine.sx, topSpine.sy, topSpine.sr * 0.8, topSpine.sr * 0.28, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 230, 185, ${0.24 * scale})`;
        ctx.fill();

        ctx.restore();
    }

    function addTurbulence(delta) {
        windTurbulence = Math.min(80, windTurbulence + delta);
    }

    function resetState() {
        whirlwind = null;
        whirlwindCooldown = 0;
        windClickCount = 0;
        windTurbulence = 0;
        windBursts.length = 0;
        leafCutFlashes.length = 0;
    }

    function teardownState() {
        whirlwind = null;
        leaves = [];
    }

    function scalePositions(sx, sy) {
        if (Array.isArray(leaves) && leaves.length > 0) {
            const target = getTargetLeafCount();
            if (Math.abs(leaves.length - target) >= 4) {
                initLeaves();
                return;
            }
            for (let i = 0; i < leaves.length; i++) {
                leaves[i].x = leaves[i].x * sx;
                leaves[i].y = leaves[i].y * sy;
            }
        }
    }

    return {
        setChromaLeafPalette,
        getAccentRgb: () => activeChromaAccentRgb,
        initLeaves,
        spawnWhirlwind,
        handleWindClick,
        updateWhirlwind,
        updateAndDrawLeaves,
        isWhirlwindActive: () => Boolean(whirlwind),
        getWindBursts: () => windBursts,
        getLeaves: () => leaves,
        getLeafCutFlashes: () => leafCutFlashes,
        addTurbulence,
        resetState,
        teardownState,
        scalePositions
    };
};
