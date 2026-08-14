/* === 06-training-build.js — Entraînement d'unités, construction (mur/caserne/pilier), sélection, zones de travail (rect + pinceau) (original: lignes 952-1232) === */
// ---------- Entraînement ----------
function updateBuildings(dt) {
  for (const b of buildings) {
    if (b.train && b.train.active) {
      b.train.timeLeft -= dt;
      if (b.train.timeLeft <= 0) {
        const spot = findFreeAdjacent(b);
        if (spot) spawnUnit(b.train.type, spot.x, spot.y);
        b.train.active = false;
      }
    }
  }
}
function trainWorker() {
  if (!selectedBuilding || selectedBuilding.type !== 'base') return;
  if (selectedBuilding.train && selectedBuilding.train.active) return;
  if (resources.bois < WORKER_COST_BOIS) return;
  resources.bois -= WORKER_COST_BOIS;
  selectedBuilding.train = { active: true, type: 'worker', timeLeft: WORKER_TIME, totalTime: WORKER_TIME };
}
function trainSoldier() {
  if (!selectedBuilding || selectedBuilding.type !== 'barracks') return;
  if (selectedBuilding.train && selectedBuilding.train.active) return;
  if (resources.bois < SOLDIER_COST_BOIS || resources.minerai < SOLDIER_COST_MINERAI) return;
  resources.bois -= SOLDIER_COST_BOIS; resources.minerai -= SOLDIER_COST_MINERAI;
  selectedBuilding.train = { active: true, type: 'soldier', timeLeft: SOLDIER_TIME, totalTime: SOLDIER_TIME };
}

// ---------- Construction (mur / caserne) ----------
let buildMode = null; 
let buildUnitIds = [];
let toastTimer = 0;
function showToast(msg) { document.getElementById('toast').textContent = msg; toastTimer = 1.4; }

function issueBuildOrder(buildType, tx, ty) {
  const w = buildType === 'barracks' ? 3 : buildType === 'pillar' ? 2 : 1;
  const h = w;
  for (let yy = ty; yy < ty + h; yy++) {
    for (let xx = tx; xx < tx + w; xx++) {
      if (!inBounds(xx, yy) || grid[idx(xx, yy)] !== T_EMPTY || buildingGrid[idx(xx, yy)] !== -1 || siteAt(xx, yy)) { showToast('Emplacement invalide'); return; }
    }
  }
  if (buildType === 'wall') {
    if (resources.pierre < WALL_COST_PIERRE) { showToast('Pierre insuffisante'); return; }
    resources.pierre -= WALL_COST_PIERRE;
  } else if (buildType === 'pillar') {
    if (resources.pierre < PILLAR_COST_PIERRE || resources.bois < PILLAR_COST_BOIS) { showToast('Ressources insuffisantes'); return; }
    resources.pierre -= PILLAR_COST_PIERRE; resources.bois -= PILLAR_COST_BOIS;
  } else {
    if (resources.bois < BARRACKS_COST_BOIS || resources.minerai < BARRACKS_COST_MINERAI) { showToast('Ressources insuffisantes'); return; }
    resources.bois -= BARRACKS_COST_BOIS; resources.minerai -= BARRACKS_COST_MINERAI;
  }

  const targetHp = buildType === 'wall' ? WALL_BUILD_HP : buildType === 'pillar' ? PILLAR_BUILD_HP : BARRACKS_BUILD_HP;
  const site = { id: nextSiteId++, type: buildType, x: tx, y: ty, w, h, hp: 0, targetHp };
  sites.push(site);

  // Un seul ouvrier va sur CE chantier (pas tout le groupe sélectionné) : on choisit le
  // plus proche parmi les ouvriers libres ; si tous sont déjà occupés, le plus proche tout
  // court (il ira dans sa file d'attente, après son chantier en cours).
  const candidates = units.filter(u => buildUnitIds.includes(u.id) && u.type === 'worker');
  if (candidates.length === 0) { showToast('Aucun ouvrier assigné'); return; }
  const isBusy = u => u.building || (u.order && (u.order.kind === 'build' || u.order.kind === 'deposit'));
  const free = candidates.filter(u => !isBusy(u));
  const pool = free.length > 0 ? free : candidates;
  let chosen = pool[0], bestD = Infinity;
  for (const u of pool) {
    const d = (u.x - (tx + w / 2)) ** 2 + (u.y - (ty + h / 2)) ** 2;
    if (d < bestD) { bestD = d; chosen = u; }
  }

  if (isBusy(chosen)) {
    chosen.buildQueue = chosen.buildQueue || [];
    chosen.buildQueue.push(site.id);
  } else {
    chosen.zone = null; chosen.mining = false; chosen.mineTarget = null;
    const anchorX = clamp(Math.floor(chosen.x), tx, tx + w - 1);
    const anchorY = clamp(Math.floor(chosen.y), ty, ty + h - 1);
    chosen.order = { kind: 'build', x: anchorX, y: anchorY, siteId: site.id };
  }
}

