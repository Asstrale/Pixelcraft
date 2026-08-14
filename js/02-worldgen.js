/* === 02-worldgen.js — Bâtiments (registre) + génération procédurale de la carte (original: lignes 266-417) === */
// ---------- Bâtiments ----------
let buildings = [];         // liste de tous les bâtiments existants (toutes équipes confondues)
let buildingsById = {};     // même liste, indexée par id pour un accès rapide (ex. lookup depuis buildingGrid)
let nextBuildingId = 1;
let baseBuilding = null;    // raccourci vers la base du joueur (owner === 'player'), utilisé partout comme point de dépôt/référence
let spawnPoints = [];       // { x, y, owner, base } pour chaque joueur/rival généré
let spawnCX, spawnCY;       // coordonnées du point de spawn du joueur (caméra initiale, etc.)

// Marque l'empreinte d'un bâtiment sur buildingGrid (chaque case de son rectangle pointe vers
// son id) — c'est ce qui rend ces cases non franchissables (isWalkable) et bloquantes pour la
// vision (voir castVisionRay dans 05-fog-overview.js), indépendamment du contenu de `grid`.
function registerBuildingFootprint(b) {
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++)
      buildingGrid[idx(xx, yy)] = b.id;
}
// Crée et enregistre un nouveau bâtiment (rectangle x,y,w,h) avec ses PV, puis marque son
// empreinte sur la grille — point d'entrée unique utilisé aussi bien pour les bases générées
// au départ que pour les bâtiments terminés en jeu (voir completeSite dans 03-simulation.js).
function placeBuilding(type, x, y, w, h, hp, owner) {
  // train2 : seconde file de production en parallèle, utilisée uniquement par la base
  // principale une fois l'amélioration "production" débloquée (voir trainWorker et
  // updateBuildings dans 06-training-build.js). trainQueue : unités en attente qu'un
  // emplacement (train/train2) se libère (voir enqueueProduction). research : état de la
  // recherche en cours pour un laboratoire ({ key, timeLeft, totalTime }, voir startResearch).
  const b = { id: nextBuildingId++, type, x, y, w, h, hp, maxhp: hp, train: null, train2: null, trainQueue: [], research: null, owner: owner || 'player' };
  buildings.push(b);
  buildingsById[b.id] = b;
  registerBuildingFootprint(b);
  return b;
}

// ---------- Génération procédurale ----------
// Creuse un disque plein de rayon r centré sur (cx,cy) — utilisé notamment pour dégager la
// zone de spawn autour de chaque base (voir generateMap).
function carveCircle(cx, cy, r, type) {
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (!inBounds(xx, yy)) continue;
      if (dist(xx, yy, cx, cy) <= r) setTile(xx, yy, type);
    }
}
// Comme carveCircle mais avec un contour irrégulier (bruit pseudo-aléatoire déterministe basé
// sur les coordonnées, pas Math.random, pour un motif stable case par case) — donne aux poches
// et tunnels une forme organique plutôt que des cercles parfaits.
function carveBlob(cx, cy, rBase, type) {
  const r = rBase + Math.random() * 1.5;
  for (let yy = Math.floor(cy - r - 2); yy <= cy + r + 2; yy++) {
    for (let xx = Math.floor(cx - r - 2); xx <= cx + r + 2; xx++) {
      if (!inBounds(xx, yy)) continue;
      const noise = (Math.sin(xx * 12.9898 + yy * 78.233) * 43758.5453) % 1;
      const d = dist(xx, yy, cx, cy) + Math.abs(noise) * 1.6;
      if (d <= r) setTile(xx, yy, type);
    }
  }
}

// Génère une "poche" de caverne : une cavité vide centrée sur (cx,cy), avec 0 à 4 gisements
// de ressource (bois ou minerai, tirés au hasard à chaque nœud) disposés en cercle autour du
// centre de la poche. C'est l'unité de base répétée pour peupler toute la carte (voir
// generateMap, targetPockets).
function carvePocket(cx, cy) {
  const r = 3 + Math.random() * 4.5;
  carveBlob(cx, cy, r, T_EMPTY);
  const roll = Math.random();
  const numNodes = roll < 0.12 ? 0 : roll < 0.42 ? 1 : roll < 0.72 ? 2 : roll < 0.92 ? 3 : 4;
  for (let n = 0; n < numNodes; n++) {
    const kind = Math.random() < 0.55 ? T_WOOD : T_MINERAL;
    const ang = Math.random() * Math.PI * 2;
    const rad = r * (0.2 + Math.random() * 0.7);
    const nx = Math.round(cx + Math.cos(ang) * rad);
    const ny = Math.round(cy + Math.sin(ang) * rad);
    carveBlob(nx, ny, 0.5 + Math.random() * 0.8, kind);
  }
}

// Creuse un tunnel sinueux (pas une ligne droite) reliant deux poches (ax,ay)->(bx,by) : suit
// la ligne directe mais lui applique un "wobble" perpendiculaire sinusoïdal + bruit aléatoire,
// puis évide un petit blob à chaque étape le long de ce tracé.
function carveTunnel(ax, ay, bx, by) {
  const steps = Math.ceil(dist(ax, ay, bx, by));
  const dirx = bx - ax, diry = by - ay;
  const len = Math.hypot(dirx, diry) || 1;
  const px = -diry / len, py = dirx / len; // vecteur perpendiculaire unitaire à la direction du tunnel, pour le décalage latéral (wobble)
  const phase = Math.random() * 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lx = ax + dirx * t, ly = ay + diry * t;
    const wobble = Math.sin(t * 7 + phase) * 3.2 + (Math.random() - 0.5) * 1.5;
    const cx = Math.round(lx + px * wobble);
    const cy = Math.round(ly + py * wobble);
    carveBlob(cx, cy, 1 + Math.random() * 0.9, T_EMPTY);
  }
}

