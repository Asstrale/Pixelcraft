/* === 03-simulation.js — Palette de rendu, ressources joueur, déplacement/minage, pathfinding A*, explosions de gaz, chantiers de construction === */
// ---------- Palette de rendu ----------
// Dégradé de 14 teintes de gris-bleu pour la roche (voir drawTile dans 10-render.js, qui
// pioche dedans selon tileSeed pour varier légèrement l'apparence des cases sans recalcul).
const stoneShades = [];
for (let s = 0; s < 14; s++) {
  const v = 38 + s * 1.6;
  stoneShades.push(`rgb(${Math.round(v)},${Math.round(v + 3)},${Math.round(v + 7)})`);
}
const COLOR_WOOD_HI = [166, 122, 60], COLOR_WOOD_LO = [70, 50, 26];
const COLOR_MIN_HI = [92, 168, 232], COLOR_MIN_LO = [34, 60, 92];
// Interpole linéairement entre deux couleurs [r,g,b] (t entre 0 et 1) — utilisé pour donner
// un léger dégradé de teinte au bois/minerai en fonction des PV restants de la case.
function lerpColor(a, b, t) {
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
}

// ---------- Ressources du joueur ----------
const resources = { bois: 100, minerai: 100, pierre: 100 };

// ---------- Ressources de l'IA rivale ----------
// Pool SÉPARÉ de celui du joueur (resources ci-dessus) : les ouvriers rivaux déposent ici (voir
// resourcesFor et le bloc 'deposit' dans updateUnit, 04-units.js), et l'IA (updateRivalAI, voir
// 09-update.js) dépense dans ce même pool pour sa propre production/construction. Démarre avec
// un peu plus que le joueur pour compenser l'absence de brouillard de guerre côté joueur au
// tout début (l'IA doit pouvoir se développer sans dépendre d'une reconnaissance qu'elle ne
// simule pas) — valeur de prototype, à ajuster si l'IA se révèle trop faible/trop forte.
const rivalResources = { bois: 120, minerai: 120, pierre: 80 };
// Renvoie le pool de ressources du camp `owner` ('player' ou 'rival') — à utiliser partout où
// une action (dépôt, dépense) doit créditer/débiter le BON camp plutôt que toujours celui du
// joueur.
function resourcesFor(owner) { return owner === 'player' ? resources : rivalResources; }

// ---------- Recherche / améliorations ----------
// Niveaux débloqués (0..RESEARCH_MAX_LEVEL) pour chaque amélioration à 4 niveaux, appliqués
// GLOBALEMENT à toutes les unités du joueur concernées (existantes ET futures) — voir
// applyResearchToUnit dans 04-units.js. `production` est un booléen (palier unique) plutôt
// qu'un niveau : la base peut alors former 2 unités à la fois (voir trainWorker/updateBuildings
// dans 06-training-build.js).
const research = { inventory: 0, speed: 0, drill: 0, resist: 0, production: false };

// Capacité de transport effective d'un ouvrier, une fois la recherche "inventaire" prise en
// compte — à utiliser PARTOUT à la place de la constante CARRY_CAPACITY brute, pour que
// l'amélioration s'applique immédiatement à tous les ouvriers (existants et futurs) sans avoir
// à stocker/recalculer une capacité par unité.
function effectiveCarryCapacity() {
  return CARRY_CAPACITY + research.inventory * RESEARCH_INVENTORY_PER_LEVEL;
}

// ---------- Effets visuels de fumée (recherche en cours) ----------
// Particules montantes émises par un laboratoire tant qu'une recherche y est active (voir
// updateResearch dans 06-training-build.js pour l'émission ; le rendu proprement dit se fait
// dans draw(), voir 10-render.js).
let smokeParticles = [];
function spawnSmokeParticle(bx, by) {
  // Motif de blocs FIXE généré une seule fois à la naissance de la particule (pas recalculé à
  // chaque frame) : un petit amas de 4 à 6 carrés en positions aléatoires plutôt qu'un cercle
  // lisse, pour un rendu pixel-art cohérent avec le reste du jeu (imageSmoothingEnabled=false,
  // cases carrées partout ailleurs — voir draw() dans 10-render.js).
  const blockCount = 4 + Math.floor(Math.random() * 3);
  const px = [];
  for (let i = 0; i < blockCount; i++) {
    px.push({ ox: (Math.random() - 0.5) * TILE * 0.7, oy: (Math.random() - 0.5) * TILE * 0.5 });
  }
  smokeParticles.push({
    x: bx + (Math.random() - 0.5) * TILE * 0.6,
    y: by,
    t: 0,
    life: 1.4 + Math.random() * 0.8,
    drift: (Math.random() - 0.5) * 10,
    px,
  });
}

