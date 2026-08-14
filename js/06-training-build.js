/* === 06-training-build.js — Entraînement d'unités, construction (mur/caserne/pilier), sélection, zones de travail (rect + pinceau) (original: lignes 952-1232) === */
// ---------- Entraînement ----------
// Démarre effectivement une production dans un emplacement (train/train2) donné : minuteur
// réinitialisé selon le type d'unité (voir WORKER_TIME/SOLDIER_TIME dans 01-constants.js).
function startProductionInSlot(b, slotKey, type) {
  const time = type === 'worker' ? WORKER_TIME : SOLDIER_TIME;
  b[slotKey] = { active: true, type, timeLeft: time, totalTime: time };
}

// Démarre la production immédiatement dans le premier emplacement libre parmi `slotKeys`, ou —
// si tous sont occupés — l'ajoute à la file d'attente du bâtiment (b.trainQueue) pour qu'elle
// démarre automatiquement dès qu'un emplacement se libère (voir updateBuildings ci-dessous).
// Permet d'avoir PLUSIEURS unités en cours de fabrication empilées sur un même bâtiment plutôt
// que de perdre le clic quand tous les emplacements actifs sont déjà occupés.
function enqueueProduction(b, slotKeys, type) {
  for (const slotKey of slotKeys) {
    if (!b[slotKey] || !b[slotKey].active) { startProductionInSlot(b, slotKey, type); return; }
  }
  b.trainQueue = b.trainQueue || [];
  b.trainQueue.push(type);
}

// Fait progresser toute production en cours (voir b.train, et b.train2 pour la base une fois
// l'amélioration "production" débloquée) : décrémente le temps restant et, une fois écoulé,
// fait apparaître l'unité sur une case libre adjacente au bâtiment producteur, puis enchaîne
// immédiatement sur la prochaine unité en file d'attente s'il y en a une.
function updateBuildings(dt) {
  for (const b of buildings) {
    for (const slotKey of ['train', 'train2']) {
      const slot = b[slotKey];
      if (slot && slot.active) {
        slot.timeLeft -= dt;
        if (slot.timeLeft <= 0) {
          const spot = findFreeAdjacent(b);
          // L'unité formée appartient au camp DU BÂTIMENT producteur (b.owner) — sans ça, toute
          // production rivale (voir updateRivalAI dans 09-update.js) créerait par erreur des
          // unités 'player' (owner par défaut de spawnUnit).
          if (spot) spawnUnit(slot.type, spot.x, spot.y, b.owner);
          slot.active = false;
          if (b.trainQueue && b.trainQueue.length > 0) {
            startProductionInSlot(b, slotKey, b.trainQueue.shift());
          }
        }
      }
    }
  }
}
// Lance (ou met en file d'attente) la production d'un ouvrier depuis la base (ou l'avant-poste,
// voir OUTPOST_SIZE dans 01-constants.js — un avant-poste est une base secondaire, il forme
// donc des ouvriers lui aussi) sélectionné(e), débite le coût immédiatement (pas au moment où
// l'unité apparaît, ni au moment où elle sort de la file). Normalement une seule production
// active à la fois par bâtiment ; une fois l'amélioration "production" débloquée
// (research.production, voir 01/03), une SECONDE production peut démarrer en parallèle (slot
// train2) pendant que la première est encore en cours. Au-delà, tout nouveau clic empile une
// unité de plus dans la file d'attente (b.trainQueue), jusqu'à TRAIN_QUEUE_MAX.
function trainWorker() {
  // owner !== 'player' : un bâtiment rival reste sélectionnable pour consultation (voir
  // updateHUD dans 08-hud-ui.js, kind 'enemy-building'), mais ne doit jamais pouvoir être
  // actionné par le joueur, que ce soit via un clic (bouton déjà masqué côté panneau) OU un
  // raccourci clavier (voir 07-camera-input.js, qui ne filtre PAS par owner — cette garde ici
  // est donc la protection réelle, pas juste cosmétique) : sans elle, sélectionner une base
  // rivale puis appuyer sur "1" ferait dépenser les ressources DU JOUEUR pour faire apparaître
  // une unité... rivale (spawnUnit reçoit b.owner).
  if (!selectedBuilding || selectedBuilding.owner !== 'player' || (selectedBuilding.type !== 'base' && selectedBuilding.type !== 'outpost')) return;
  const b = selectedBuilding;
  const slotKeys = research.production ? ['train', 'train2'] : ['train'];
  const allBusy = slotKeys.every(k => b[k] && b[k].active);
  if (allBusy && (b.trainQueue || []).length >= TRAIN_QUEUE_MAX) return;
  if (resources.bois < WORKER_COST_BOIS) return;
  resources.bois -= WORKER_COST_BOIS;
  enqueueProduction(b, slotKeys, 'worker');
}
// Même principe que trainWorker, mais depuis une caserne et avec un coût bois+minerai — la
// caserne n'a qu'un seul emplacement actif (pas de train2, même avec la recherche "production"),
// mais bénéficie elle aussi de la file d'attente.
function trainSoldier() {
  if (!selectedBuilding || selectedBuilding.owner !== 'player' || selectedBuilding.type !== 'barracks') return; // voir la note owner dans trainWorker ci-dessus
  const b = selectedBuilding;
  const busy = b.train && b.train.active;
  if (busy && (b.trainQueue || []).length >= TRAIN_QUEUE_MAX) return;
  if (resources.bois < SOLDIER_COST_BOIS || resources.minerai < SOLDIER_COST_MINERAI) return;
  resources.bois -= SOLDIER_COST_BOIS; resources.minerai -= SOLDIER_COST_MINERAI;
  enqueueProduction(b, ['train'], 'soldier');
}