function cancelBuildOrZoneMode() {
  buildMode = null;
  zoneMode = false;
  brushMode = false;
  mineTool = false;
  isBrushing = false;
  isRightBrushing = false;
  updateBuildUI();
}

function startMineTool() {
  if (selectedIds.size === 0) return;
  const hasWorker = Array.from(selectedIds).some(id => units.find(u => u.id === id)?.type === 'worker');
  if (!hasWorker) { showToast('Sélectionnez des ouvriers'); return; }
  mineTool = !mineTool;
  zoneMode = false; brushMode = false; buildMode = null;
  updateBuildUI();
}

// ---------- Sélection & zones de travail (Rect + Brush) ----------
let selectedIds = new Set();
let selectedBuilding = null;
let selectedWall = null; // { x, y } — tuile de mur sélectionnée (mur = tuile, pas un bâtiment)
let zoneMode = false;
let brushMode = false;
let mineTool = false;
let isBrushing = false;
let isRightBrushing = false;
let rightClickMoved = false;
let brushedTiles = new Set();
let zoneUnitIds = [];
let zones = [];
let nextZoneId = 1;
let pings = [];

function buildingAtTile(tx, ty) {
  if (!inBounds(tx, ty)) return null;
  const id = buildingGrid[idx(tx, ty)];
  return id === -1 ? null : buildingsById[id];
}

function selectAtPoint(sx, sy, shift) {
  const wp = screenToWorld(sx, sy);
  const tile = worldToTile(wp);
  const b = buildingAtTile(tile.x, tile.y);
  if (b) { selectedBuilding = b; selectedWall = null; if (!shift) selectedIds.clear(); updateHUD(); return; }

  if (inBounds(tile.x, tile.y) && grid[idx(tile.x, tile.y)] === T_WALL) {
    selectedWall = { x: tile.x, y: tile.y }; selectedBuilding = null;
    if (!shift) selectedIds.clear();
    updateHUD();
    return;
  }

  let best = null, bestD = 0.7;
  for (const u of units) {
    const d = Math.hypot(u.x - wp.x / TILE, u.y - wp.y / TILE);
    if (d < bestD) { bestD = d; best = u; }
  }
  if (best) {
    if (!shift) selectedIds.clear();
    if (selectedIds.has(best.id)) selectedIds.delete(best.id); else selectedIds.add(best.id);
    selectedBuilding = null; selectedWall = null;
  } else if (!shift) {
    selectedIds.clear(); selectedBuilding = null; selectedWall = null;
  }
  updateHUD();
}