// Tire n points de spawn suffisamment espacés les uns des autres (au moins 45% de la largeur
// de carte) par rejet aléatoire (jusqu'à 800 essais) ; si l'espace n'est pas assez grand pour
// satisfaire cette contrainte, complète par un repli déterministe (coins opposés en alternance)
// plutôt que de boucler indéfiniment.
function pickSpawnPoints(n) {
  const margin = 42;
  const pts = [];
  let attempts = 0;
  while (pts.length < n && attempts < 800) {
    attempts++;
    const px = randInt(margin, MAP_W - margin);
    const py = randInt(margin, MAP_H - margin);
    let ok = true;
    for (const p of pts) if (dist(px, py, p.x, p.y) < MAP_W * 0.45) { ok = false; break; }
    if (ok) pts.push({ x: px, y: py });
  }
  while (pts.length < n) {
    const k = pts.length;
    pts.push({ x: k % 2 === 0 ? margin : MAP_W - margin, y: k % 2 === 0 ? margin : MAP_H - margin });
  }
  return pts;
}

// Place n poches de gaz (une case T_GAS chacune) sur des cases de roche pleine, à distance
// raisonnable (>=16) de tout point de spawn pour ne pas piéger un joueur dès le départ.
function placeGasPockets(n) {
  let placed = 0, attempts = 0;
  while (placed < n && attempts < 3000) {
    attempts++;
    const x = randInt(4, MAP_W - 5), y = randInt(4, MAP_H - 5);
    if (grid[idx(x, y)] !== T_STONE) continue;
    let tooClose = false;
    for (const sp of spawnPoints) if (dist(x, y, sp.x, sp.y) < 16) { tooClose = true; break; }
    if (tooClose) continue;
    setTile(x, y, T_GAS);
    placed++;
  }
}

// Point d'entrée de la génération de carte, appelé une fois au chargement (voir 11-loop-init.js).
// Étapes : (1) remplit toute la carte de roche pleine et réinitialise toutes les grilles
// d'état (brouillard, bâtiments...) ; (2) place les bases de chaque joueur/rival (NUM_PLAYERS,
// voir 01-constants.js) sur des points de spawn bien espacés, en dégageant un disque autour de
// chacune ; (3) sème un nombre cible de poches de ressources (targetPockets) réparties sur la
// carte en évitant les zones de spawn et les poches déjà posées ; (4) relie certaines poches
// voisines entre elles par des tunnels sinueux (35% de chance par poche, uniquement vers l'une
// des 6 poches précédentes les plus proches) pour garantir un minimum de connectivité entre
// cavités sans pour autant tout relier ; (5) sème des poches de gaz explosif dans la roche
// restante.
function generateMap() {
  grid.fill(T_STONE);
  for (let i = 0; i < tileSeed.length; i++) tileSeed[i] = randInt(0, 255);
  for (let i = 0; i < tileHP.length; i++) { tileHP[i] = STONE_HP; tileMaxHP[i] = STONE_HP; }
  exploredTile.fill(0); visibleNow.fill(0);
  buildingGrid.fill(-1);
  buildings = []; buildingsById = {}; nextBuildingId = 1;

  const pts = pickSpawnPoints(NUM_PLAYERS);
  spawnPoints = [];
  const half = Math.floor(BASE_SIZE / 2);
  for (let p = 0; p < pts.length; p++) {
    const owner = p === 0 ? 'player' : 'rival'; // le premier point de spawn tiré est toujours celui du joueur, les autres sont des rivaux (IA pas encore implémentée à ce stade du prototype)
    const cx = pts[p].x, cy = pts[p].y;
    carveCircle(cx, cy, SPAWN_CLEAR_RADIUS, T_EMPTY);
    const base = placeBuilding('base', cx - half, cy - half, BASE_SIZE, BASE_SIZE, 500, owner);
    spawnPoints.push({ x: cx, y: cy, owner, base });
    if (owner === 'player') { spawnCX = cx; spawnCY = cy; baseBuilding = base; }
  }

  const centers = [];
  let attempts = 0;
  const targetPockets = 150;
  while (centers.length < targetPockets && attempts < 6000) {
    attempts++;
    const px = randInt(6, MAP_W - 6);
    const py = randInt(6, MAP_H - 6);
    let tooClose = false;
    for (const sp of spawnPoints) if (dist(px, py, sp.x, sp.y) < 26) { tooClose = true; break; }
    if (!tooClose) for (const c of centers) if (dist(px, py, c.x, c.y) < 9) { tooClose = true; break; }
    if (tooClose) continue;
    centers.push({ x: px, y: py });
    carvePocket(px, py);
  }

  // Connecte certaines poches à l'une de leurs voisines récentes (fenêtre des 6 précédentes,
  // pas toutes) par un tunnel — assez pour garantir des chemins entre cavités sans transformer
  // toute la carte en un unique réseau ouvert.
  for (let i = 1; i < centers.length; i++) {
    if (Math.random() > 0.35) continue;
    let bestJ = -1, bestD = Infinity;
    for (let j = Math.max(0, i - 6); j < i; j++) {
      const d = dist(centers[i].x, centers[i].y, centers[j].x, centers[j].y);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    if (bestJ >= 0 && bestD < 50) carveTunnel(centers[i].x, centers[i].y, centers[bestJ].x, centers[bestJ].y);
  }

  placeGasPockets(28);
}
