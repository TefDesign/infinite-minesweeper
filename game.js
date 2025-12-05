// --- 1. CONFIGURATION ---
const HEX_RADIUS = 35; 
const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS;
const HEX_HEIGHT = 2 * HEX_RADIUS;

const MINE_PROBABILITY = 0.28; 
const TOKEN_PROBABILITY = 0.10; // Increased to 0.10
const ZONE_RADIUS = 6; // Spacing for Islands
const ZONE_LOCK_RADIUS = 2; // Real Hexagon Radius (19 cells)
const SAVE_KEY = 'infinite_minesweeper_save_v3.9_hex'; // V3.9 Hex Islands
const NUMBER_COLORS = ['rgba(0,0,0,0)', '#779ECB', '#77DD77', '#FF6961', '#B19CD9', '#FFB347', '#CB99C9'];
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.0;

const COLORS = {
    hidden: '#B9D1DC',
    hiddenHover: '#CDE2EC',
    hiddenUnreachable: '#98B0BB', 
    revealedSafe: '#FEFDF5', 
    revealedMine: '#FFB7B2',
    flag: '#444', 
    token: '#F4D03F', 
    zoneLockedOverlay: 'rgba(50, 50, 50, 0.4)', 
    zoneBorder: 'rgba(255, 255, 255, 0.4)', 
    unlockButton: '#64B5F6',
    unlockButtonHover: '#42A5F5',
    background: '#F0F4F8'
};

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// --- 2. STATE ---
const grid = new Map(); 
const zones = new Map(); 
const visibleLockedZones = new Set();
const revealQueue = [];

let tokens = 10;
let score = 0; 
let flagCount = 0;
let totalRevealed = 0; // Performance optimization tracker
let isProcessingQueue = false;
let GAME_SEED = Math.random(); // Random map by default

// Camera
let camX = window.innerWidth / 2;
let camY = window.innerHeight / 2;
let camZoom = 3; // Initial zoom increased 

// Inputs
let isPanning = false;
let startPanX = 0, startPanY = 0;
let mouseX = 0, mouseY = 0;
let keys = { Space: false };

// --- 3. UTILS & GEOMETRY (HEXAGONAL) ---

const getHash = (u, v, seed = 0) => {
    // Robust hash for negative coords. Mix in Global Seed.
    // Ensure GAME_SEED is used.
    let h = Math.sin(u * 12.9898 + v * 78.233 + seed + GAME_SEED) * 43758.5453123;
    return h - Math.floor(h);
};

const getCellKey = (q, r) => `${q},${r}`;
const parseCellKey = (key) => key.split(',').map(Number);
const getZoneKey = (zq, zr) => `${zq},${zr}`;

// Pointy-topped Hex Geometry
// Axial Coordinates (q, r)
function hexToPixel(q, r) {
    const x = HEX_RADIUS * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
    const y = HEX_RADIUS * (3./2 * r);
    return { x, y };
}

function pixelToHex(x, y) {
    const q = (Math.sqrt(3)/3 * x - 1./3 * y) / HEX_RADIUS;
    const r = (2./3 * y) / HEX_RADIUS;
    return hexRound(q, r);
}

function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs((q1 + r1) - (q2 + r2))) / 2;
}

function hexRound(fracQ, fracR) {
    let fracS = -fracQ - fracR;
    let q = Math.round(fracQ);
    let r = Math.round(fracR);
    let s = Math.round(fracS);

    const q_diff = Math.abs(q - fracQ);
    const r_diff = Math.abs(r - fracR);
    const s_diff = Math.abs(s - fracS);

    if (q_diff > r_diff && q_diff > s_diff) {
        q = -r - s;
    } else if (r_diff > s_diff) {
        r = -q - s;
    }
    return { q, r };
}

