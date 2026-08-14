/* === 10-render.js — Rendu canvas : tuiles, bâtiments, chantiers, unités, effets, draw() (original: lignes 1694-1914) === */
// Trois paliers pour le sol vide, en nuances de noir très proches (gradient discret plutôt
// que des gris qui tranchent) : noir = jamais visité (rien dessiné, fond de la scène) / noir
// à peine plus clair = déjà exploré mais hors du champ de vision actuel / encore un cran plus
// clair = dans le champ de vision actuel (unité, tourelle, ou tout autre bâtiment allié).
const EMPTY_FLOOR_EXPLORED_COLOR = '#0d0d0d';
const EMPTY_FLOOR_VISIBLE_COLOR = '#111111';

function drawTile(tx, ty, time) {
  const i = idx(tx, ty);
  const t = grid[i];
  if (fogEnabled && !exploredTile[i]) return; // jamais visité : rien dessiné, fond noir
  const visible = !fogEnabled || visibleNow[i];
  const px = tx * TILE, py = ty * TILE;

  if (t === T_EMPTY) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = visible ? EMPTY_FLOOR_VISIBLE_COLOR : EMPTY_FLOOR_EXPLORED_COLOR;
    ctx.fillRect(px, py, TILE, TILE);
    return;
  }

  const dim = visible ? 1 : 0.5;
  ctx.globalAlpha = dim;
  if (t === T_STONE) {
    ctx.fillStyle = stoneShades[tileSeed[i] % stoneShades.length];
    ctx.fillRect(px, py, TILE, TILE);
  } else if (t === T_WOOD) {
    const frac = tileMaxHP[i] > 0 ? tileHP[i] / tileMaxHP[i] : 0;
    ctx.fillStyle = lerpColor(COLOR_WOOD_LO, COLOR_WOOD_HI, frac);
    ctx.fillRect(px, py, TILE, TILE);
  } else if (t === T_MINERAL) {
    const frac = tileMaxHP[i] > 0 ? tileHP[i] / tileMaxHP[i] : 0;
    ctx.fillStyle = lerpColor(COLOR_MIN_LO, COLOR_MIN_HI, frac);
    ctx.fillRect(px, py, TILE, TILE);
  } else if (t === T_WALL) {
    ctx.fillStyle = '#d8cf9d';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = '#8f8863'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    if (tileMaxHP[i] > 0 && tileHP[i] < tileMaxHP[i]) {
      const frac = Math.max(0, tileHP[i] / tileMaxHP[i]);
      ctx.fillStyle = '#111'; ctx.fillRect(px, py - 4, TILE, 3);
      ctx.fillStyle = frac < 0.3 ? '#d8544a' : '#4fd1c5'; ctx.fillRect(px, py - 4, TILE * frac, 3);
    }
    if (selectedWall && selectedWall.x === tx && selectedWall.y === ty) {
      ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 2;
      ctx.strokeRect(px - 1, py - 1, TILE + 2, TILE + 2);
    }
  } else if (t === T_GAS) {
    const pulse = 0.65 + 0.3 * Math.sin(time * 4 + i * 0.13);
    ctx.fillStyle = `rgba(150,90,210,${pulse})`;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = 'rgba(210,170,255,0.7)';
    ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
  }
  ctx.globalAlpha = 1;
}

function drawBuilding(b) {
  const i0 = idx(b.x, b.y);
  if (fogEnabled && b.owner !== 'player' && !exploredTile[i0]) return;
  const dim = (fogEnabled && b.owner !== 'player' && !visibleNow[i0]) ? 0.55 : 1;
  const px = b.x * TILE, py = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
  ctx.globalAlpha = dim;
  let fill, stroke;
  if (b.type === 'base') { fill = b.owner === 'player' ? '#d1a35c' : '#8a4a6a'; stroke = b.owner === 'player' ? '#7a5a2e' : '#5a2a44'; }
  else if (b.type === 'pillar') { fill = '#7fd1ae'; stroke = '#3c7a5e'; }
  else { fill = '#c1543f'; stroke = '#7a2f22'; }
  ctx.fillStyle = fill; ctx.fillRect(px, py, w, h);
  ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  if (selectedBuilding === b) { ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 2; ctx.strokeRect(px - 2, py - 2, w + 4, h + 4); }
  if (b.hp < b.maxhp) {
    const frac = Math.max(0, b.hp / b.maxhp);
    ctx.fillStyle = '#222'; ctx.fillRect(px, py - 6, w, 4);
    ctx.fillStyle = frac < 0.3 ? '#d8544a' : '#4fd1c5'; ctx.fillRect(px, py - 6, w * frac, 4);
  }
  ctx.globalAlpha = 1;
}

