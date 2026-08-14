/* === 05-fog-overview.js — Brouillard de guerre + minicarte (aperçu) (original: lignes 882-950) === */
// ---------- Brouillard de guerre ----------
// Vision "en projection" (line-of-sight) : depuis chaque source (unité ou bâtiment), on
// lance des rayons dans toutes les directions ; un rayon s'arrête dès qu'il touche une case
// non vide (roche/bois/minerai/mur/gaz) — on voit la face de l'obstacle, pas ce qu'il y a
// derrière. Chaque source calcule sa propre vision indépendamment : une zone cachée par un
// mur pour une source peut très bien être vue par une autre source alliée placée ailleurs.
let fogEnabled = true;

// ignoreBuildingId : id du bâtiment source à ne pas considérer comme un obstacle envers
// lui-même (sinon un bâtiment se bloquerait sa propre vue dès la sortie de son emprise).
// -1 = aucun bâtiment à ignorer (cas des unités : rien n'est jamais exclu).
//
// Parcours de grille exact (variante de l'algorithme d'Amanatides & Woo), pas un
// échantillonnage à pas fixe : on avance de frontière de case en frontière de case le long de
// la droite, donc on visite EXACTEMENT toutes les cases traversées par le rayon, sans jamais
// en sauter une (contrairement à un pas fixe de 1 case, qui peut "sauter" une case fine en
// diagonale). Pour une source immobile, le résultat est parfaitement stable d'une frame à
// l'autre ; c'était la cause du clignotement observé sur les murs proches d'une unité.
function castVisionRay(cx, cy, angle, maxR, out, ignoreBuildingId) {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  let mapX = Math.floor(cx), mapY = Math.floor(cy);
  const deltaDistX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaDistY = dirY === 0 ? Infinity : Math.abs(1 / dirY);
  let stepX, sideDistX, stepY, sideDistY;
  if (dirX < 0) { stepX = -1; sideDistX = (cx - mapX) * deltaDistX; }
  else { stepX = 1; sideDistX = (mapX + 1 - cx) * deltaDistX; }
  if (dirY < 0) { stepY = -1; sideDistY = (cy - mapY) * deltaDistY; }
  else { stepY = 1; sideDistY = (mapY + 1 - cy) * deltaDistY; }

  let guard = 0;
  while (guard++ < 2048) {
    let travelled;
    if (sideDistX < sideDistY) { travelled = sideDistX; sideDistX += deltaDistX; mapX += stepX; }
    else { travelled = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
    if (travelled > maxR) break;
    if (!inBounds(mapX, mapY)) break;
    const i = idx(mapX, mapY);
    out.push(i);
    // Obstacle = case non vide (roche/bois/minerai/mur/gaz) OU case occupée par un bâtiment
    // (base/caserne/pilier — solides, ils bloquent la vue comme un mur), sauf le bâtiment
    // source lui-même. On voit la face de l'obstacle, le rayon s'arrête là.
    const blockedByTerrain = grid[i] !== T_EMPTY;
    const blockedByBuilding = buildingGrid[i] !== -1 && buildingGrid[i] !== ignoreBuildingId;
    if (blockedByTerrain || blockedByBuilding) break;
  }
}

function computeLOSVisibleTiles(cx, cy, r, ignoreBuildingId) {
  if (ignoreBuildingId === undefined) ignoreBuildingId = -1;
  const out = [];
  // Voisinage immédiat toujours visible (évite un angle mort juste à côté de la source,
  // ex. une base collée à un mur).
  const nx0 = Math.max(0, Math.floor(cx - 1)), nx1 = Math.min(MAP_W - 1, Math.ceil(cx + 1));
  const ny0 = Math.max(0, Math.floor(cy - 1)), ny1 = Math.min(MAP_H - 1, Math.ceil(cy + 1));
  for (let yy = ny0; yy <= ny1; yy++) for (let xx = nx0; xx <= nx1; xx++) out.push(idx(xx, yy));

  const capped = Math.min(r, VISION_MAX_RANGE);
  const rayCount = Math.max(24, Math.ceil(2 * Math.PI * capped));
  for (let k = 0; k < rayCount; k++) {
    castVisionRay(cx, cy, (k / rayCount) * Math.PI * 2, capped, out, ignoreBuildingId);
  }
  return out;
}

function revealLOS(cx, cy, r) {
  // Source = unité : aucun bâtiment à ignorer, un bâtiment sur le chemin bloque toujours.
  const tiles = computeLOSVisibleTiles(cx, cy, r, -1);
  for (const i of tiles) { visibleNow[i] = 1; exploredTile[i] = 1; }
}

// Les bâtiments sont statiques : recalculer leur vision (potentiellement très coûteuse pour
// la tour, portée quasi infinie) à chaque frame serait inutile. On la met en cache et on ne
// la recalcule qu'une fois par seconde (ou immédiatement après une construction/destruction,
// voir invalidateBuildingVision), pendant que la vision des unités — qui bougent — reste
// recalculée à chaque frame.
let buildingVisionCache = {};
let lastBuildingVisionRefresh = -999;
const BUILDING_VISION_REFRESH = 1.0;
function invalidateBuildingVision() { lastBuildingVisionRefresh = -999; }
function refreshBuildingVisionCache() {
  const fresh = {};
  for (const b of buildings) {
    if (b.owner !== 'player') continue;
    const r = b.type === 'base' ? BASE_VISION
      : b.type === 'pillar' ? PILLAR_VISION
      : b.type === 'outpost' ? OUTPOST_VISION
      : b.type === 'lab' ? LAB_VISION
      : b.type === 'turret' ? TURRET_VISION
      : BARRACKS_VISION;
    // Le bâtiment ignore sa propre emprise comme obstacle (sinon il se bloquerait lui-même
    // dès la sortie de son empreinte), mais tout AUTRE bâtiment sur le chemin bloque bien.
    fresh[b.id] = computeLOSVisibleTiles(b.x + b.w / 2, b.y + b.h / 2, r, b.id);
  }
  buildingVisionCache = fresh;
}

function updateVision() {
  if (!fogEnabled) return;
  visibleNow.fill(0);

  for (const u of units) {
    if (u.owner !== 'player') continue;
    revealLOS(u.x, u.y, u.type === 'worker' ? WORKER_VISION : SOLDIER_VISION); // toutes les unités de combat (COMBAT_UNIT_TYPES) partagent la vision du soldat, pour rester simple
  }

  if (gameTime - lastBuildingVisionRefresh >= BUILDING_VISION_REFRESH) {
    lastBuildingVisionRefresh = gameTime;
    refreshBuildingVisionCache();
  }
  for (const b of buildings) {
    if (b.owner !== 'player') continue;
    const cache = buildingVisionCache[b.id];
    if (!cache) continue;
    for (const i of cache) { visibleNow[i] = 1; exploredTile[i] = 1; }
  }
}

// ---------- Aperçu ----------
const overviewCanvas = document.createElement('canvas');
overviewCanvas.width = MAP_W; overviewCanvas.height = MAP_H;
const overviewCtx = overviewCanvas.getContext('2d');
const overviewImageData = overviewCtx.createImageData(MAP_W, MAP_H);
function rebuildOverview() {
  const data = overviewImageData.data;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      const p = i * 4;
      let r = 5, g = 5, b = 5;
      const explored = !fogEnabled || exploredTile[i];
      if (explored) {
        const t = grid[i];
        let col;
        if (t === T_EMPTY) col = [10, 10, 10];
        else if (t === T_STONE) col = [70, 74, 80];
        else if (t === T_WOOD) col = [140, 100, 50];
        else if (t === T_MINERAL) col = [60, 130, 200];
        else if (t === T_WALL) col = [216, 207, 157];
        else if (t === T_GAS) col = [150, 90, 200];
        else col = [10, 10, 10];
        const vis = !fogEnabled || visibleNow[i];
        const dim = vis ? 1 : 0.5;
        r = col[0] * dim; g = col[1] * dim; b = col[2] * dim;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
  overviewCtx.putImageData(overviewImageData, 0, 0);
  for (const bld of buildings) {
    const i0 = idx(bld.x, bld.y);
    let explored = !fogEnabled || bld.owner === 'player' || exploredTile[i0];
    if (!explored) continue;
    // Minicarte simplifiée : l'avant-poste reprend la couleur de la base (même famille de
    // bâtiment), le labo une teinte violette dédiée, le reste (caserne/pilier/mur) en rouge.
    const col = (bld.type === 'base' || bld.type === 'outpost')
      ? (bld.owner === 'player' ? [209, 163, 92] : [138, 74, 106])
      : bld.type === 'lab' ? [138, 111, 209]
      : [193, 84, 63];
    overviewCtx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    overviewCtx.fillRect(bld.x, bld.y, bld.w, bld.h);
  }
}