function getHexCorners(center) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle_deg = 60 * i - 30; // -30 for pointy topped
        const angle_rad = Math.PI / 180 * angle_deg;
        corners.push({
            x: center.x + HEX_RADIUS * Math.cos(angle_rad),
            y: center.y + HEX_RADIUS * Math.sin(angle_rad)
        });
    }
    return corners;
}

function getHexHash(q, r, seed) {
    return getHash(q, r, seed);
}

const NEIGHBORS_DIRECTIONS = [
    {q: 1, r: 0}, {q: 1, r: -1}, {q: 0, r: -1},
    {q: -1, r: 0}, {q: -1, r: 1}, {q: 0, r: 1}
];

function getNeighbors(q, r) {
    return NEIGHBORS_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

// --- 4. LOGIC (Zones & Cells) ---

const K = ZONE_RADIUS;

// Zones : Super-Hex Tiling
function getZoneID(q, r) {
    // To identify the "Super Hex" containing (q,r), we transform to a larger basis.
    // The "Super Hex" size is defined by ZONE_RADIUS.
    // However, tiling plane with hexagons is best done by rounding in axial coords?
    // Not exactly, simple division gives rhombi.
    // We need "Hexagon Binning".
    // 
    // Ideally: Convert q,r to Pixel, then pixelToHex with a LARGER radius.
    // Let's deduce the center of the zone mathematically.
    // S = ZONE_RADIUS.
    // Actually, let's keep it simple.
    // Let's switch to Rhombus zones but draw them differently? No user wants Hex shape.
    
    // Proper Hexagonal Binning:
    // Scale down coords? 
    // Let's treat distinct centers.
    // A zone is defined by a central hex (CQ, CR).
    // All hexes (q,r) belong to the closest (CQ, CR).
    // The centers are spaced in a tailored lattice.
    //
    // Lattice basis vectors for Super Hex of radius R:
    // A = (2R+1, -R) ? No.
    // Standard tiling:
    // i = 3R+1 ? The spacing is roughly R*sqrt(3) for tight packing?
    // Let's use a simpler approach:
    // We stick to the previous rhombus logic for lookup speed, BUT we mask visibility to be hexagonal?
    // No, that makes gaps.
    
    // Let's try recursive hex rounding.
    // approximate: q_zone = round(q / S), r_zone = round(r / S)? 
    // No, `hexRound(q/S, r/S)` produces hexagonal Voronoi regions! 
    // Yes! That's exactly it.
    // If we simply devide axial coords by a factor K and round to nearest hex integer, 
    // we get regions that are exactly hexagonal shapes.
    
    // We need to use floating point axial rounding.
    // Just passing (q/K, r/K) to existing hexRound helper.
    return hexRound(q / K, r / K);
}

// Rename return from getZoneID to be clear it's the center
function getZoneID_Wrapper(q, r) {
    const center = getZoneID(q, r);
    return { zq: center.q, zr: center.r };
}

// Redefine getZoneData to use this new ID
function getZoneData(zq, zr) {
    const key = getZoneKey(zq, zr);
    if (!zones.has(key)) {
        const dist = Math.abs(zq) + Math.abs(zr);
        
        // Progressive Cost: Minimum 10.
        // Base formula: 8 + 2*dist + random(0-5). 
        // Dist 0 (Center) -> 8..13 -> clamped to 10..13
        // Dist 1 -> 10..15 -> clamped to 10..15
        
        const rawCost = 8 + (dist * 2) + (getHash(zq, zr, 99) * 5);
        const baseCost = Math.max(10, rawCost);
        
        // Default: Unlocked. Locking only happens on mine trigger.
        // Cost is calculated but only used if locked.
        
        zones.set(key, {
            locked: false,
            unlockCost: Math.floor(baseCost),
            zq, zr
        });
    }
    return zones.get(key);
}

function lockZone(zq, zr) {
    const z = getZoneData(zq, zr);
    if (!z.locked) z.locked = true;
}

function unlockZoneWithTokens(zq, zr) {
    const z = getZoneData(zq, zr);
    if (z.locked && tokens >= z.unlockCost) {
        tokens -= z.unlockCost;
        z.locked = false;
        
        // Correct errors in the zone (remove wrong flags)
        correctZoneErrors(zq, zr);
        
        // Visual Effect
        animateUnlock(zq, zr);
        
        updateUI();
        return true;
    }
    return false;
}

function correctZoneErrors(zq, zr) {
    // Iterate hexes in the zone (scan bounding box of Super Hex)
    // Center approx: zq*ZONE_RADIUS, zr*ZONE_RADIUS. Radius approx ZONE_RADIUS+1.
    const centerQ = zq * ZONE_RADIUS;
    const centerR = zr * ZONE_RADIUS;
    const range = ZONE_RADIUS + 2; 

    for (let r = centerR - range; r <= centerR + range; r++) {
        for (let q = centerQ - range; q <= centerQ + range; q++) {
             // Check if this hex belongs to the target zone
             const id = getZoneID_Wrapper(q, r);
             if (id.zq === zq && id.zr === zr) {
                 const key = getCellKey(q, r);
                 const cell = grid.get(key);
                 if (cell && cell.flagged) {
                     if (!isMine(q, r)) {
                         // Incorrect flag! 
                         // Remove flag AND reveal the safe cell (as penalty/correction)
                         cell.flagged = false;
                         cell.revealed = true;
                         cell.count = countMines(q, r);
                         flagCount--;
                         totalRevealed++; // Critical for performance tracker
                     }
                     // If it IS a mine, keep the flag (Correct prediction).
                 }
                 // we might want to "reset" it to hidden so the user can play around it?
                 // Or keep it revealed as a known danger. Note: Revealed mines are danger.
                 // User request: "corrigé". Removing wrong flags is the main point.
             }
        }
    }
}

function animateUnlock(zq, zr) {
    const centerQ = zq * K;
    const centerR = zr * K; 
    const centerPos = hexToPixel(centerQ, centerR); // World Pos
    
    // We create a DOM element for the effect to overlay nicely
    const div = document.createElement('div');
    div.className = 'unlock-ripple';
    document.body.appendChild(div);
    
    // Position needs to be updated to screen coords? 
    // Animation is fast, maybe just initial pos?
    // If user pans during anim, it detaches. 
    // Better: Draw in Canvas? 
    // DOM is easier for complex glowing ring effects. 
    // Let's set initial pos and let it expand.
    
    const scrX = centerPos.x * camZoom + camX;
    const scrY = centerPos.y * camZoom + camY;
    
    div.style.left = scrX + 'px';
    div.style.top = scrY + 'px';
    
    // We can update pos in a requestAnimationFrame if we really want it locked, 
    // but a 0.5s effect is fine static often. 
    // Actually, let's keep it simple.
    
    setTimeout(() => div.remove(), 600);
}

// Cell Logic
function isMine(q, r) {
    // Safe start area (Radius 2 around 0,0)
    if (Math.abs(q) <= 1 && Math.abs(r) <= 1) return false;
    return getHexHash(q, r, 1) < MINE_PROBABILITY;
}

function hasToken(q, r) {
     if (Math.abs(q) <= 1 && Math.abs(r) <= 1) return false;
     if (isMine(q, r)) return false; 
     return getHexHash(q, r, 2) < TOKEN_PROBABILITY;
}

function countMines(q, r) {
    let count = 0;
    getNeighbors(q, r).forEach(n => {
        if (isMine(n.q, n.r)) count++;
    });
    return count;
}

function getCell(q, r) {
    const key = getCellKey(q, r);
    if (!grid.has(key)) {
        grid.set(key, {
            revealed: false,
            flagged: false,
            hasToken: hasToken(q, r),
        });
    }
    return grid.get(key);
}

function isReachable(tq, tr) {
    // Optimized: Check count instead of iterating grid
    if (totalRevealed === 0) return (Math.abs(tq) <= 1 && Math.abs(tr) <= 1);

    const neighbors = getNeighbors(tq, tr);
    for (let n of neighbors) {
        const c = grid.get(getCellKey(n.q, n.r));
        if (c && c.revealed) return true; 
        for (let nn of getNeighbors(n.q, n.r)) {
            const cc = grid.get(getCellKey(nn.q, nn.r));
            if (cc && cc.revealed) return true;
        }
    }
    return false;
}

// --- 5. GAME PLAY LOGIC ---

// Helper to check if a specific cell is effectively locked
function isCellLocked(q, r) {
    const { zq, zr } = getZoneID_Wrapper(q, r);
    const zone = getZoneData(zq, zr);
    if (!zone.locked) return false;
    
    // Check distance to zone center
    const centerQ = zq * ZONE_RADIUS;
    const centerR = zr * ZONE_RADIUS;
    const dist = hexDistance(q, r, centerQ, centerR);
    
    return dist <= ZONE_LOCK_RADIUS;
}

function reveal(q, r) {
    if (isCellLocked(q, r)) return; 

    const cell = getCell(q, r);
    if (cell.revealed || cell.flagged) return;

    // Calc distance to zone center
    const { zq, zr } = getZoneID_Wrapper(q, r);
    const centerQ = zq * ZONE_RADIUS; // Using ZONE_RADIUS as Spacing
    const centerR = zr * ZONE_RADIUS;
    const dist = hexDistance(q, r, centerQ, centerR);

    if (isMine(q, r)) {
        cell.revealed = true;
        cell.isMine = true; 
        
        // Mine triggered -> ALWAYS Lock the Zone (Citadel protects itself)
        // Even if mine is in the outskirts (corridor), the central island locks down.
        lockZone(zq, zr);
        triggerZoneLock();
        
        updateUI();
        return;
    }

    cell.revealed = true;
    cell.isMine = false;
    totalRevealed++;
    cell.count = countMines(q, r);
    score += 10;
    
    if (cell.hasToken) {
        cell.hasToken = false; 
        tokens++;
        animateTokenCollection(q, r);
    }
    
    updateUI();
    
    if (cell.count === 0) {
        getNeighbors(q, r).forEach(n => queueReveal(n.q, n.r));
    }
}

function queueReveal(q, r) {
    revealQueue.push({ q, r });
    if (!isProcessingQueue) processRevealQueue();
}

function processRevealQueue() {
    if (revealQueue.length === 0) {
        isProcessingQueue = false;
        return;
    }
    isProcessingQueue = true;
    let processed = 0;
    while(revealQueue.length > 0 && processed < 8) {
        const { q, r } = revealQueue.shift();
        const cell = getCell(q, r);
        if (!cell.revealed && !cell.flagged) reveal(q, r);
        processed++;
    }
    if (revealQueue.length > 0) requestAnimationFrame(processRevealQueue);
    else isProcessingQueue = false;
}

function toggleFlag(q, r) {
    const { zq, zr } = getZoneID_Wrapper(q, r);
    if (getZoneData(zq, zr).locked) return;

    const cell = getCell(q, r);
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagCount += cell.flagged ? 1 : -1;
    updateUI();
}

function resetGame() {
    GAME_SEED = Math.random(); // New Seed on Reset
    grid.clear();
    zones.clear();
    visibleLockedZones.clear();
    tokens = 10;
    score = 0;
    flagCount = 0;
    totalRevealed = 0;
    camX = canvas.width / 2;
    camY = canvas.height / 2;
    camZoom = 1.5;
    
    localStorage.removeItem(SAVE_KEY);
    
    updateUI();
    draw();
}

// --- 6. RENDERING & ANIMATION ---

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(camX, camY);
    ctx.scale(camZoom, camZoom);
    
    visibleLockedZones.clear();

    const tlX = -camX / camZoom;
    const tlY = -camY / camZoom;
    const brX = (canvas.width - camX) / camZoom;
    const brY = (canvas.height - camY) / camZoom;
    
    // Bounds for Hex Grid (Approx)
    // r approx y / (1.5 * R)
    // q approx (x / R*sqrt(3)) - r/2
    const minR = Math.floor(tlY / (1.5 * HEX_RADIUS)) - 2;
    const maxR = Math.ceil(brY / (1.5 * HEX_RADIUS)) + 2;
    // q range depends on r due to slant
    // Just loop wide enough safely
    const qOffset = Math.ceil((brX - tlX) / HEX_WIDTH) + 2;
    const paramC = (tlX + brX) / 2;
    const centerQ = Math.round(paramC / HEX_WIDTH);

    // Naive Loop: Iterate axial coordinates that cover the screen
    // Creating a proper bounding box in hex coords is standard but tricky.
    // Let's iterate a sufficiently large rect of q and r around screen center projected to hex
    
    const centerHex = pixelToHex((tlX+brX)/2, (tlY+brY)/2);
    const rangeX = Math.ceil((brX - tlX) / HEX_WIDTH / 2) + 2;
    const rangeY = Math.ceil((brY - tlY) / HEX_HEIGHT / 2) + 2;

    for (let r = centerHex.r - rangeY; r <= centerHex.r + rangeY; r++) {
         let rOffset = Math.floor(r/2); // shifted rows
         for (let q = centerHex.q - rangeX - rOffset; q <= centerHex.q + rangeX - rOffset + 2; q++) { // +2 safety
             // Actually, the q range shifts with r.
             // Let's just use a slightly wider loop based on axial logic
             // or simply scan.
             // Simpler: iterate r, then calculate q start/end for that r row to fit screen x
             
             // y = r * 1.5 * R.
             // x = R * sqrt(3) * (q + r/2)
             // => q = (x / (R*sqrt(3))) - r/2
             
             const yRow = r * 1.5 * HEX_RADIUS;
             // Check visibility Y
             if (yRow < tlY - HEX_HEIGHT || yRow > brY + HEX_HEIGHT) continue;
             
             const qMin = Math.floor((tlX / (HEX_RADIUS * Math.sqrt(3))) - r/2) - 1;
             const qMax = Math.ceil((brX / (HEX_RADIUS * Math.sqrt(3))) - r/2) + 1;
             
             for (let qq = qMin; qq <= qMax; qq++) {
                 drawCell(qq, r);
             }
         }
    }
    
    // Draw Locked Zones Overlays (per Zone key)
    // Handled in drawCell now.
    
    ctx.restore();
    
    drawUnlockButtons();
    requestAnimationFrame(draw);
}