function drawSite(s) {
  const px = s.x * TILE, py = s.y * TILE, w = s.w * TILE, h = s.h * TILE;
  ctx.fillStyle = 'rgba(79,209,197,0.25)';
  ctx.fillRect(px, py, w, h);
  ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 2]); ctx.strokeRect(px, py, w, h); ctx.setLineDash([]);
  const frac = s.hp / s.targetHp;
  ctx.fillStyle = '#111'; ctx.fillRect(px, py - 6, w, 4);
  ctx.fillStyle = '#e3a23c'; ctx.fillRect(px, py - 6, w * frac, 4);
}

function drawUnit(u, time) {
  const pulse = 1 + 0.16 * Math.sin(time * 3 + u.animSeed);
  const base = u.type === 'soldier' ? TILE * 0.62 : TILE * 0.48;
  const size = base * pulse;
  const px = u.x * TILE, py = u.y * TILE;

  // Sélection
  if (selectedIds.has(u.id)) {
    ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 1.5;
    const r = size * 0.7;
    ctx.strokeRect(px - r, py - r, r * 2, r * 2);
  }
  
  // Corps de l'unité
  ctx.fillStyle = u.type === 'soldier' ? '#e0483f' : '#f2f2ea';
  ctx.fillRect(px - size / 2, py - size / 2, size, size);

  // Barre de vie
  if (u.hp < u.maxhp) {
    const hpFrac = Math.max(0, u.hp / u.maxhp);
    ctx.fillStyle = '#222'; ctx.fillRect(px - size / 2, py - size / 2 - 5, size, 3);
    ctx.fillStyle = hpFrac < 0.3 ? '#d8544a' : '#4fd1c5'; ctx.fillRect(px - size / 2, py - size / 2 - 5, size * hpFrac, 3);
  }
  
  // Barre de minage
  if (u.mining && u.mineTarget) {
    const i = idx(u.mineTarget.x, u.mineTarget.y);
    if (tileMaxHP[i] > 0) {
      const frac = tileHP[i] / tileMaxHP[i];
      const bx = u.mineTarget.x * TILE, by = u.mineTarget.y * TILE - 5;
      ctx.fillStyle = '#111'; ctx.fillRect(bx, by, TILE, 3);
      ctx.fillStyle = '#e3a23c'; ctx.fillRect(bx, by, TILE * (1 - frac), 3);
    }
  }

  // Inventaire multi-couleurs
  if (u.inventory) {
    const resourceColors = {
      bois: '#a06a35',    // Marron
      minerai: '#3f8fe0', // Bleu
      pierre: '#9199a1'   // Gris
    };
    const pxs = 3;
    let slotIndex = 0;

    // Dessine les ressources stockées
    for (const [resType, count] of Object.entries(u.inventory)) {
      if (count <= 0) continue;
      ctx.fillStyle = resourceColors[resType] || '#ffffff';
      for (let n = 0; n < count && slotIndex < CARRY_CAPACITY; n++) {
        ctx.fillRect(px - size / 2 + slotIndex * (pxs + 1), py + size / 2 + 2, pxs, pxs);
        slotIndex++;
      }
    }

    // Dessine les emplacements vides restants
    ctx.fillStyle = 'rgba(255,255,255,0.0)';
    while (slotIndex < CARRY_CAPACITY) {
      ctx.fillRect(px - size / 2 + slotIndex * (pxs + 1), py + size / 2 + 2, pxs, pxs);
      slotIndex++;
    }
  }
}