// ---------- Recherche (laboratoire) ----------
// Coût en minerai du PROCHAIN niveau d'une amélioration à 4 niveaux (inventory/speed/drill/
// resist), ou du palier unique "production" — null si déjà au niveau max (rien de plus à
// débloquer). Voir RESEARCH_* dans 01-constants.js et `research` dans 03-simulation.js.
function nextResearchCost(key) {
  if (key === 'production') return research.production ? null : RESEARCH_PRODUCTION_COST_MINERAI;
  const level = research[key];
  if (level === undefined || level >= RESEARCH_MAX_LEVEL) return null;
  return RESEARCH_COSTS_MINERAI[level];
}

// Lance la recherche `key` sur le laboratoire sélectionné — un seul labo peut chercher à la
// fois (pas de file d'attente). Débite le minerai immédiatement ; la recherche se termine
// RESEARCH_DURATION secondes plus tard (voir updateResearch), avec de la fumée émise entre-
// temps par le bâtiment (voir spawnSmokeParticle dans 03-simulation.js et son rendu dans
// 10-render.js).
function startResearch(key) {
  if (!selectedBuilding || selectedBuilding.owner !== 'player' || selectedBuilding.type !== 'lab') return; // voir la note owner dans trainWorker ci-dessus
  const b = selectedBuilding;
  if (b.research && b.research.active) { showToast('Recherche déjà en cours'); return; }
  const cost = nextResearchCost(key);
  if (cost === null) { showToast('Niveau maximum atteint'); return; }
  if (resources.minerai < cost) { showToast('Minerai insuffisant'); return; }
  resources.minerai -= cost;
  b.research = { active: true, key, timeLeft: RESEARCH_DURATION, totalTime: RESEARCH_DURATION };
}