// ---------- Déplacement / minage ----------
// Une case est franchissable par une unité si elle est vide ET pas occupée par l'empreinte
// d'un bâtiment (buildingGrid) — une case peut être T_EMPTY tout en étant "sous" un bâtiment.
function isWalkable(x, y) {
  if (!inBounds(x, y)) return false;
  if (buildingGrid[idx(x, y)] !== -1) return false;
  return grid[idx(x, y)] === T_EMPTY;
}
// Une case peut-elle être minée (roche/bois/minerai/poche de gaz) ?
function isMinable(x, y) {
  if (!inBounds(x, y)) return false;
  const t = grid[idx(x, y)];
  return t === T_STONE || t === T_WOOD || t === T_MINERAL || t === T_GAS;
}
// Vide une case minée : redevient T_EMPTY et perd ses PV (plus rien à miner).
function onTileCleared(mx, my) {
  const i = idx(mx, my);
  grid[i] = T_EMPTY; tileHP[i] = 0; tileMaxHP[i] = 0;
}

// Une case peut-elle apparaître dans un aperçu de surbrillance (survol de l'outil "Miner
// vers", pinceau, zones) sans trahir le brouillard de guerre ? Sur une case jamais explorée,
// on ne peut pas savoir si elle est minable ou non — il faut donc l'inclure systématiquement
// (comme n'importe quelle autre case non explorée), sinon le simple fait qu'une case "manque"
// dans la surbrillance révèle sa forme (ex. le contour d'une grotte cachée). Sur une case déjà
// explorée, on n'affiche que si elle est réellement encore minable.
function isHighlightableUnknownSafe(x, y) {
  if (!inBounds(x, y)) return false;
  if (fogEnabled && !exploredTile[idx(x, y)]) return true;
  return isMinable(x, y);
}

// Énumère les cases traversées par la ligne DROITE entre un point de départ (coordonnées
// monde, ex. u.x/u.y) et une case cible (tx,ty), en interpolant régulièrement le long du
// segment (même méthode que l'aperçu au survol de l'outil "Miner vers", voir draw() dans
// 10-render.js) — PAS un A*, donc aucun risque de troncature par maxNodes : le tracé complet
// est toujours obtenu en un seul passage, peu importe la distance. Sert à préremplir
// immédiatement toute la surbrillance d'un ordre "tunnel" (voir issueTunnelOrderAtScreen dans
// 06-training-build.js) : c'est le trajet "normal" qu'une unité va suivre en creusant tout
// droit ; il ne sera abandonné au profit d'un vrai A* (findPath) que si l'unité se retrouve
// réellement bloquée en chemin (mur incassable, ou cavité qui rend le passage direct
// impossible) — voir le commentaire sur canMineThrough dans updateUnit (04-units.js).
function directLineTiles(ox, oy, tx, ty) {
  const tiles = [];
  const seen = new Set();
  const steps = Math.max(1, Math.ceil(dist(ox, oy, tx + 0.5, ty + 0.5)));
  for (let i = 0; i <= steps; i++) {
    const lx = Math.round(ox + (tx + 0.5 - ox) * (i / steps));
    const ly = Math.round(oy + (ty + 0.5 - oy) * (i / steps));
    const key = lx + ',' + ly;
    if (seen.has(key)) continue;
    seen.add(key);
    tiles.push({ x: lx, y: ly });
  }
  return tiles;
}