function drawCell(q, r) {
    const center = hexToPixel(q, r);
    const key = getCellKey(q, r);
    const cell = grid.get(key) || { revealed: false, flagged: false, hasToken: hasToken(q, r) };
    
    const { zq, zr } = getZoneID_Wrapper(q, r);
    const zone = getZoneData(zq, zr); // Zone Data still needed for "VisibleLockedZones" tracking? 
    // Yes, if cell is in locked radius, we add to visible set.
    
    const distToCenter = hexDistance(q, r, zq*K, zr*K); // Use K for zone center calculation
    const cellIsLocked = zone.locked && distToCenter <= ZONE_LOCK_RADIUS;
    const zKey = getZoneKey(zq, zr);

    const reachable = isReachable(q, r);

    // Zone collection (only if locked and within radius)
    if (cellIsLocked) {
        visibleLockedZones.add(zKey);
    }

    // Geometry
    const corners = getHexCorners(center);

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for(let i=1; i<6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    
    // ... Fill logic ...
    
    if (cell.revealed) {
        ctx.fillStyle = cell.isMine ? COLORS.revealedMine : COLORS.revealedSafe;
    } else {
        if (!reachable) {
             ctx.fillStyle = COLORS.hiddenUnreachable;
        } else {
            const mHex = pixelToHex((mouseX - camX)/camZoom, (mouseY - camY)/camZoom);
            ctx.fillStyle = (mHex.q === q && mHex.r === r) ? COLORS.hiddenHover : COLORS.hidden;
        }
    }
    ctx.fill();
    
    // Zone Border visualization
    if (cellIsLocked) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; 
        ctx.lineWidth = 2;
    } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
    }
    ctx.stroke();

    if (cellIsLocked && peekZoneKey !== zKey) {
        ctx.fillStyle = COLORS.zoneLockedOverlay;
        ctx.fill();
        return; 
    }

    // Ghost Peek: Show content if peeking
    if (cellIsLocked && peekZoneKey === zKey && !cell.revealed) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        
        if (isMine(q, r)) {
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.arc(center.x, center.y, HEX_RADIUS/2.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            const count = countMines(q, r);
            if (count > 0) {
                ctx.fillStyle = NUMBER_COLORS[count] || '#000';
                ctx.font = 'bold 20px Outfit';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(count, center.x, center.y + 2);
            }
        }
        
        if (hasToken(q, r)) {
             ctx.fillStyle = COLORS.token;
             ctx.font = '20px Arial';
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillText('💎', center.x, center.y + 2);
        }
        
        ctx.restore();
    }

    // Normal Content
    if (cell.revealed) {
        if (cell.isMine) {
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.arc(center.x, center.y, HEX_RADIUS/2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (cell.count > 0) {
            ctx.fillStyle = NUMBER_COLORS[cell.count] || '#000';
            ctx.font = 'bold 20px Outfit';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(cell.count, center.x, center.y + 2);
        }
    } else {
        // Flags & Tokens on unrevealed (but not ghost peeking override?)
        // Actually flags are shown on unrevealed.
        if (cell.flagged) {
            ctx.fillStyle = COLORS.flag;
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚩', center.x, center.y + 2);
        } else if (cell.hasToken && isReachable(q,r)) { 
             ctx.fillStyle = COLORS.token;
             ctx.font = '20px Arial';
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillText('💎', center.x, center.y + 2);
        } else if (cell.hasToken && !zone.locked) { // Don't double draw token if ghost handled it?
             // Ghost draws it if locked & peeked. 
             // Here we draw it if NOT locked (normal hint) or if locked but not peeked (unreachable hint?).
             // Logic: hasToken shows up as hint usually.
             ctx.fillStyle = COLORS.token;
             ctx.globalAlpha = 0.5;
             ctx.font = '20px Arial';
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.fillText('💎', center.x, center.y + 2);
             ctx.globalAlpha = 1;
        }
    }
}

// Function drawZoneOverlay removed (unused)

// Rewriting Draw Loop to handle per-cell Overlay?
// Actually, `drawCell` handles `visibleLockedZones.add`. 
// Let's update `drawCell` to paint the overlay if locked.
// And `drawZoneOverlay` will ONLY be used for maybe the border?
// Let's skip complex border for now and just dark overlay per cell.

// Peek State
let peekZoneKey = null;

function drawUnlockButtons() {
    for (let key of visibleLockedZones) {
        // If peeking this zone, skip drawing overlay/buttons so we see content
        if (peekZoneKey === key) continue;

        const [zq, zr] = key.split(',').map(Number);
        const zone = getZoneData(zq, zr);
        
        const centerQ = zq * K; 
        const centerR = zr * K; 
        const centerPos = hexToPixel(centerQ, centerR);
        
        const scrX = centerPos.x * camZoom + camX;
        const scrY = centerPos.y * camZoom + camY;
        
        // Unlock Button
        const btnW = 120;
        const btnH = 40;
        const bx = scrX - btnW/2;
        const by = scrY - btnH/2;
        
        // Peek Button (Small Eye to the right)
        const eyeSize = 30;
        const ex = bx + btnW + 10;
        const ey = by + (btnH - eyeSize)/2;

        const isHoverUnlock = mouseX >= bx && mouseX <= bx+btnW && mouseY >= by && mouseY <= by+btnH;
        const isHoverEye = mouseX >= ex && mouseX <= ex+eyeSize && mouseY >= ey && mouseY <= ey+eyeSize;
        
        // Draw Unlock
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.fillStyle = isHoverUnlock ? COLORS.unlockButtonHover : COLORS.unlockButton;
        ctx.beginPath();
        ctx.roundRect(bx, by, btnW, btnH, 10);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`🔒 ${zone.unlockCost} 💎`, scrX, scrY + 5);

        // Draw Eye
        ctx.fillStyle = isHoverEye ? '#AAA' : '#888';
        ctx.beginPath();
        ctx.arc(ex + eyeSize/2, ey + eyeSize/2, eyeSize/2, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.fillText('👁️', ex + eyeSize/2, ey + eyeSize/2 + 5);
    }
}

function triggerZoneLock() {
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 500);
}