// Fait progresser toute recherche en cours dans chaque laboratoire du joueur : émet de la
// fumée périodiquement (probabilité par frame pondérée par dt, indépendante du framerate), et
// une fois le temps écoulé, incrémente le niveau débloqué (ou active le palier "production")
// et répercute IMMÉDIATEMENT l'effet sur toutes les unités déjà existantes (voir
// applyResearchToUnit dans 04-units.js), pas seulement les futures — c'est ce qui rend ces
// améliorations globales plutôt qu'à appliquer unité par unité.
function updateResearch(dt) {
  for (const b of buildings) {
    if (b.type !== 'lab' || !b.research || !b.research.active) continue;
    b.research.timeLeft -= dt;
    if (Math.random() < dt * 3) spawnSmokeParticle(b.x * TILE + b.w * TILE / 2, b.y * TILE);
    if (b.research.timeLeft <= 0) {
      const key = b.research.key;
      if (key === 'production') research.production = true;
      else if (research[key] !== undefined) research[key] = Math.min(RESEARCH_MAX_LEVEL, research[key] + 1);
      b.research.active = false;
      for (const u of units) if (u.owner === 'player') applyResearchToUnit(u);
      showToast('Recherche terminée !');
    }
  }
}

// ---------- Construction (mur / caserne) ----------
let buildMode = null; 
let buildUnitIds = [];
let toastTimer = 0;
function showToast(msg) { document.getElementById('toast').textContent = msg; toastTimer = 1.4; }

// Table de config par type de bâtiment constructible : gabarit, coût (par ressource), PV cible
// du chantier — utilisée par issueBuildOrder pour éviter une chaîne de if/else à rallonge à
// chaque nouveau type de bâtiment ajouté (mur/caserne/pilier/avant-poste/labo).
const BUILD_TYPES = {
  wall:     { w: 1,           h: 1,           cost: { pierre: WALL_COST_PIERRE },                        targetHp: WALL_BUILD_HP },
  barracks: { w: 3,           h: 3,           cost: { bois: BARRACKS_COST_BOIS, minerai: BARRACKS_COST_MINERAI }, targetHp: BARRACKS_BUILD_HP },
  pillar:   { w: 2,           h: 2,           cost: { pierre: PILLAR_COST_PIERRE, bois: PILLAR_COST_BOIS }, targetHp: PILLAR_BUILD_HP },
  outpost:  { w: OUTPOST_SIZE, h: OUTPOST_SIZE, cost: { bois: OUTPOST_COST_BOIS, pierre: OUTPOST_COST_PIERRE }, targetHp: OUTPOST_BUILD_HP },
  lab:      { w: LAB_SIZE,    h: LAB_SIZE,    cost: { bois: LAB_COST_BOIS, minerai: LAB_COST_MINERAI },   targetHp: LAB_BUILD_HP },
};