// ---------- Pathfinding (A*) avec gestion des diagonales et pénalité de minage ----------
// canMine (optionnel, false par défaut) : si true, une case minable (roche/bois/minerai/gaz)
// non franchissable peut quand même être traversée par l'algorithme — avec un surcoût de 15
// (stepCost += 15) pour la pénaliser par rapport à un vrai passage libre, de sorte qu'un
// détour à pied reste toujours préféré s'il existe. Utilisé par les ordres "harvest"/"tunnel"
// (voir canMineThrough dans updateUnit, 04-units.js) : une unité autorisée à creuser peut donc
// planifier un chemin qui traverse de la roche plutôt que de rester bloquée s'il n'existe
// aucune route entièrement dégagée.
//
// Contrairement à un A* classique qui renvoie null si la cible est inatteignable (ou si la
// recherche dépasse maxNodes sans l'avoir trouvée), cette version garde la trace du nœud
// exploré le plus proche de la cible (closestNode, au sens de l'heuristique h) et, en dernier
// recours, renvoie un CHEMIN PARTIEL vers ce nœud plutôt que null. Ça permet à une unité de
// toujours avancer d'au moins quelques cases vers son objectif au lieu de rester totalement
// figée quand la cible exacte est hors de portée de recherche — combiné au recalcul périodique
// du chemin (voir u.pathCooldown dans updateUnit), l'unité progresse par étapes successives.
// null n'est renvoyé que si même le point de départ n'a aucun voisin explorable (unité
// complètement enfermée par des cases ni franchissables ni minables).
function findPath(startX, startY, targetX, targetY, canMine = false) {
  const maxNodes = 1000;
  let open = [{ x: startX, y: startY, g: 0, f: dist(startX, startY, targetX, targetY), h: dist(startX, startY, targetX, targetY), parent: null }];
  let closed = new Set();

  // Nœud exploré le plus proche de la cible rencontré jusqu'ici (secours en cas d'échec, voir
  // plus bas) — initialisé au point de départ.
  let closestNode = open[0];

  while (open.length > 0 && closed.size < maxNodes) {
    open.sort((a, b) => a.f - b.f);
    let curr = open.shift();
    let key = curr.x + ',' + curr.y;

    if (curr.h < closestNode.h) {
        closestNode = curr;
    }

    if (curr.x === targetX && curr.y === targetY) {
      let path = [];
      let node = curr;
      while (node.parent) { path.push({ x: node.x, y: node.y }); node = node.parent; }
      return path.reverse();
    }

    closed.add(key);

    const dirs = [[0,1], [1,0], [0,-1], [-1,0], [1,1], [-1,-1], [1,-1], [-1,1]];
    for (let [dx, dy] of dirs) {
      let nx = curr.x + dx, ny = curr.y + dy;
      if (!inBounds(nx, ny)) continue;

      // Diagonale interdite si l'un des deux passages orthogonaux adjacents est bloqué
      // (empêche de "couper le coin" à travers un angle de mur).
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        if (!isWalkable(curr.x + dx, curr.y) || !isWalkable(curr.x, curr.y + dy)) continue;
      }

      const isTarget = (nx === targetX && ny === targetY);
      const isPassable = isWalkable(nx, ny) || isTarget; // la case cible elle-même est toujours acceptée comme destination, même si elle n'est pas franchissable (ex. bâtiment/roche visé)
      const isObstacleMinable = canMine && isMinable(nx, ny);

      if (!isPassable && !isObstacleMinable) continue;
      if (closed.has(nx + ',' + ny)) continue;

      let stepCost = Math.hypot(dx, dy);

      // Traverser une case minable non franchissable (creuser en chemin) coûte plus cher
      // qu'un pas normal, pour que l'algorithme préfère toujours un détour à pied s'il existe.
      // La case cible elle-même n'est jamais pénalisée : miner PUIS s'arrêter dessus est le
      // but recherché, pas un détour.
      if (!isWalkable(nx, ny) && isObstacleMinable && !isTarget) {
         stepCost += 15;
      }

      let g = curr.g + stepCost;
      let h = dist(nx, ny, targetX, targetY);
      let existing = open.find(n => n.x === nx && n.y === ny);

      if (!existing) open.push({ x: nx, y: ny, g, h, f: g + h, parent: curr });
      else if (g < existing.g) { existing.g = g; existing.f = g + h; existing.parent = curr; }
    }
  }

  // Cible inatteignable (ou recherche tronquée par maxNodes) : on retourne un chemin partiel
  // vers le point le plus proche trouvé plutôt que d'abandonner complètement (voir le
  // commentaire au-dessus de la fonction). Si même le point de départ est resté le plus
  // proche (aucun voisin exploré), il n'y a vraiment nulle part où aller : on renvoie null.
  if (closestNode && (closestNode.x !== startX || closestNode.y !== startY)) {
      let path = [];
      let node = closestNode;
      while (node.parent) { path.push({ x: node.x, y: node.y }); node = node.parent; }
      return path.reverse();
  }

  return null;
}