function animateTokenCollection(q, r) {
    const div = document.createElement('div');
    div.innerText = '💎';
    div.style.position = 'absolute';
    div.style.left = '50%';
    div.style.top = '50%';
    div.style.fontSize = '2rem';
    div.style.pointerEvents = 'none';
    div.style.transition = 'all 1s ease-out';
    div.style.zIndex = '999';
    document.body.appendChild(div);
    requestAnimationFrame(() => {
        div.style.transform = 'translateY(-100px) scale(1.5)';
        div.style.opacity = '0';
    });
    setTimeout(() => div.remove(), 1000);
}

function updateUI() {
    const elScore = document.getElementById('score-count');
    if(elScore) elScore.innerText = tokens;
    const elFlag = document.getElementById('flag-count');
    if(elFlag) elFlag.innerText = flagCount;
}

// --- 7. INPUTS & LISTENERS ---

window.addEventListener('resize', resize);

// Modal Logic
const modal = document.getElementById('pause-modal');
const btnClose = document.getElementById('btn-close-modal');
const btnRestart = document.getElementById('btn-restart');

function toggleModal(show) {
    if (show) modal.classList.remove('hidden'), modal.classList.add('visible');
    else modal.classList.remove('visible'), modal.classList.add('hidden');
}

if (btnClose) btnClose.addEventListener('click', () => toggleModal(false));
if (btnRestart) btnRestart.addEventListener('click', () => {
    toggleModal(false);
    resetGame();
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { 
        keys.Space = true; 
        canvas.style.cursor = 'grab'; 
    }
    if (e.code === 'Escape') {
        const isVisible = modal.classList.contains('visible');
        toggleModal(!isVisible);
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { 
        keys.Space = false; 
        canvas.style.cursor = 'crosshair'; 
        isPanning = false; 
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(camZoom * delta, MIN_ZOOM), MAX_ZOOM);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = (mx - camX) / camZoom;
    const worldY = (my - camY) / camZoom;
    camX = mx - worldX * newZoom;
    camY = my - worldY * newZoom;
    camZoom = newZoom;
}, { passive: false });

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;

    if (keys.Space && isPanning) {
        camX += e.clientX - startPanX;
        camY += e.clientY - startPanY;
        startPanX = e.clientX;
        startPanY = e.clientY;
    } else if (keys.Space) {
         // wait
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (keys.Space) {
        isPanning = true;
        startPanX = e.clientX;
        startPanY = e.clientY;
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    // UI Clicks First
    for (let key of visibleLockedZones) {
        if (peekZoneKey === key) continue; // If peeking, interactions on zone might be needed? No, peeking just shows.
        
        const [zq, zr] = key.split(',').map(Number);
        
        const centerQ = zq * K;
        const centerR = zr * K; 
        const centerPos = hexToPixel(centerQ, centerR);
        
        const scrX = centerPos.x * camZoom + camX;
        const scrY = centerPos.y * camZoom + camY;
        
        const btnW = 120;
        const btnH = 40;
        const bx = scrX - btnW/2;
        const by = scrY - btnH/2;
        
        const eyeSize = 30;
        const ex = bx + btnW + 10;
        const ey = by + (btnH - eyeSize)/2;

        if (mouseX >= bx && mouseX <= bx+btnW && mouseY >= by && mouseY <= by+btnH) {
             unlockZoneWithTokens(zq, zr);
             return;
        }
        
        if (mouseX >= ex && mouseX <= ex+eyeSize && mouseY >= ey && mouseY <= ey+eyeSize) {
             peekZoneKey = key;
             draw();
             return;
        }
    }
    
    // Hex Select
    const mHex = pixelToHex((mouseX - camX)/camZoom, (mouseY - camY)/camZoom);
    if (!isReachable(mHex.q, mHex.r)) return; 

    if (e.button === 0) reveal(mHex.q, mHex.r);       // Left Click = Reveal
    else if (e.button === 2) toggleFlag(mHex.q, mHex.r); // Right Click = Flag
});

canvas.addEventListener('mouseup', () => {
    if (peekZoneKey) {
        peekZoneKey = null;
        draw();
    }
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = keys.Space ? 'grab' : 'crosshair';
    }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- 8. PERSISTENCE ---

function saveGame() {
    const savedGrid = [];
    for (let [key, cell] of grid) {
        if (cell.revealed || cell.flagged || (cell.hasOwnProperty('hasToken') && !cell.hasToken)) {
             let data = {};
             if (cell.revealed) data.r = 1;
             if (cell.flagged) data.f = 1;
             if (cell.hasToken !== undefined) data.t = cell.hasToken ? 1 : 0;
             if (cell.isMine) data.m = 1;
             savedGrid.push([key, data]);
        }
    }
    const savedZones = [];
    for (let [key, zone] of zones) {
        if (zone.locked) savedZones.push(key);
    }
    const state = { 
        tokens, 
        score,
        flagCount, 
        seed: GAME_SEED, // Save Seed
        cam: { x: camX, y: camY, zoom: camZoom }, 
        grid: savedGrid, 
        zones: savedZones 
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
}

function loadGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    try {
        const state = JSON.parse(raw);
        tokens = state.tokens || 10;
        score = state.score || 0;
        flagCount = state.flagCount || 0;
        GAME_SEED = state.seed || Math.random(); // Restore Seed
        if (state.cam) { 
            camX = state.cam.x; 
            camY = state.cam.y; 
            camZoom = state.cam.zoom || 1.0;
        }
        grid.clear();
        if (state.grid) {
            state.grid.forEach(([key, data]) => {
                const cell = {
                    revealed: !!data.r, 
                    flagged: !!data.f, 
                    isMine: !!data.m,
                    hasToken: (data.t !== undefined) ? !!data.t : undefined,
                };
                if (cell.revealed && !cell.isMine) {
                    const [q, r] = parseCellKey(key);
                    cell.count = countMines(q, r);
                    totalRevealed++; // Increment if revealed
                }
                grid.set(key, cell);
            });
        }
        zones.clear();
        if (state.zones) {
            state.zones.forEach(key => {
                const parts = key.split(',').map(Number);
                if (parts.length === 2) {
                     const [zq, zr] = parts;
                     const z = getZoneData(zq, zr);
                     z.locked = true;
                }
            });
        }
        return true;
    } catch (e) { return false; }
}

setInterval(saveGame, 5000);
window.addEventListener('beforeunload', saveGame);

// --- 9. STARTUP ---

resize();
if (!loadGame()) {
    resetGame();
}
updateUI();
