// Cosmic starfield physics: black hole, supernovas, curl-flow, and star layers.
window.pxecore = window.pxecore || {};
window.pxecore.createCosmosEngine = function createCosmosEngine(bridge) {
    let hasFleeingParticles = false;

    function dampParticlesVelocity() {
        if (!hasFleeingParticles) return;
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) {
            hasFleeingParticles = false;
            return;
        }
        const canvasW = pJS.canvas.w || window.innerWidth;
        const canvasH = pJS.canvas.h || window.innerHeight;
        const particles = pJS.particles.array;
        let stillFleeing = false;

        for (let i = 0, len = particles.length; i < len; i++) {
            const p = particles[i];
            if (!p.isFleeing) continue;

            const targetVx = p.vx_i !== undefined ? p.vx_i : 0;
            const targetVy = p.vy_i !== undefined ? p.vy_i : 0;

            if (p.x < -30 || p.x > canvasW + 30 || p.y < -30 || p.y > canvasH + 30) {
                p.vx = targetVx;
                p.vy = targetVy;
                p.isFleeing = false;
                continue;
            }

            // Smooth natural cosmic drag towards baseline cruise velocity
            p.vx = p.vx * 0.93 + targetVx * 0.07;
            p.vy = p.vy * 0.93 + targetVy * 0.07;

            const diff = Math.hypot(p.vx - targetVx, p.vy - targetVy);
            if (diff < 0.15) {
                p.vx = targetVx;
                p.vy = targetVy;
                p.isFleeing = false;
            } else {
                stillFleeing = true;
            }
        }
        hasFleeingParticles = stillFleeing;
    }

    // black hole physics
    let blackHole = null;
    let cosmicTurbulence = 0;
    let supernovaCount = 0;          // Supernova-based black hole trigger (first 3, then 6)
    let lastSupernovaTime = 0;       // Timestamp of last supernova (for decay)
    let blackHoleSpawnCount = 0;     // Number of black holes spawned this session
    function getSupernovaThreshold() {
        return blackHoleSpawnCount === 0 ? 3 : 6;
    }
    const SUPERNOVA_DECAY_TIME = 16000; // 16s without supernova → counter resets

    function spawnBlackHole(x, y) {
        const isMobile = window.innerWidth < 768;
        const maxCr = isMobile ? 22 : 36;
        blackHole = {
            x, y,
            mass: 0, maxMass: 750,
            growthRate: 2.8,           // Slower growth for visible growing state
            age: 0, lifetime: 13500,   // 13.5s lifetime for balanced orbital presence
            coreRadius: 0, maxCoreRadius: maxCr,
            diskAngle: 0, diskSpeed: 0.024,
            state: 'growing', // growing, stable, evaporating
            // accretion filaments
            plasmaFilaments: Array.from({ length: isMobile ? 8 : 14 }, (_, i) => ({
                radiusMul: 1.25 + (i / 14) * 2.2,
                angle: (Math.PI * 2 / 14) * i + Math.random() * 0.4,
                speed: 0.025 + (1.0 / (1.25 + (i / 14) * 2.2)) * 0.035,
                length: 0.35 + Math.random() * 0.55,
                width: 1.4 + Math.random() * 1.2,
                brightness: 0.65 + Math.random() * 0.35
            })),
            // Horizon spark particles
            hawkingSparks: Array.from({ length: isMobile ? 6 : 10 }, () => ({
                angle: Math.random() * Math.PI * 2,
                dist: 1.05 + Math.random() * 0.35,
                life: Math.random(),
                speed: 0.015 + Math.random() * 0.035
            }))
        };
    }

    function updateBlackHole(dtMs) {
        if (cosmicTurbulence > 0) {
            cosmicTurbulence = Math.max(0, cosmicTurbulence - dtMs * 0.024);
        }
        if (!blackHole) return;
        blackHole.age += dtMs;
        const remaining = blackHole.lifetime - blackHole.age;

        // Black hole lifecycle states (growing, stable, evaporating)
        if (remaining < 1800) {
            blackHole.state = 'evaporating';
            blackHole.mass *= 0.88; // rapid mass collapse
            blackHole.diskSpeed += 0.025; // spin up wildly
        } else if (blackHole.mass < blackHole.maxMass) {
            blackHole.state = 'growing';
            blackHole.mass = Math.min(
                blackHole.maxMass,
                blackHole.mass + blackHole.growthRate * (dtMs / 16.67)
            );
        } else {
            blackHole.state = 'stable';
        }

        blackHole.coreRadius = (blackHole.mass / blackHole.maxMass) * blackHole.maxCoreRadius;
        blackHole.diskAngle += blackHole.diskSpeed;

        // update filaments
        if (blackHole.plasmaFilaments) {
            const dt = dtMs / 16.67;
            blackHole.plasmaFilaments.forEach(f => {
                f.angle += f.speed * dt;
            });
        }

        // Update spark particles
        if (blackHole.hawkingSparks) {
            const dt = dtMs / 16.67;
            blackHole.hawkingSparks.forEach(sp => {
                sp.life -= sp.speed * dt;
                sp.angle += 0.03 * dt;
                if (sp.life <= 0) {
                    sp.life = 1.0;
                    sp.angle = Math.random() * Math.PI * 2;
                    sp.dist = 1.05 + Math.random() * 0.35;
                }
            });
        }

        // Explode into a massive supernova flash & shockwave at the very end
        if (blackHole.age >= blackHole.lifetime) {
            explodeBlackHole();
        }
    }

    function explodeBlackHole() {
        if (!blackHole) return;
        const bx = blackHole.x;
        const by = blackHole.y;

        const isMobile = window.innerWidth < 768;
        const debrisCount = isMobile ? 14 : 24;
        const debris = [];
        for (let i = 0; i < debrisCount; i++) {
            const angle = (Math.PI * 2 / debrisCount) * i + (Math.random() - 0.5) * 0.35;
            const speed = 3.5 + Math.random() * 6.5;
            debris.push({
                x: bx, y: by,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r: 1.2 + Math.random() * 1.6,
                life: 1.0,
                decay: 0.018 + Math.random() * 0.016,
                colorType: Math.random() < 0.65 ? 'white' : 'star'
            });
        }

        explosions.push({
            debris: debris,
            flash: 1.4,
            x: bx, y: by,
            flashRadius: 280,
            shockwaveR: 16,
            maxShockwaveR: 540,
            shockwaveOp: 0.92
        });

        pushStarsAwayFromExplosion(bx, by);
        triggerParticlesFlee(bx, by);
        blackHole = null;
    }

    function pushStarsAwayFromExplosion(bx, by) {
        const groups = [bridge.getBgStars(), bridge.getMedStars(), bridge.getBrightStars()];
        for (let g = 0; g < groups.length; g++) {
            const group = groups[g];
            for (let i = 0; i < group.length; i++) {
                const s = group[i];
                if (s.destroyed) continue;
                const dx = s.x - bx;
                const dy = s.y - by;
                const dist = Math.hypot(dx, dy) || 1;
                if (dist > 750) continue;
                const force = Math.max(0, 1 - dist / 750) * 8.5;
                s.vx = (s.vx || 0) + (dx / dist) * force;
                s.vy = (s.vy || 0) + (dy / dist) * force;
            }
        }
    }

    // supernova effects
    let explosions = [];

    function triggerBgStarNova(star) {
        const count = 8;
        const debris = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.4;
            const speed = 1.2 + Math.random() * 2.8;
            debris.push({
                x: star.x, y: star.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r: 0.3 + Math.random() * 1.4,
                life: 1.0,
                decay: 0.012 + Math.random() * 0.016,
                colorType: star.colorType || 'star'
            });
        }
        if (explosions.length >= 4) {
            explosions.shift();
        }
        const flashR = Math.max(12, (star.r || 1) * 8);
        explosions.push({
            debris,
            flash: 0.7,
            x: star.x,
            y: star.y,
            flashRadius: flashR
        });
        star.destroyed = true;
        star.respawnTimer = 3500;
        cosmicTurbulence += 14;
        supernovaCount = Math.min(getSupernovaThreshold() - 1, supernovaCount + 0.35);
    }

    function checkSupernova(cx, cy) {
        // 1. Bright stars — full dramatic supernova (direct, targeted click)
        for (const s of bridge.getBrightStars()) {
            if (s.destroyed) continue;
            const dx = cx - s.x, dy = cy - s.y;
            if (dx * dx + dy * dy < 22 * 22) {
                triggerSupernova(s, 24, s.r * 12);
                return true;
            }
        }
        // 2. Medium stars — mini nova (direct, targeted click)
        for (const s of bridge.getMedStars()) {
            if (s.destroyed) continue;
            const dx = cx - s.x, dy = cy - s.y;
            if (dx * dx + dy * dy < 16 * 16) {
                triggerSupernova(s, 14, s.r * 8);
                return true;
            }
        }
        // Background stars (bridge.getBgStars()) remain passive ambient dust — clicks on empty space do NOT trigger explosions
        // 3. Particles.js constellation nodes (direct node click)
        const pJS = window.pJSDom?.[0]?.pJS;
        if (pJS?.particles?.array?.length) {
            for (const p of pJS.particles.array) {
                const dx = cx - p.x, dy = cy - p.y;
                if (dx * dx + dy * dy < 18 * 18) {
                    bridge.triggerCosmicSparkle(p.x, p.y);
                    const angle = Math.atan2(dy, dx) + Math.PI;
                    p.vx = (p.vx || 0) + Math.cos(angle) * 2.5;
                    p.vy = (p.vy || 0) + Math.sin(angle) * 2.5;
                    p.isFleeing = true;
                    hasFleeingParticles = true;
                    cosmicTurbulence += 10;
                    return true;
                }
            }
        }
        return false;
    }

    function triggerSupernova(star, debrisCount, flashR) {
        const count = Math.min(debrisCount, 16);
        const debris = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
            const speed = 3.0 + Math.random() * 5.2;
            debris.push({
                x: star.x, y: star.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r: 0.5 + Math.random() * 1.6,
                life: 1.0,
                decay: 0.024 + Math.random() * 0.022,
                colorType: star.colorType
            });
        }
        if (explosions.length >= 3) {
            explosions.shift();
        }
        // Clean stellar flash & particle dispersal — no synthetic hollow shockwave ring on star clicks
        explosions.push({
            debris, flash: 1.0, x: star.x, y: star.y, flashRadius: Math.max(24, flashR * 1.45)
        });
        star.destroyed = true;
        star.respawnTimer = 6000;

        // Supernova-based black hole trigger: 6 supernovas = 1 black hole
        const now = performance.now();
        // Decay: if too long since last supernova, reset the counter
        if (now - lastSupernovaTime > SUPERNOVA_DECAY_TIME) {
            supernovaCount = 0;
        }
        lastSupernovaTime = now;
        supernovaCount++;

        const threshold = getSupernovaThreshold();
        if (!blackHole && supernovaCount >= threshold) {
            supernovaCount = 0;
            cosmicTurbulence = 0;
            blackHoleSpawnCount++;
            spawnBlackHole(star.x, star.y);
        }
    }

    // physics engine
    const G = 0.12; // Gravitational constant (tuned for visual feel)

    function applyGravity(star, dt) {
        if (!blackHole || star.destroyed) return;
        const dx = blackHole.x - star.x;
        const dy = blackHole.y - star.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);
        if (dist > 550) return; // influence radius

        // gravitational pull and spiral spin
        const radialForce = G * blackHole.mass / Math.max(distSq, 80);
        const tangentialForce = radialForce * 0.85;

        const ux = dx / dist;
        const uy = dy / dist;

        star.vx += (ux * radialForce - uy * tangentialForce) * dt;
        star.vy += (uy * radialForce + ux * tangentialForce) * dt;
        star.x += star.vx * dt;
        star.y += star.vy * dt;

        // Reached center threshold
        if (dist < blackHole.coreRadius + 2) {
            star.destroyed = true;
            star.respawnTimer = 10000;
        }
    }

    function returnHome(star, dt) {
        if (blackHole || star.destroyed) return;
        if (star.homeX === undefined) return;
        if (star.x === star.homeX && star.y === star.homeY && star.vx === 0 && star.vy === 0) return;
        const dx = star.homeX - star.x;
        const dy = star.homeY - star.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.5) {
            star.x = star.homeX; star.y = star.homeY;
            star.vx = 0; star.vy = 0;
            return;
        }
        // Critically damped glide — stars settle home smoothly without rubber-band bounce
        const damp = Math.pow(0.84, dt);
        star.vx = (star.vx || 0) * damp + dx * (0.045 * dt);
        star.vy = (star.vy || 0) * damp + dy * (0.045 * dt);
        star.x += star.vx * dt;
        star.y += star.vy * dt;
    }

    function updateRespawn(star, dtMs) {
        if (!star.destroyed) return;
        star.respawnTimer -= dtMs;
        if (star.respawnTimer <= 0) {
            star.destroyed = false;
            star.x = star.homeX; star.y = star.homeY;
            star.vx = 0; star.vy = 0;
            star.op = 0;
            if (star.target !== undefined) star.target = 1;
        }
    }

    // Pull particles.js constellation nodes into orbital rotation around black hole
    function clientToParticleCanvasSafe(pJS, clientX, clientY) {
        if (typeof window.clientToParticleCanvas === 'function') {
            return window.clientToParticleCanvas(pJS, clientX, clientY);
        }
        const el = pJS?.canvas?.el;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        const bw = el.width || pJS.canvas.w;
        const bh = el.height || pJS.canvas.h;
        if (!bw || !bh) return null;
        return {
            x: ((clientX - rect.left) / rect.width) * bw,
            y: ((clientY - rect.top) / rect.height) * bh
        };
    }

    // Pull particles.js constellation nodes into orbital rotation around black hole
    function applyBlackHoleToParticlesJS() {
        if (!blackHole) return;
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;

        // blackHole is in CSS/client space (starfield); particles are in canvas buffer space
        const origin = clientToParticleCanvasSafe(pJS, blackHole.x, blackHole.y);
        if (!origin) return;
        const px = pJS.canvas.pxratio || 1;
        const particles = pJS.particles.array;
        const minSafeDist = Math.max(38, blackHole.coreRadius * 2.2) * px;
        const maxDist = 520 * px;

        particles.forEach(p => {
            const dx = origin.x - p.x;
            const dy = origin.y - p.y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);
            if (dist > maxDist || dist < 2) return;

            // Keep orbital radius to avoid line clustering
            if (dist < minSafeDist) {
                const ux = dx / dist;
                const uy = dy / dist;
                p.vx = -uy * 2.2;
                p.vy = ux * 2.2;
                return;
            }

            const radialForce = G * blackHole.mass * 0.10 / Math.max(distSq, 400 * px * px);
            const tangentialForce = radialForce * 0.70;
            const ux = dx / dist;
            const uy = dy / dist;

            p.vx += (ux * radialForce - uy * tangentialForce);
            p.vy += (uy * radialForce + ux * tangentialForce);
        });
    }

    // Incompressible Curl-Flow (∇·F = 0) & Golden Ratio Phyllotaxis (φ)
    const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2; // φ ≈ 1.618033988749895
    const GOLDEN_ANGLE_RAD = (2 * Math.PI) / (GOLDEN_RATIO * GOLDEN_RATIO); // ≈ 2.399963229728653 rad (137.507764°)

    /**
     * Analytical 2D stream-function curl field:
     * ψ(x, y, t) = A1·sin(k1·x + ω1·t)·cos(k1·y - ω2·t) + A2·cos(k2·x - ω3·t)·sin(k2·y + ω1·t)
     * Fx = ∂ψ/∂y, Fy = -∂ψ/∂x  ⇒  ∂Fx/∂x + ∂Fy/∂y ≡ 0 (exact divergence-free flow).
     */
    const curlFlowResult = { fx: 0, fy: 0, divergence: 0 };
    function computeCurlFlow(x, y, timeSec, w1, w2, w3) {
        const k1 = 0.0024;
        const k2 = 0.0042;
        const A1 = 18.0;
        const A2 = 9.5;
        const t = timeSec || 0;
        const _w1 = w1 !== undefined ? w1 : 0.32 * t;
        const _w2 = w2 !== undefined ? w2 : 0.23 * t;
        const _w3 = w3 !== undefined ? w3 : 0.41 * t;

        const s1x = Math.sin(k1 * x + _w1);
        const c1x = Math.cos(k1 * x + _w1);
        const s1y = Math.sin(k1 * y - _w2);
        const c1y = Math.cos(k1 * y - _w2);

        const s2x = Math.sin(k2 * x - _w3);
        const c2x = Math.cos(k2 * x - _w3);
        const s2y = Math.sin(k2 * y + _w1);
        const c2y = Math.cos(k2 * y + _w1);

        curlFlowResult.fx = -A1 * k1 * s1x * s1y + A2 * k2 * c2x * c2y;
        curlFlowResult.fy = -A1 * k1 * c1x * c1y + A2 * k2 * s2x * s2y;
        // Analytical partial derivatives for exact mathematical verification:
        const dfx_dx = -A1 * k1 * k1 * c1x * s1y - A2 * k2 * k2 * s2x * c2y;
        const dfy_dy =  A1 * k1 * k1 * c1x * s1y + A2 * k2 * k2 * s2x * c2y;
        curlFlowResult.divergence = dfx_dx + dfy_dy;

        return curlFlowResult;
    }

    const harmonicOrder = {
        active: false,
        age: 0,
        duration: 5200,
        phaseAngle: 0
    };

    function triggerHarmonicOrder(durationMs = 5200) {
        if (blackHole) return false;
        harmonicOrder.active = true;
        harmonicOrder.age = 0;
        harmonicOrder.duration = Math.max(1200, Math.min(12000, Number(durationMs) || 5200));
        harmonicOrder.phaseAngle = 0;
        return true;
    }

    let antiClumpFrameCounter = 0;
    function applyCurlAndHarmonicOrderToParticlesJS(dtMs, timestamp) {
        if (blackHole || hasFleeingParticles) {
            if (blackHole && harmonicOrder.active) {
                harmonicOrder.active = false;
            }
            return;
        }
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;
        const particles = pJS.particles.array;
        const len = particles.length;
        if (len === 0) return;

        const px = pJS.canvas.pxratio || 1;
        const cw = pJS.canvas.w || (window.innerWidth * px);
        const ch = pJS.canvas.h || (window.innerHeight * px);
        const timeSec = (timestamp || performance.now()) * 0.001;

        if (harmonicOrder.active) {
            harmonicOrder.age += dtMs;
            harmonicOrder.phaseAngle += (dtMs * 0.00055);
            if (harmonicOrder.age >= harmonicOrder.duration) {
                harmonicOrder.active = false;
                const baseSpeed = (pJS.particles?.move?.speed || 0.78) * 0.55;
                for (let i = 0; i < len; i++) {
                    const p = particles[i];
                    const ang = i * GOLDEN_ANGLE_RAD + harmonicOrder.phaseAngle;
                    p.vx = Math.cos(ang) * baseSpeed;
                    p.vy = Math.sin(ang) * baseSpeed;
                }
                return;
            }

            // Envelope: smooth ease-in (first 18%), sustained phyllotaxis resonance, smooth ease-out (last 22%)
            const progress = harmonicOrder.age / harmonicOrder.duration;
            const env = progress < 0.18
                ? (progress / 0.18)
                : (progress > 0.78 ? Math.max(0, (1 - progress) / 0.22) : 1.0);

            const cx = cw * 0.5;
            const cy = ch * 0.5;
            const maxRadius = Math.min(cw, ch) * 0.36;
            const scaleC = maxRadius / Math.sqrt(len + 1);

            for (let i = 0; i < len; i++) {
                const p = particles[i];
                const r = scaleC * Math.sqrt(i + 1);
                const theta = i * GOLDEN_ANGLE_RAD + harmonicOrder.phaseAngle;
                const targetX = cx + r * Math.cos(theta);
                const targetY = cy + r * Math.sin(theta);

                // Damped spring towards Vogel spiral coordinates
                const dx = targetX - p.x;
                const dy = targetY - p.y;
                p.x += dx * (0.11 * env);
                p.y += dy * (0.11 * env);
                p.vx *= (1 - 0.18 * env);
                p.vy *= (1 - 0.18 * env);
            }
            return;
        }

        // Calm cruise: subtle incompressible curl-flow drift (zero divergence, bounded speed <= 1.15)
        if (bridge.isCalmMotion()) return;
        const dtNorm = Math.min(3.0, Math.max(0.1, (dtMs || 16.67) / 16.67));
        const maxCruiseSpeed = 1.15;
        const minDist = 46 * px;
        const minDSq = minDist * minDist;

        const w1 = 0.32 * timeSec;
        const w2 = 0.23 * timeSec;
        const w3 = 0.41 * timeSec;

        for (let i = 0; i < len; i++) {
            const p = particles[i];
            if (p.isFleeing) continue;
            const flow = computeCurlFlow(p.x / px, p.y / px, timeSec, w1, w2, w3);

            // Smooth exponential relaxation toward laminar stream curl flow (eliminates velocity thrashing & jitter)
            const targetVx = (p.vx_i || 0.45) * 0.40 + flow.fx * 6.0;
            const targetVy = (p.vy_i || 0.35) * 0.40 + flow.fy * 6.0;
            p.vx += (targetVx - p.vx) * (0.028 * dtNorm);
            p.vy += (targetVy - p.vy) * (0.028 * dtNorm);

            const sp = Math.hypot(p.vx, p.vy);
            if (sp > maxCruiseSpeed) {
                const scale = maxCruiseSpeed / sp;
                p.vx *= scale;
                p.vy *= scale;
            }
        }

        // Pairwise soft-core anti-clumping: keeps constellation nodes organically separated over time (cadenced every 2nd frame)
        antiClumpFrameCounter = (antiClumpFrameCounter + 1) % 2;
        if (antiClumpFrameCounter === 0) {
            for (let i = 0; i < len; i++) {
                const p = particles[i];
                if (p.isFleeing) continue;
                for (let j = i + 1; j < len; j++) {
                    const p2 = particles[j];
                    if (p2.isFleeing) continue;
                    const dx = p.x - p2.x;
                    if (Math.abs(dx) > minDist) continue;
                    const dy = p.y - p2.y;
                    if (Math.abs(dy) > minDist) continue;
                    const dSq = dx * dx + dy * dy;
                    if (dSq < minDSq && dSq > 0.04) {
                        const d = Math.sqrt(dSq);
                        const push = ((minDist - d) / minDist) * 0.030 * dtNorm;
                        const ux = dx / d;
                        const uy = dy / d;
                        p.vx += ux * push;
                        p.vy += uy * push;
                        p2.vx -= ux * push;
                        p2.vy -= uy * push;
                    }
                }
            }
        }
    }

    function drawHarmonicOrderOverlay(colors) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        if (!harmonicOrder.active || blackHole) return;
        const progress = harmonicOrder.age / harmonicOrder.duration;
        const env = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
        if (env <= 0.01) return;

        const cx = bridge.getW() * 0.5;
        const cy = bridge.getH() * 0.5;
        const maxR = Math.min(bridge.getW(), bridge.getH()) * 0.36;
        const isLight = document.documentElement.classList.contains('light') || Boolean(document.body && document.body.classList.contains('light-theme'));
        const ringCol = isLight ? (colors.accentRgb || colors.star || '132, 50, 26') : (colors.star || '216, 178, 120');

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(harmonicOrder.phaseAngle * 0.5);

        // Golden ratio concentric rings (r / φ^k)
        const baseAlpha = isLight ? 0.28 : 0.16;
        let ringR = maxR;
        for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(0, 0, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${ringCol}, ${(baseAlpha * env * (1 - k * 0.18)).toFixed(3)})`;
            ctx.lineWidth = isLight ? 1.3 : 1.0;
            ctx.stroke();
            ringR /= GOLDEN_RATIO;
        }
        ctx.restore();
    }

    function triggerParticlesFlee(originX, originY) {
        const pJS = window.pJSDom?.[0]?.pJS;
        if (!pJS?.particles?.array) return;
        const px = pJS.canvas.pxratio || 1;
        let ox = originX, oy = originY;
        if (originX !== undefined && originY !== undefined) {
            const mapped = clientToParticleCanvasSafe(pJS, originX, originY);
            if (mapped) { ox = mapped.x; oy = mapped.y; }
        }
        if (ox === undefined || oy === undefined) return;

        const maxBlastDist = Math.max(window.innerWidth, window.innerHeight) * px;
        const particles = pJS.particles.array;
        const baseSpeed = pJS.particles?.move?.speed || 0.6;
        const calmPace = baseSpeed * 0.45;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            // Establish true calm baseline cruise direction & speed
            const angle0 = Math.random() * Math.PI * 2;
            p.vx_i = Math.cos(angle0) * calmPace;
            p.vy_i = Math.sin(angle0) * calmPace;

            const dx = p.x - ox;
            const dy = p.y - oy;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            // Powerful cosmic blast dispersion away from black hole singularity
            // (Accounts for particles.js frame-step factor so particles visibly spray across screen)
            const falloff = Math.max(0.25, 1 - Math.min(1, dist / maxBlastDist));
            const blastSpeed = (9.5 + falloff * 12.5) * Math.min(px, 1.25);

            // Natural cosmic angle scatter (±20°) so matter sprays outward like supernova ejecta
            const scatter = (Math.random() - 0.5) * 0.7;
            const cosS = Math.cos(scatter);
            const sinS = Math.sin(scatter);
            const fleeUx = ux * cosS - uy * sinS;
            const fleeUy = uy * cosS + ux * sinS;

            p.vx = fleeUx * blastSpeed;
            p.vy = fleeUy * blastSpeed;
            // Immediate outward impulse step away from singularity
            p.x += fleeUx * 8 * px;
            p.y += fleeUy * 8 * px;
            p.isFleeing = true;
        }
        hasFleeingParticles = true;
    }

    const bgStarBins = {
        star: [[], [], [], []],
        starAlt: [[], [], [], []],
        white: [[], [], [], []]
    };
    const bgWhiteCores = [];

    function drawBgStars(time, colors) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        const amp = 0.12;
        const calm = bridge.isCalmMotion();
        const white = colors.white || '255, 250, 240';
        const starCol = colors.star || '216, 178, 120';
        const starAltCol = colors.starAlt || '245, 222, 179';

        // Clear existing arrays without reallocating (0 GC pressure)
        for (const k in bgStarBins) {
            const b = bgStarBins[k];
            b[0].length = 0; b[1].length = 0; b[2].length = 0; b[3].length = 0;
        }
        bgWhiteCores.length = 0;

        for (let i = 0, len = bridge.getBgStars().length; i < len; i++) {
            const s = bridge.getBgStars()[i];
            if (s.destroyed || !s.spawned) continue;
            const twinkle = calm
                ? s.baseOp + Math.sin(time * s.twinkleSpeed * 0.4 + s.twinklePhase) * (amp * 0.4)
                : s.baseOp + Math.sin(time * s.twinkleSpeed + s.twinklePhase) * amp;
            const op = Math.max(0.20, Math.min(0.60, twinkle));
            const binIdx = Math.min(3, Math.max(0, Math.floor((op - 0.20) / 0.10)));
            const group = bgStarBins[s.colorType] || bgStarBins.star;
            group[binIdx].push(s);

            if (s.r >= 0.8) {
                bgWhiteCores.push(s);
            }
        }

        const binAlphas = [0.28, 0.40, 0.54, 0.68];
        const colorPalette = {
            star: starCol,
            starAlt: starAltCol,
            white: white
        };

        for (const colKey in bgStarBins) {
            const rgb = colorPalette[colKey];
            const colBins = bgStarBins[colKey];
            for (let b = 0; b < 4; b++) {
                const list = colBins[b];
                if (list.length === 0) continue;
                ctx.beginPath();
                for (let j = 0, jLen = list.length; j < jLen; j++) {
                    const s = list[j];
                    ctx.moveTo(s.x + s.r, s.y);
                    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                }
                ctx.fillStyle = `rgba(${rgb}, ${binAlphas[b] * 0.88})`;
                ctx.fill();
            }
        }

        // Batched crisp white core points
        if (bgWhiteCores.length > 0) {
            ctx.beginPath();
            for (let j = 0, jLen = bgWhiteCores.length; j < jLen; j++) {
                const s = bgWhiteCores[j];
                const cr = Math.max(0.45, s.r * 0.52);
                ctx.moveTo(s.x + cr, s.y);
                ctx.arc(s.x, s.y, cr, 0, Math.PI * 2);
            }
            ctx.fillStyle = `rgba(${white}, 0.85)`;
            ctx.fill();
        }
    }

    // High-performance pre-rendered celestial starlight sprite cache for medium and bright stars
    const celestialStarSpriteCache = new Map();

    function getCelestialStarSprite(outerR, colorStr, whiteStr, isBright = false) {
        const quantR = Math.max(1.5, Math.round(outerR * 2) / 2);
        const cacheKey = `${quantR}_${colorStr}_${isBright ? 'b' : 'm'}`;
        if (celestialStarSpriteCache.has(cacheKey)) {
            return celestialStarSpriteCache.get(cacheKey);
        }

        const pad = 2;
        const radiusInt = Math.ceil(quantR);
        const center = radiusInt + pad;
        const size = center * 2;
        const offCanvas = document.createElement('canvas');
        offCanvas.width = size;
        offCanvas.height = size;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) return null;

        const grad = offCtx.createRadialGradient(center, center, 0, center, center, quantR);
        if (isBright) {
            grad.addColorStop(0, `rgba(${whiteStr}, 1.0)`);
            grad.addColorStop(0.16, `rgba(${whiteStr}, 0.88)`);
            grad.addColorStop(0.40, `rgba(${colorStr}, 0.45)`);
            grad.addColorStop(0.72, `rgba(${colorStr}, 0.14)`);
            grad.addColorStop(1, `rgba(${colorStr}, 0)`);
        } else {
            grad.addColorStop(0, `rgba(${whiteStr}, 1.0)`);
            grad.addColorStop(0.20, `rgba(${whiteStr}, 0.85)`);
            grad.addColorStop(0.48, `rgba(${colorStr}, 0.40)`);
            grad.addColorStop(1, `rgba(${colorStr}, 0)`);
        }

        offCtx.fillStyle = grad;
        offCtx.beginPath();
        offCtx.arc(center, center, quantR, 0, Math.PI * 2, false);
        offCtx.fill();

        const entry = { canvas: offCanvas, halfSize: center };
        if (celestialStarSpriteCache.size > 64) {
            celestialStarSpriteCache.clear();
        }
        celestialStarSpriteCache.set(cacheKey, entry);
        return entry;
    }

    // render medium stars with continuous optical luminosity and subtle micro-glints
    function drawMedStars(colors, time) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        const sky = bridge.getSky();
        const calm = bridge.isCalmMotion();
        const speedScale = calm ? 0.35 : 1.0;
        const white = colors.white || '255, 250, 240';
        const audioEnv = window.__pxecoreAudioEnvelope;
        const audioPulse = (audioEnv && audioEnv.active && !calm) ? (Math.round((1 + audioEnv.bass * 0.22) * 10) / 10) : 1.0;
        for (let i = 0, len = bridge.getMedStars().length; i < len; i++) {
            const s = bridge.getMedStars()[i];
            if (s.destroyed || !s.spawned) continue;
            s.op += (s.target - s.op) * (s.speed * speedScale);
            if (Math.abs(s.op - s.target) < 0.02) {
                const midOp = (sky.starMedOp[0] + sky.starMedOp[1]) * 0.5;
                s.target = s.target > midOp ? sky.starMedOp[0] : sky.starMedOp[1];
            }
            const color = colors[s.colorType] || colors.star;
            const finalOp = Math.max(0.28, Math.min(sky.starMedOp[1], s.op));

            // Smooth celestial gradient bloom: pure white core -> warm golden halo -> transparent edge
            const outerR = s.r * 2.2 * audioPulse;
            const sprite = getCelestialStarSprite(outerR, color, white, false);
            if (sprite) {
                const prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = finalOp;
                ctx.drawImage(sprite.canvas, s.x - sprite.halfSize, s.y - sprite.halfSize);
                ctx.globalAlpha = prevAlpha;
            } else {
                const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, outerR);
                grad.addColorStop(0, `rgba(${white}, ${finalOp})`);
                grad.addColorStop(0.20, `rgba(${white}, ${(finalOp * 0.85).toFixed(3)})`);
                grad.addColorStop(0.48, `rgba(${color}, ${(finalOp * 0.40).toFixed(3)})`);
                grad.addColorStop(1, `rgba(${color}, 0)`);

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(s.x, s.y, outerR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Subtle 4-point micro-glint (optical starlight twinkle flare)
            if (s.r >= 1.2) {
                const glintLen = s.r * 1.8 * audioPulse;
                const glintThick = 0.5;
                ctx.fillStyle = `rgba(${white}, ${(finalOp * 0.45).toFixed(3)})`;
                ctx.fillRect(s.x - glintLen, s.y - glintThick / 2, glintLen * 2, glintThick);
                ctx.fillRect(s.x - glintThick / 2, s.y - glintLen, glintThick, glintLen * 2);
            }
        }
    }

    // render bright stars with radiant optical bloom and precision diffraction spikes
    function drawBrightStars(colors) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        const sky = bridge.getSky();
        const calm = bridge.isCalmMotion();
        const speedScale = calm ? 0.35 : 1.0;
        const white = colors.white || '255, 250, 240';
        const audioEnv = window.__pxecoreAudioEnvelope;
        const audioPulse = (audioEnv && audioEnv.active && !calm) ? (Math.round((1 + audioEnv.bass * 0.25) * 10) / 10) : 1.0;
        for (let i = 0, len = bridge.getBrightStars().length; i < len; i++) {
            const s = bridge.getBrightStars()[i];
            if (s.destroyed || !s.spawned) continue;
            s.op += (s.target - s.op) * (s.speed * speedScale);
            if (Math.abs(s.op - s.target) < 0.03) {
                const midBrightOp = (sky.sparkleOp[0] + sky.sparkleOp[1]) * 0.5;
                s.target = s.target > midBrightOp ? sky.sparkleOp[0] : sky.sparkleOp[1];
            }
            const { x, y, r } = s;
            const op = Math.max(0.42, Math.min(Math.max(0.72, sky.sparkleOp[1]), s.op));
            const color = colors[s.colorType] || colors.star;

            // Layer 1: Smooth celestial optical bloom
            const bloomR = r * 2.6 * audioPulse;
            const sprite = getCelestialStarSprite(bloomR, color, white, true);
            if (sprite) {
                const prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = op;
                ctx.drawImage(sprite.canvas, x - sprite.halfSize, y - sprite.halfSize);
                ctx.globalAlpha = prevAlpha;
            } else {
                const grad = ctx.createRadialGradient(x, y, 0, x, y, bloomR);
                grad.addColorStop(0, `rgba(${white}, ${op})`);
                grad.addColorStop(0.16, `rgba(${white}, ${(op * 0.88).toFixed(3)})`);
                grad.addColorStop(0.40, `rgba(${color}, ${(op * 0.45).toFixed(3)})`);
                grad.addColorStop(0.72, `rgba(${color}, ${(op * 0.14).toFixed(3)})`);
                grad.addColorStop(1, `rgba(${color}, 0)`);

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, bloomR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Layer 2: 4-point diffraction spikes
            if (s.diffraction) {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(s.spikeAngle);
                const spikeLen = Math.min(18, Math.max(8, r * 3.6 + 1) * audioPulse);
                const halfThick = Math.max(0.6, r * 0.25);

                // Golden outer taper
                ctx.fillStyle = `rgba(${color}, ${(op * 0.32).toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(0, -spikeLen);
                ctx.lineTo(halfThick, 0);
                ctx.lineTo(spikeLen, 0);
                ctx.lineTo(0, halfThick);
                ctx.lineTo(0, spikeLen);
                ctx.lineTo(-halfThick, 0);
                ctx.lineTo(-spikeLen, 0);
                ctx.lineTo(0, -halfThick);
                ctx.closePath();
                ctx.fill();

                // Needle-sharp brilliant white central beam
                const innerLen = spikeLen * 0.60;
                const innerThick = Math.max(0.35, halfThick * 0.40);
                ctx.fillStyle = `rgba(${white}, ${(op * 0.60).toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(0, -innerLen);
                ctx.lineTo(innerThick, 0);
                ctx.lineTo(innerLen, 0);
                ctx.lineTo(0, innerThick);
                ctx.lineTo(0, innerLen);
                ctx.lineTo(-innerThick, 0);
                ctx.lineTo(-innerLen, 0);
                ctx.lineTo(0, -innerThick);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Layer 3: Diamond nucleus pinpoint
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.65, r * 0.42), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, 1.0)`;
            ctx.fill();
        }
    }

    // render black hole
    function drawBlackHole(colors) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        if (!blackHole) return;
        const { x, y, coreRadius, diskAngle, state, plasmaFilaments, hawkingSparks } = blackHole;
        const t = blackHole.mass / blackHole.maxMass; // 0→1 intensity
        if (t < 0.01) return;

        // Evaporation jitter
        let jx = 0, jy = 0;
        if (state === 'evaporating') {
            jx = (Math.random() - 0.5) * 3;
            jy = (Math.random() - 0.5) * 3;
        }
        const cx = x + jx, cy = y + jy;
        const cr = coreRadius;

        // 1. Lensing radial gradient
        const lensR = cr * 4.8;
        const lens = ctx.createRadialGradient(cx, cy, cr * 0.8, cx, cy, lensR);
        lens.addColorStop(0, `rgba(${colors.star}, ${t * 0.25})`);
        lens.addColorStop(0.35, `rgba(${colors.starAlt}, ${t * 0.08})`);
        lens.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(cx, cy, lensR, 0, Math.PI * 2);
        ctx.fillStyle = lens;
        ctx.fill();

        // 2. Tilted accretion disk
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(diskAngle * 0.18);
        ctx.scale(1, 0.35); // 3D oblique tilt

        // Diffuse outer halo
        const diskGrad = ctx.createRadialGradient(0, 0, cr * 1.15, 0, 0, cr * 3.6);
        diskGrad.addColorStop(0, `rgba(${colors.star}, ${t * 0.40})`);
        diskGrad.addColorStop(0.35, `rgba(${colors.starBright || colors.star}, ${t * 0.22})`);
        diskGrad.addColorStop(0.75, `rgba(${colors.starAlt}, ${t * 0.08})`);
        diskGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(0, 0, cr * 3.6, 0, Math.PI * 2);
        ctx.fillStyle = diskGrad;
        ctx.fill();

        // Orbit filaments
        if (plasmaFilaments) {
            plasmaFilaments.forEach(f => {
                const fR = cr * f.radiusMul;
                ctx.beginPath();
                ctx.arc(0, 0, fR, f.angle, f.angle + f.length);
                const alpha = f.brightness * t * (Math.cos(f.angle) < 0 ? 0.65 : 0.35);
                ctx.strokeStyle = `rgba(${colors.star}, ${alpha})`;
                ctx.lineWidth = Math.max(1.0, f.width);
                ctx.stroke();
            });
        }
        ctx.restore();

        // 3. Inner ring outline
        ctx.beginPath();
        ctx.arc(cx, cy, cr * 1.16, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 248, 230, ${t * 0.70})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // 4. Center core fill
        ctx.beginPath();
        ctx.arc(cx, cy, cr * 1.04, 0, Math.PI * 2);
        ctx.fillStyle = '#08080a';
        ctx.fill();

        // 5. Evaporation sparks
        if (hawkingSparks && state === 'evaporating') {
            hawkingSparks.forEach(sp => {
                const sparkR = cr * sp.dist;
                const sx = cx + Math.cos(sp.angle) * sparkR;
                const sy = cy + Math.sin(sp.angle) * sparkR;
                ctx.beginPath();
                ctx.arc(sx, sy, 1.0 * sp.life, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${colors.star}, ${sp.life * 0.75})`;
                ctx.fill();
            });
        }
    }

    // render explosions & shockwaves
    function drawExplosions(colors, dt = 1) {
        const ctx = bridge.getCtx();
        if (!ctx) return;
        const step = Math.min(2.5, Math.max(0.2, dt));
        const drag = Math.pow(0.94, step);

        for (let i = explosions.length - 1; i >= 0; i--) {
            const exp = explosions[i];

            // Crisp expanding shockwave ring (black hole blast)
            if (exp.shockwaveR !== undefined && exp.shockwaveR < exp.maxShockwaveR) {
                exp.shockwaveR += ((exp.maxShockwaveR - exp.shockwaveR) * 0.085 + 2.2) * step;
                exp.shockwaveOp *= Math.pow(0.935, step);
                if (exp.shockwaveOp > 0.015) {
                    ctx.beginPath();
                    ctx.arc(exp.x, exp.y, exp.shockwaveR, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(${colors.starAlt}, ${(exp.shockwaveOp * 0.24).toFixed(3)})`;
                    ctx.lineWidth = Math.max(1.5, 5.5 * exp.shockwaveOp);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.arc(exp.x, exp.y, Math.max(2, exp.shockwaveR - 1.5), 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(${colors.white}, ${(exp.shockwaveOp * 0.55).toFixed(3)})`;
                    ctx.lineWidth = Math.max(0.6, 1.4 * exp.shockwaveOp);
                    ctx.stroke();
                }
            }

            // Dynamic expanding stellar flash (exponential fade)
            if (exp.flash > 0.02) {
                const curR = exp.flashRadius * (0.45 + 0.55 * (1 - Math.min(1, exp.flash * 0.6)));
                const fg = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, curR);
                const fAlpha = Math.min(1, exp.flash);
                fg.addColorStop(0, `rgba(${colors.white}, ${(fAlpha * 0.92).toFixed(3)})`);
                fg.addColorStop(0.28, `rgba(${colors.star}, ${(fAlpha * 0.48).toFixed(3)})`);
                fg.addColorStop(1, `rgba(${colors.star}, 0)`);
                ctx.beginPath();
                ctx.arc(exp.x, exp.y, curR, 0, Math.PI * 2);
                ctx.fillStyle = fg;
                ctx.fill();
                exp.flash *= Math.pow(0.87, step);
            } else {
                exp.flash = 0;
            }

            // Fast velocity-aligned spark streaks + pinpoint heads
            let alive = false;
            for (let j = 0; j < exp.debris.length; j++) {
                const d = exp.debris[j];
                if (d.life <= 0) continue;
                alive = true;
                d.x += d.vx * step;
                d.y += d.vy * step;
                d.vx *= drag;
                d.vy *= drag;
                d.life -= d.decay * step;
                if (d.life <= 0) continue;

                const col = colors[d.colorType] || colors.star;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x - d.vx * 1.9, d.y - d.vy * 1.9);
                ctx.strokeStyle = `rgba(${col}, ${(d.life * 0.85).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.7, d.r * d.life);
                ctx.stroke();
            }

            if (!alive && exp.flash <= 0 && (exp.shockwaveOp === undefined || exp.shockwaveOp <= 0.015)) {
                explosions.splice(i, 1);
            }
        }
    }


    function addTurbulence(delta) {
        cosmicTurbulence += delta;
    }

    function decaySupernovas() {
        if (supernovaCount > 0 && performance.now() - lastSupernovaTime > SUPERNOVA_DECAY_TIME) {
            supernovaCount = 0;
        }
    }

    function resetState() {
        blackHole = null;
        explosions.length = 0;
        supernovaCount = 0;
        cosmicTurbulence = 0;
    }

    return {
        GOLDEN_RATIO,
        GOLDEN_ANGLE_RAD,
        SUPERNOVA_DECAY_TIME,
        dampParticlesVelocity,
        spawnBlackHole,
        updateBlackHole,
        explodeBlackHole,
        isBlackHoleActive: () => Boolean(blackHole),
        getBlackHole: () => blackHole,
        getExplosions: () => explosions,
        checkSupernova,
        triggerSupernova,
        updateRespawn,
        applyGravity,
        returnHome,
        applyBlackHoleToParticlesJS,
        computeCurlFlow,
        triggerHarmonicOrder,
        getHarmonicOrder: () => harmonicOrder,
        applyCurlAndHarmonicOrderToParticlesJS,
        drawHarmonicOrderOverlay,
        drawBgStars,
        drawMedStars,
        drawBrightStars,
        drawBlackHole,
        drawExplosions,
        addTurbulence,
        decaySupernovas,
        resetState
    };
};