// ---------- Explosions de gaz ----------
let explosions = [];
const GAS_LEAK_BUDGET = 85; // "budget" de propagation total d'une explosion (consommé à chaque case traversée, voir triggerExplosion)
const GAS_STONE_BREAK_CHANCE = 0.45; // probabilité qu'une explosion parvienne à casser une case de roche sur son passage (sinon la roche bloque la propagation à cet endroit)

// ---------- Combat ----------
// Petit éclair visuel à l'impact de chaque coup porté (voir updateCombat dans 04-units.js) —
// très bref, juste de quoi rendre les combats lisibles à l'écran (rendu dans draw(), voir
// 10-render.js ; purgé dans update(), voir 09-update.js, comme pings/explosions).
let hitSparks = [];

// Propagation en chaîne d'une explosion de gaz depuis (mx,my) : parcourt les cases voisines
// de proche en proche façon "frontière" (BFS pondéré), consommant un budget de puissance à
// chaque pas, en évitant les murs (indestructibles à l'explosion) et en ayant une chance de
// s'arrêter sur de la roche. Vide toutes les cases traversées (sauf les murs), déclenche en
// cascade toute autre poche de gaz rencontrée, puis inflige des dégâts dégressifs avec la
// distance aux unités et bâtiments proches du foyer.
function triggerExplosion(mx, my) {
  const affected = [];
  const visited = new Set([mx + ',' + my]);
  const frontier = [{ x: mx, y: my, power: GAS_LEAK_BUDGET, dx: 0, dy: 0 }];

  while (frontier.length) {
    const cell = frontier.shift();
    const i = idx(cell.x, cell.y);
    const t = grid[i];
    if (t !== T_WALL) { grid[i] = T_EMPTY; tileHP[i] = 0; tileMaxHP[i] = 0; }
    affected.push({ x: cell.x, y: cell.y });
    if (t === T_GAS && !(cell.x === mx && cell.y === my)) triggerExplosion(cell.x, cell.y); // réaction en chaîne : une autre poche de gaz touchée explose à son tour
    if (cell.power <= 0) continue;

    // Les directions sont triées pour privilégier la continuité de la direction de propagation
    // courante (dx,dy) — avec un peu de bruit aléatoire pour ne pas produire un tracé trop
    // rectiligne/artificiel.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    dirs.sort((a, b) => {
      const da = (a[0] - cell.dx) * (a[0] - cell.dx) + (a[1] - cell.dy) * (a[1] - cell.dy);
      const db = (b[0] - cell.dx) * (b[0] - cell.dx) + (b[1] - cell.dy) * (b[1] - cell.dy);
      return (da - db) + (Math.random() - 0.5) * 3;
    });
    const maxBranches = Math.random() < 0.82 ? 1 : 2; // la plupart du temps un seul embranchement (tracé linéaire), parfois deux (ramification)
    let pushed = 0;
    for (const [dx, dy] of dirs) {
      if (pushed >= maxBranches) break;
      const nx = cell.x + dx, ny = cell.y + dy;
      if (!inBounds(nx, ny)) continue;
      const key = nx + ',' + ny;
      if (visited.has(key)) continue;
      const nt = grid[idx(nx, ny)];
      if (nt === T_WALL) continue; // les murs construits arrêtent totalement la propagation
      let nextPower = cell.power - 1;
      if (nt === T_STONE) {
        if (Math.random() > GAS_STONE_BREAK_CHANCE) continue; // chance ratée : la roche tient bon, la propagation s'arrête dans cette direction
        nextPower -= 4; // casser de la roche coûte cher en puissance de propagation restante
      }
      if (nextPower < 0) continue;
      visited.add(key);
      frontier.push({ x: nx, y: ny, power: nextPower, dx, dy });
      pushed++;
    }
  }

  explosions.push({ x: mx * TILE + TILE / 2, y: my * TILE + TILE / 2, t: 0 }); // effet visuel (voir draw() dans 10-render.js)

  // Dégâts aux unités/bâtiments : proportionnels à la distance au point de terrain affecté le
  // plus proche (pas juste au foyer initial), pour que les dégâts suivent la forme réelle du
  // souffle plutôt qu'un simple cercle centré sur (mx,my).
  for (const u of units) {
    let minD = Infinity;
    for (const c of affected) { const d = dist(u.x, u.y, c.x + 0.5, c.y + 0.5); if (d < minD) minD = d; }
    if (minD <= 1.6) u.hp -= GAS_DAMAGE * (1 - minD / 1.6);
  }
  for (const b of buildings) {
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    let minD = Infinity;
    for (const c of affected) { const d = dist(bcx, bcy, c.x + 0.5, c.y + 0.5); if (d < minD) minD = d; }
    if (minD <= 1.6 + Math.max(b.w, b.h) / 2) b.hp -= GAS_DAMAGE * 0.6;
  }
  units = units.filter(u => u.hp > 0);
}