// Lance un chantier de construction (mur/caserne/pilier/avant-poste/labo) à l'emplacement
// (tx,ty) : vérifie que toutes les cases du rectangle sont libres et non déjà occupées par un
// autre chantier, débite le coût en ressources (voir BUILD_TYPES), crée l'entrée dans `sites`
// (voir 03-simulation.js pour siteAt/completeSite), puis assigne UN SEUL ouvrier du groupe
// sélectionné pour bâtiment (buildUnitIds, voir startBuildMode dans 08-hud-ui.js) — le plus
// proche parmi les ouvriers libres, ou à défaut le plus proche tout court (qui ira dans sa
// file d'attente buildQueue).
function issueBuildOrder(buildType, tx, ty) {
  const spec = BUILD_TYPES[buildType];
  if (!spec) return;
  const w = spec.w, h = spec.h;
  if (!canPlaceFootprint(tx, ty, w, h)) { showToast('Emplacement invalide'); return; }
  for (const [res, amount] of Object.entries(spec.cost)) {
    if (resources[res] < amount) { showToast('Ressources insuffisantes'); return; }
  }
  for (const [res, amount] of Object.entries(spec.cost)) resources[res] -= amount;

  const site = { id: nextSiteId++, type: buildType, x: tx, y: ty, w, h, hp: 0, targetHp: spec.targetHp };
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

// Désactive tous les modes d'outil actifs à la fois (construction, zone, pinceau, miner-vers,
// attaque-vers) — appelé notamment par la touche Échap (voir 07-camera-input.js).
function cancelBuildOrZoneMode() {
  buildMode = null;
  zoneMode = false;
  brushMode = false;
  mineTool = false;
  attackMode = false;
  isBrushing = false;
  isRightBrushing = false;
  updateBuildUI();
}

// Active/désactive l'outil "Miner vers" (clic droit sur une case pour y creuser un chemin
// direct, voir issueTunnelOrderAtScreen) pour les ouvriers actuellement sélectionnés.
function startMineTool() {
  if (selectedIds.size === 0) return;
  const hasWorker = Array.from(selectedIds).some(id => units.find(u => u.id === id)?.type === 'worker');
  if (!hasWorker) { showToast('Sélectionnez des ouvriers'); return; }
  mineTool = !mineTool;
  zoneMode = false; brushMode = false; buildMode = null; attackMode = false;
  updateBuildUI();
}

// Active/désactive l'outil "Attaquer" (clic droit sur une cible — unité/bâtiment ennemi ou
// simple point de la carte — pour y envoyer les soldats sélectionnés en attaque-déplacement,
// voir issueAttackOrderAtScreen) pour les soldats actuellement sélectionnés.
function startAttackMode() {
  if (selectedIds.size === 0) return;
  const hasSoldier = Array.from(selectedIds).some(id => units.find(u => u.id === id)?.type === 'soldier');
  if (!hasSoldier) { showToast('Sélectionnez des soldats'); return; }
  attackMode = !attackMode;
  zoneMode = false; brushMode = false; buildMode = null; mineTool = false;
  updateBuildUI();
}

// "Défendre position" (bouton instantané, pas un mode de ciblage à la souris comme
// startAttackMode) : les soldats sélectionnés s'arrêtent là où ils sont et gardent ce point —
// voir la stance 'hold' dans updateCombat (04-units.js), qui les fait riposter tout seuls si un
// ennemi s'approche, et y retourner une fois la menace écartée.
function defendPosition() {
  let any = false;
  for (const u of units) {
    if (!selectedIds.has(u.id) || u.type !== 'soldier') continue;
    u.zone = null;
    u.mining = false; u.mineTarget = null; u.mineTimer = 0;
    u.building = false; u.buildSite = null; u.resumeTarget = null; u.resumeOrder = null;
    u.path = null; u.order = null;
    u.stance = 'hold';
    u.holdX = u.x; u.holdY = u.y;
    any = true;
  }
  if (any) showToast('Position défendue');
}

// ---------- Sélection & zones de travail (Rect + Brush) ----------
let selectedIds = new Set();
// Compteur incrémenté à chaque changement RÉEL de la sélection d'unités (voir bumpSelection) —
// sert de clé bon marché pour détecter un changement de sélection dans updateHUD (08-hud-ui.js)
// sans avoir à trier + joindre selectedIds en chaîne à CHAQUE frame (coûteux avec beaucoup
// d'unités sélectionnées à la fois, ex. 500 : c'était la cause du ralentissement observé).
let selectionVersion = 0;
function bumpSelection() { selectionVersion++; }
let selectedBuilding = null;
let selectedWall = null; // { x, y } — tuile de mur sélectionnée (mur = tuile, pas un bâtiment)
let zoneMode = false;
let brushMode = false;
let mineTool = false;
let attackMode = false; // outil "Attaquer" actif (voir startAttackMode / issueAttackOrderAtScreen)
let isBrushing = false;
let isRightBrushing = false;
let rightClickMoved = false;
let brushedTiles = new Set();
let zoneUnitIds = [];
let zones = [];
let nextZoneId = 1;
let pings = [];

// Renvoie le bâtiment occupant la case (tx,ty) via buildingGrid, ou null.
function buildingAtTile(tx, ty) {
  if (!inBounds(tx, ty)) return null;
  const id = buildingGrid[idx(tx, ty)];
  return id === -1 ? null : buildingsById[id];
}

// Clic simple : sélectionne, dans l'ordre de priorité, un bâtiment > un mur > l'unité la plus
// proche du point cliqué (dans un rayon de 0.7 case) ; shift ajoute/retire de la sélection
// d'unités existante au lieu de la remplacer.
function selectAtPoint(sx, sy, shift) {
  const wp = screenToWorld(sx, sy);
  const tile = worldToTile(wp);
  const b = buildingAtTile(tile.x, tile.y);
  if (b) { selectedBuilding = b; selectedWall = null; if (!shift) selectedIds.clear(); bumpSelection(); updateHUD(); return; }

  if (inBounds(tile.x, tile.y) && grid[idx(tile.x, tile.y)] === T_WALL) {
    selectedWall = { x: tile.x, y: tile.y }; selectedBuilding = null;
    if (!shift) selectedIds.clear();
    bumpSelection();
    updateHUD();
    return;
  }

  // Seules les unités DU JOUEUR sont sélectionnables au clic (une unité rivale, voir
  // updateRivalAI dans 09-update.js, ne doit jamais pouvoir être prise sous contrôle direct) —
  // avant l'IA rivale, ce filtre était inutile puisqu'aucune unité 'rival' n'existait.
  let best = null, bestD = 0.7;
  for (const u of units) {
    if (u.owner !== 'player') continue;
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
  bumpSelection();
  updateHUD();
}

// Sélection rectangulaire (glisser-déposer souris) : ajoute à la sélection toute unité dont le
// centre tombe dans le rectangle écran p1-p2.
function selectUnitsInBox(p1, p2, shift) {
  const wa = screenToWorld(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y));
  const wb = screenToWorld(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y));
  if (!shift) selectedIds.clear();
  selectedBuilding = null;
  selectedWall = null;
  for (const u of units) {
    if (u.owner !== 'player') continue; // même règle que selectAtPoint : jamais d'unité rivale sélectionnable
    const px = u.x * TILE, py = u.y * TILE;
    if (px >= wa.x && px <= wb.x && py >= wa.y && py <= wb.y) selectedIds.add(u.id);
  }
  bumpSelection();
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
    // Annule une éventuelle "Défendre position" (stance 'hold', voir defendPosition) : sans ça,
    // un simple déplacement resterait ancré sur l'ancien point défendu et un soldat y
    // repartirait tout seul une fois arrivé à destination et l'ordre de déplacement résolu (le
    // point 'hold' n'a plus aucun sens une fois qu'on lui a demandé d'aller ailleurs).
    u.stance = 'idle';
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
    // Préremplit IMMÉDIATEMENT toute la surbrillance avec la ligne droite vers la cible
    // (directLineTiles, voir 03-simulation.js) : c'est le trajet "normal" que l'unité va
    // suivre en creusant tout droit, donc autant l'afficher en entier dès l'ordre donné (comme
    // le pinceau) plutôt que d'attendre que l'unité mine case par case pour le révéler. Si
    // l'unité doit finalement dévier de cette ligne (mur incassable, cavité...), updateUnit
    // rappellera recordTunnelMine avec les cases réellement empruntées, qui s'ajouteront à
    // cette base sans jamais rien retirer d'incorrect (une case minée disparaît de toute façon
    // de l'affichage via isHighlightableUnknownSafe, voir 10-render.js).
    u.tunnelPath = directLineTiles(u.x, u.y, tile.x, tile.y);
    any = true;
  }
  if (any) pings.push({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2, t: 0 });
}