function draw(time) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);

  if (zoom < OVERVIEW_THRESHOLD) {
    ctx.drawImage(overviewCanvas, 0, 0, MAP_W, MAP_H, 0, 0, MAP_W * TILE, MAP_H * TILE);
  } else {
    const x0 = Math.max(0, Math.floor(camera.x / TILE));
    const y0 = Math.max(0, Math.floor(camera.y / TILE));
    const x1 = Math.min(MAP_W, Math.ceil((camera.x + canvas.width / zoom) / TILE) + 1);
    const y1 = Math.min(MAP_H, Math.ceil((camera.y + canvas.height / zoom) / TILE) + 1);
    for (let ty = y0; ty < y1; ty++)
      for (let tx = x0; tx < x1; tx++)
        drawTile(tx, ty, time);
  }

  for (const z of zones) {
    ctx.save();
    ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 1.5;
    if (z.type === 'rect') {
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(z.x0 * TILE, z.y0 * TILE, (z.x1 - z.x0 + 1) * TILE, (z.y1 - z.y0 + 1) * TILE);
    } else if (z.type === 'path') {
      ctx.fillStyle = 'rgba(227,162,60,0.15)';
      for (const t of z.tiles) {
        // isHighlightableUnknownSafe : ne garde pas en surbrillance une case déjà minée
        // (redevenue vide et explorée), MAIS n'exclut jamais une case encore inexplorée —
        // sinon le simple fait qu'une case du pinceau "manque" trahirait la forme d'une
        // grotte cachée à travers le brouillard.
        if (isHighlightableUnknownSafe(t.x, t.y)) ctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
      }
    }
    ctx.restore();
  }

  // Surbrillance persistante du travail restant pour toute unité en train de creuser vers
  // une destination (ordre "tunnel") : apparaît une fois l'ordre donné (clic droit).
  // u.tunnelPath contient exactement les cases réellement ciblées pour le minage au fil de
  // l'eau (voir recordTunnelMine dans 04-units.js) — pas un tracé théorique précalculé — donc
  // ça ne suit plus l'ouvrier ET ça correspond à ce qu'il mine pour de vrai ; les cases déjà
  // minées disparaissent de l'affichage (filtre isMinable ci-dessous).
  for (const u of units) {
    if (u.owner !== 'player' || !u.order || u.order.kind !== 'tunnel') continue;
    const path = u.tunnelPath || [];
    ctx.fillStyle = 'rgba(227,162,60,0.18)';
    for (const p of path) {
      if (isHighlightableUnknownSafe(p.x, p.y)) ctx.fillRect(p.x * TILE, p.y * TILE, TILE, TILE);
    }
    ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 1.5;
    ctx.strokeRect(u.order.x * TILE, u.order.y * TILE, TILE, TILE);
  }

  if (mineTool) {
    const wp = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
    const t = worldToTile(wp);
    let originX = null, originY = null;
    for (const u of units) { if (selectedIds.has(u.id) && u.type === 'worker') { originX = u.x; originY = u.y; break; } }
    if (originX !== null) {
      ctx.fillStyle = 'rgba(227,162,60,0.12)'; // aperçu au survol, avant clic : encore plus discret
      const steps = Math.ceil(dist(originX, originY, t.x + 0.5, t.y + 0.5));
      for (let i = 0; i <= steps; i++) {
        const lx = Math.round(originX + (t.x + 0.5 - originX) * (i / steps));
        const ly = Math.round(originY + (t.y + 0.5 - originY) * (i / steps));
        // isHighlightableUnknownSafe (pas isMinable seul) : une case jamais explorée doit
        // toujours apparaître dans l'aperçu, sinon un "trou" dans la ligne trahirait la
        // présence d'une grotte cachée avant même de l'avoir découverte.
        if (isHighlightableUnknownSafe(lx, ly)) ctx.fillRect(lx * TILE, ly * TILE, TILE, TILE);
      }
    }
    ctx.strokeStyle = '#e3a23c'; ctx.lineWidth = 1.5;
    ctx.strokeRect(t.x * TILE, t.y * TILE, TILE, TILE);
  }

  if (brushMode || isBrushing) {
    const slider = document.getElementById('brush-slider');
    const w = slider ? parseInt(slider.value) : 1;
    const half = w / 2;
    const wp = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
    const t = worldToTile(wp);
    
    ctx.fillStyle = 'rgba(227,162,60,0.22)';
    ctx.fillRect((t.x - Math.floor(half - 0.5)) * TILE, (t.y - Math.floor(half - 0.5)) * TILE, w * TILE, w * TILE);
    
    ctx.fillStyle = 'rgba(227,162,60,0.45)';
    for (let key of brushedTiles) {
      let [bx, by] = key.split(',').map(Number);
      // isHighlightableUnknownSafe : case déjà explorée et vide -> plus rien d'utile à miner,
      // masquée ; case pas encore explorée -> toujours affichée (aperçu "à l'aveugle", sans
      // trahir si c'est réellement de la roche ou déjà du vide caché par le brouillard).
      if (isHighlightableUnknownSafe(bx, by)) ctx.fillRect(bx * TILE, by * TILE, TILE, TILE);
    }
  }

  for (const s of sites) drawSite(s);
  for (const b of buildings) drawBuilding(b);
  for (const u of units) drawUnit(u, time);

  for (const p of pings) {
    const t = p.t / 0.45;
    ctx.strokeStyle = `rgba(227,162,60,${1 - t})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 + t * 14, 0, Math.PI * 2); ctx.stroke();
  }
  for (const ex of explosions) {
    const t = ex.t / 0.9;
    ctx.strokeStyle = `rgba(255,120,60,${1 - t})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ex.x, ex.y, 10 + t * 220, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,180,80,${(1 - t) * 0.2})`;
    ctx.beginPath(); ctx.arc(ex.x, ex.y, 10 + t * 220, 0, Math.PI * 2); ctx.fill();
  }

  if (buildMode) {
    const wp = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
    const t = worldToTile(wp);
    const w = buildMode === 'barracks' ? 3 : buildMode === 'pillar' ? 2 : 1, h = w;
    ctx.fillStyle = 'rgba(79,209,197,0.35)';
    ctx.fillRect(t.x * TILE, t.y * TILE, w * TILE, h * TILE);
    ctx.strokeStyle = '#4fd1c5';
    ctx.strokeRect(t.x * TILE, t.y * TILE, w * TILE, h * TILE);
  }

  ctx.restore();
}