// ---------- Chantiers de construction ----------
let sites = [];       // liste des chantiers en cours (mur/caserne/pilier pas encore terminés)
let nextSiteId = 1;
const BUILD_POWER = 8; // PV de progression ajoutés au chantier par seconde de construction active (voir u.building dans updateUnit)
const WALL_BUILD_HP = 20, BARRACKS_BUILD_HP = 90, PILLAR_BUILD_HP = 30; // PV cible (site.targetHp) à atteindre pour terminer chaque type de chantier
const PILLAR_COST_PIERRE = 15, PILLAR_COST_BOIS = 10;
// La tour de vision a une portée quasi infinie : seuls les obstacles l'arrêtent (voir
// revealLOS / computeLOSVisibleTiles dans 05-fog-overview.js), pas une distance fixe.
const PILLAR_VISION = VISION_MAX_RANGE;

// Renvoie le chantier occupant la case (tx,ty), ou null si aucun.
function siteAt(tx, ty) {
  for (const s of sites) if (tx >= s.x && tx < s.x + s.w && ty >= s.y && ty < s.y + s.h) return s;
  return null;
}
// Toute l'empreinte (tx,ty)-(tx+w-1,ty+h-1) est-elle libre pour y poser un chantier/bâtiment ?
// (case dans la carte, vide, pas déjà occupée par un autre bâtiment ni un chantier en cours).
// Factorise la validation utilisée à la fois par issueBuildOrder (joueur, voir
// 06-training-build.js) et aiTryBuild (IA rivale, voir 09-update.js).
function canPlaceFootprint(tx, ty, w, h) {
  for (let yy = ty; yy < ty + h; yy++) {
    for (let xx = tx; xx < tx + w; xx++) {
      if (!inBounds(xx, yy) || grid[idx(xx, yy)] !== T_EMPTY || buildingGrid[idx(xx, yy)] !== -1 || siteAt(xx, yy)) return false;
    }
  }
  return true;
}
// Un chantier a atteint ses PV cible : matérialise le résultat (mur posé sur la grille, ou
// bâtiment placé), le retire de la liste des chantiers en cours, et force un recalcul de la
// vision des bâtiments au prochain frame (un nouveau mur/bâtiment peut ouvrir ou boucher une
// ligne de vue, inutile d'attendre jusqu'à une seconde pour que ça se reflète).
function completeSite(site) {
  if (site.type === 'wall') setTile(site.x, site.y, T_WALL);
  else if (site.type === 'barracks') placeBuilding('barracks', site.x, site.y, site.w, site.h, 80, 'player');
  else if (site.type === 'pillar') placeBuilding('pillar', site.x, site.y, site.w, site.h, 40, 'player');
  else if (site.type === 'outpost') placeBuilding('outpost', site.x, site.y, site.w, site.h, OUTPOST_HP, 'player');
  else if (site.type === 'lab') placeBuilding('lab', site.x, site.y, site.w, site.h, LAB_HP, 'player');
  sites = sites.filter(s => s !== site);
  invalidateBuildingVision();
}