function selectUnitsInBox(p1, p2, shift) {
  const wa = screenToWorld(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
  const wb = screenToWorld(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
  if (!shift) selectedIds.clear();
  selectedBuilding = null;
  selectedWall = null;
  for (const u of units) {
    const px = u.x * TILE, py = u.y * TILE;
    if (px >= wa.x && px <= wb.x && py >= wa.y && py <= wb.y) selectedIds.add(u.id);
  }
  updateHUD();
}

function issueOrderAtScreen(sx, sy) {
  if (selectedIds.size === 0) return;
  const wp = screenToWorld(sx, sy);
  const tile = worldToTile(wp);
  if (!inBounds(tile.x, tile.y)) return;
  for (const u of units) {
    if (!selectedIds.has(u.id)) continue;
    u.zone = null;
    u.mining = false; u.mineTarget = null; u.mineTimer = 0;
    u.building = false; u.buildSite = null; u.resumeTarget = null; u.resumeOrder = null;
    u.path = null;
    // Le clic droit "nu" ne sert plus qu'à se déplacer : jamais de minage automatique.
    // Pour miner, il faut passer par l'onglet Minage (outil "Miner vers" ou "Pinceau").
    u.order = { kind: 'move', x: tile.x, y: tile.y };
  }
  pings.push({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2, t: 0 });
}

function issueTunnelOrderAtScreen(sx, sy) {
  if (selectedIds.size === 0) return;
  const wp = screenToWorld(sx, sy);
  const tile = worldToTile(wp);
  if (!inBounds(tile.x, tile.y)) return;
  let any = false;
  for (const u of units) {
    if (!selectedIds.has(u.id) || u.type !== 'worker') continue;
    u.zone = null;
    u.mining = false; u.mineTarget = null; u.mineTimer = 0;
    u.building = false; u.buildSite = null; u.resumeTarget = null; u.resumeOrder = null;
    u.path = null;
    // Ordre "tunnel" : comme un déplacement, mais autorisé à creuser tout ce qui bloque
    // le chemin le plus direct si aucune route déjà ouverte n'existe (voir updateUnit).
    u.order = { kind: 'tunnel', x: tile.x, y: tile.y };
    // Nouvelle cible : liste vide, remplie au fil de l'eau avec les cases réellement minées
    // (voir recordTunnelMine dans 04-units.js) — la surbrillance correspond alors exactement
    // à ce que l'ouvrier mine pour de vrai, sans tracé théorique qui pourrait diverger.
    u.tunnelPath = [];
    any = true;
  }
  if (any) pings.push({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2, t: 0 });
}

function startZoneMode() {
  if (selectedIds.size === 0) return;
  const ids = [];
  for (const u of units) if (selectedIds.has(u.id) && u.type === 'worker') ids.push(u.id);
  if (ids.length === 0) { showToast('Sélectionnez des ouvriers'); return; }
  zoneUnitIds = ids;
  zoneMode = true;
  brushMode = false;
  mineTool = false;
  buildMode = null;
  updateBuildUI();
}

function startBrushMode() {
  if (selectedIds.size === 0) return;
  const ids = [];
  for (const u of units) if (selectedIds.has(u.id) && u.type === 'worker') ids.push(u.id);
  if (ids.length === 0) { showToast('Sélectionnez des ouvriers'); return; }
  zoneUnitIds = ids;
  brushMode = true;
  zoneMode = false;
  mineTool = false;
  buildMode = null;
  updateBuildUI();
}

function assignRectZone(ids, tx0, ty0, tx1, ty1) {
  const x0 = clamp(Math.min(tx0, tx1), 0, MAP_W - 1), x1 = clamp(Math.max(tx0, tx1), 0, MAP_W - 1);
  const y0 = clamp(Math.min(ty0, ty1), 0, MAP_H - 1), y1 = clamp(Math.max(ty0, ty1), 0, MAP_H - 1);
  const zone = { id: nextZoneId++, type: 'rect', x0, y0, x1, y1 };
  zones.push(zone);
  for (const id of ids) {
    const u = units.find(uu => uu.id === id);
    if (!u || u.type !== 'worker') continue;
    u.zone = zone; u.order = null; u.mining = false; u.mineTarget = null;
  }
}

function assignBrushZone(ids, tilesSet) {
  const tiles = Array.from(tilesSet).map(s => { const p = s.split(','); return {x: +p[0], y: +p[1]}; });
  const zone = { id: nextZoneId++, type: 'path', tiles };
  zones.push(zone);
  for (const id of ids) {
    const u = units.find(uu => uu.id === id);
    if (!u || u.type !== 'worker') continue;
    u.zone = zone; u.order = null; u.mining = false; u.mineTarget = null;
  }
}

function finalizeZoneDrag(p1, p2) {
  const wa = screenToWorld(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
  const wb = screenToWorld(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
  const ta = worldToTile(wa), tb = worldToTile(wb);
  assignRectZone(zoneUnitIds, ta.x, ta.y, tb.x, tb.y);
}

function addBrushTile(sx, sy) {
  const wp = screenToWorld(sx, sy);
  const tx = Math.floor(wp.x / TILE);
  const ty = Math.floor(wp.y / TILE);
  const slider = document.getElementById('brush-slider');
  const w = slider ? parseInt(slider.value) : 1;
  const half = w / 2;
  const x0 = Math.floor(tx - half + 0.5);
  const x1 = Math.ceil(tx + half) - 1;
  const y0 = Math.floor(ty - half + 0.5);
  const y1 = Math.ceil(ty + half) - 1;

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (!inBounds(xx, yy)) continue;
      const explored = !fogEnabled || exploredTile[idx(xx, yy)];
      if (!explored) {
        // jamais vu : impossible de savoir si c'est du vide ou de la roche, donc on
        // ajoute sans distinction (aucun indice visuel sur la forme cachée) — l'ouvrier
        // découvrira en creusant, et la case sera naturellement ignorée si c'est du vide
        brushedTiles.add(xx + ',' + yy);
        continue;
      }
      // case déjà explorée : comportement précis, sans risque de fuite d'info. On n'ajoute
      // plus une case vide déjà explorée, mais on ne retire plus non plus rétroactivement une
      // case déjà ajoutée juste parce qu'on la survole à nouveau — ce retrait créait un trou
      // dans un tracé fin (pinceau largeur 1) quand une case se révélait vide en cours de
      // trace. L'affichage (draw()) filtre de toute façon les cases non minables au rendu.
      if (isMinable(xx, yy)) {
        brushedTiles.add(xx + ',' + yy);
      }
    }
  }
}

// ---------- Destruction / recyclage des bâtiments ----------
const DEMOLISH_REFUND_RATIO = 0.5; // pourcentage des ressources d'origine remboursé

function destroySelectedBuilding() {
  const b = selectedBuilding;
  if (!b || b.type === 'base') return; // la base ne se détruit pas
  if (b.type === 'barracks') {
    resources.bois += Math.round(BARRACKS_COST_BOIS * DEMOLISH_REFUND_RATIO);
    resources.minerai += Math.round(BARRACKS_COST_MINERAI * DEMOLISH_REFUND_RATIO);
  } else if (b.type === 'pillar') {
    resources.pierre += Math.round(PILLAR_COST_PIERRE * DEMOLISH_REFUND_RATIO);
    resources.bois += Math.round(PILLAR_COST_BOIS * DEMOLISH_REFUND_RATIO);
  }
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++)
      buildingGrid[idx(xx, yy)] = -1;
  buildings = buildings.filter(bb => bb !== b);
  delete buildingsById[b.id];
  selectedBuilding = null;
  invalidateBuildingVision();
  updateBuildUI();
  updateHUD();
  showToast('Bâtiment détruit');
}

function destroySelectedWall() {
  if (!selectedWall) return;
  const { x, y } = selectedWall;
  if (!inBounds(x, y) || grid[idx(x, y)] !== T_WALL) { selectedWall = null; updateHUD(); return; }
  resources.pierre += Math.round(WALL_COST_PIERRE * DEMOLISH_REFUND_RATIO);
  onTileCleared(x, y);
  selectedWall = null;
  invalidateBuildingVision();
  updateHUD();
  showToast('Mur détruit');
}