// Envoie les soldats sélectionnés attaquer la case cliquée (outil "Attaquer", voir
// startAttackMode) : cible en priorité un bâtiment ennemi si la case en contient un, sinon
// l'unité ennemie la plus proche du point cliqué (rayon large, cliquer assez précisément n'est
// pas nécessaire), sinon un simple point de la carte — "attaque-déplacement" classique, tout
// ennemi croisé en chemin sera engagé automatiquement (voir updateCombat dans 04-units.js).
function issueAttackOrderAtScreen(sx, sy) {
  if (selectedIds.size === 0) return;
  const wp = screenToWorld(sx, sy);
  const tile = worldToTile(wp);
  if (!inBounds(tile.x, tile.y)) return;

  const bAtTile = buildingAtTile(tile.x, tile.y);
  let targetBuildingId = null, targetUnitId = null;
  if (bAtTile && bAtTile.owner !== 'player') {
    targetBuildingId = bAtTile.id;
  } else {
    let best = null, bestD = 1.2;
    for (const u of units) {
      if (u.owner === 'player') continue;
      const d = Math.hypot(u.x - wp.x / TILE, u.y - wp.y / TILE);
      if (d < bestD) { bestD = d; best = u; }
    }
    if (best) targetUnitId = best.id;
  }

  let any = false;
  for (const u of units) {
    if (!selectedIds.has(u.id) || u.type !== 'soldier') continue;
    u.zone = null;
    u.mining = false; u.mineTarget = null; u.mineTimer = 0;
    u.building = false; u.buildSite = null; u.resumeTarget = null; u.resumeOrder = null;
    u.path = null;
    u.stance = 'idle'; // un ordre explicite prend le pas sur une éventuelle "défense de position" précédente
    u.order = { kind: 'attack', x: tile.x, y: tile.y, targetUnitId, targetBuildingId };
    any = true;
  }
  if (any) pings.push({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2, t: 0 });
}

// Active le mode "zone rectangulaire" (glisser un rectangle assigne tous les ouvriers du
// groupe à miner en continu dans cette zone, voir assignRectZone et updateUnit).
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

// Active le mode "pinceau" (tracer librement au clic-glisser une zone de forme libre plutôt
// qu'un simple rectangle, voir addBrushTile et assignBrushZone).
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

// Crée une zone de type 'rect' (bornes x0..x1, y0..y1) et l'assigne à tous les ouvriers de la
// liste `ids` — l'IA de zone (voir updateUnit dans 04-units.js) se chargera ensuite de choisir
// automatiquement quoi miner dans cette zone au fil du temps.
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

// Comme assignRectZone, mais pour une zone de type 'path' (liste explicite de cases, issue du
// tracé au pinceau dans brushedTiles).
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

// Convertit le rectangle écran d'un glisser-déposer (mode zone) en zone 'rect' en coordonnées
// case, et l'assigne aux ouvriers du groupe (zoneUnitIds).
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

// Détruit/recycle le bâtiment actuellement sélectionné : rembourse une fraction
// (DEMOLISH_REFUND_RATIO) de son coût de construction, libère son empreinte sur buildingGrid
// et force un recalcul de la vision (un bâtiment qui disparaît peut ouvrir une nouvelle ligne
// de vue). La base du joueur est protégée et ne peut jamais être détruite ainsi.
function destroySelectedBuilding() {
  const b = selectedBuilding;
  // owner !== 'player' : voir la note dans trainWorker plus haut — sans cette garde, recycler
  // une caserne/un avant-poste/un labo RIVAL rembourserait des ressources au JOUEUR pour la
  // destruction d'un bâtiment qui n'est même pas le sien (exploit direct, en plus d'être
  // incohérent : ce n'est pas un recyclage volontaire, voir cleanupDeadFromCombat dans
  // 04-units.js pour la vraie destruction au combat, elle, sans remboursement).
  if (!b || b.owner !== 'player' || b.type === 'base') return; // la base principale ne se détruit pas (l'avant-poste 'outpost', lui, le peut)
  // Remboursement générique via BUILD_TYPES (voir plus haut) plutôt qu'une chaîne de if/else
  // par type — couvre automatiquement barracks/pillar/outpost/lab.
  const spec = BUILD_TYPES[b.type];
  if (spec) {
    for (const [res, amount] of Object.entries(spec.cost)) {
      resources[res] += Math.round(amount * DEMOLISH_REFUND_RATIO);
    }
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

// Détruit/recycle la tuile de mur sélectionnée : rembourse une fraction de son coût, vide la
// case (onTileCleared) et force un recalcul de la vision.
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
