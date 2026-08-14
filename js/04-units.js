/* === 04-units.js — Unités : spawn, IA de déplacement/minage/construction === */
// ---------- Unités ----------
let units = [];
let nextUnitId = 1;

// Valeurs de BASE (avant recherche) par type d'unité — utilisées par applyResearchToUnit pour
// calculer les stats effectives, jamais directement ailleurs (toujours passer par u.speed/
// u.minePower/u.maxhp, qui reflètent déjà la recherche courante).
// Soldat légèrement plus rapide qu'avant (1.7 -> 1.9, demande explicite du joueur) — toujours en
// dessous de la vitesse d'un ouvrier (2.0), qui reste l'unité la plus véloce du jeu.
function baseSpeedFor(type) {
  if (type === 'worker') return 2.0;
  if (type === 'soldier') return 1.9;
  if (type === 'archer') return 1.9;      // aussi mobile qu'un soldat : vocation "tire et recule"
  if (type === 'grenadier') return 1.6;   // plus lourd
  if (type === 'cannoneer') return 1.3;   // unité de siège, lente
  return 1.7;
}
function baseMinePowerFor(type) { return type === 'worker' ? HP_PER_RESOURCE : 0; }
function baseMaxHpFor(type) {
  if (type === 'soldier') return 40;
  if (type === 'archer') return 24;     // fragile, vocation "à distance" plutôt qu'au contact
  if (type === 'grenadier') return 30;
  if (type === 'cannoneer') return 34;
  return 20; // worker
}
// Combat (voir 01-constants.js pour les constantes par type) : seules les unités de combat
// (COMBAT_UNIT_TYPES) infligent des dégâts et ont une portée de tir — un ouvrier reste toujours
// à 0/0 sur tous ces champs.
function baseAttackDamageFor(type) {
  if (type === 'soldier') return SOLDIER_ATTACK_DAMAGE;
  if (type === 'archer') return ARCHER_ATTACK_DAMAGE;
  if (type === 'grenadier') return GRENADIER_ATTACK_DAMAGE;
  if (type === 'cannoneer') return CANNONEER_ATTACK_DAMAGE;
  return 0;
}
function baseAttackRangeFor(type) {
  if (type === 'soldier') return SOLDIER_ATTACK_RANGE;
  if (type === 'archer') return ARCHER_ATTACK_RANGE;
  if (type === 'grenadier') return GRENADIER_ATTACK_RANGE;
  if (type === 'cannoneer') return CANNONEER_ATTACK_RANGE;
  return 0;
}
function baseAttackCooldownFor(type) {
  if (type === 'archer') return ARCHER_ATTACK_COOLDOWN;
  if (type === 'grenadier') return GRENADIER_ATTACK_COOLDOWN;
  if (type === 'cannoneer') return CANNONEER_ATTACK_COOLDOWN;
  return ATTACK_COOLDOWN;
}
// Rayon de dégâts de zone (grenadier/canonnier) — 0 pour toute unité sans dégâts de zone (tir
// simple sur la cible uniquement, voir updateCombat).
function baseSplashRadiusFor(type) {
  if (type === 'grenadier') return GRENADIER_SPLASH_RADIUS;
  if (type === 'cannoneer') return CANNONEER_SPLASH_RADIUS;
  return 0;
}
// Multiplicateur de dégâts contre bâtiments (et murs, voir wallBuster) — 1 = aucun bonus.
function baseBuildingDamageMultFor(type) { return type === 'cannoneer' ? CANNONEER_BUILDING_DAMAGE_MULT : 1; }
// Le canonnier peut faire exploser un mur (T_WALL) directement, pas seulement les bâtiments —
// voir le ciblage de mur dans updateCombat plus bas, réponse concrète à "une unité qui explose
// les murs".
function isWallBuster(type) { return type === 'cannoneer'; }

// Applique les niveaux de recherche courants (voir `research` dans 03-simulation.js) aux stats
// d'UNE unité : vitesse, puissance de minage, PV max. Appelé à la fois à la création d'une
// unité (spawnUnit) et rétroactivement sur toutes les unités existantes dès qu'un niveau de
// recherche est complété (voir updateResearch dans 06-training-build.js) — c'est ce qui rend
// ces améliorations globales (toutes les unités concernées, pas seulement les futures).
// L'inventaire (capacité de transport) n'a PAS besoin de ça : voir effectiveCarryCapacity().
function applyResearchToUnit(u) {
  u.speed = baseSpeedFor(u.type) * (1 + research.speed * RESEARCH_SPEED_PER_LEVEL);
  u.minePower = baseMinePowerFor(u.type) * (1 + research.drill * RESEARCH_DRILL_PER_LEVEL);
  const newMaxHp = Math.round(baseMaxHpFor(u.type) * (1 + research.resist * RESEARCH_RESIST_PER_LEVEL));
  if (u.maxhp) {
    // Conserve la PROPORTION de vie actuelle plutôt que de garder les PV bruts, pour qu'une
    // augmentation de PV max se traduise par un vrai regain de vie immédiat et cohérent.
    u.hp = Math.min(newMaxHp, Math.round(u.hp * (newMaxHp / u.maxhp)));
  }
  u.maxhp = newMaxHp;
}

// Crée une nouvelle unité (ouvrier ou soldat) centrée sur la case (tx,ty), pour le camp `owner`
// ('player' par défaut, ou 'rival' pour l'IA — voir updateRivalAI dans 09-update.js).
// inventory : quantité transportée PAR TYPE de ressource (bois/minerai/pierre) — une unité
// peut donc miner des ressources différentes dans le même voyage avant de tout déposer d'un
// coup (voir le bloc 'deposit' dans updateUnit) ; carryAmount reste le total toutes
// catégories confondues, comparé à effectiveCarryCapacity() pour savoir quand rentrer se vider.
function spawnUnit(type, tx, ty, owner) {
  const u = {
    id: nextUnitId++, type, owner: owner || 'player',
    x: tx + 0.5, y: ty + 0.5,
    order: null, mining: false, mineTarget: null, mineTimer: 0, zone: null,
    building: false, buildSite: null, buildTimer: 0, buildQueue: [],
    inventory: { bois: 0, minerai: 0, pierre: 0 }, carryAmount: 0, resumeTarget: null, resumeOrder: null,
    stuckTimer: 0, stuckCheckX: undefined, stuckCheckY: undefined, avoid: null,
    hp: 1, maxhp: 1, speed: 1, minePower: 0, // valeurs placeholder, écrasées juste en dessous par applyResearchToUnit
    // Combat (voir updateCombat plus bas) : seul un soldat a des dégâts/portée non nuls
    // (baseAttackDamageFor/baseAttackRangeFor) — un ouvrier reste totalement inoffensif, il ne
    // fait donc jamais rien dans updateCombat (sortie immédiate sur attackDamage === 0).
    attackDamage: 0, attackRange: 0, attackCooldown: ATTACK_COOLDOWN, attackTimer: 0,
    splashRadius: 0, buildingDamageMult: 1, wallBuster: false, // dégâts de zone / anti-bâtiment / anti-mur (grenadier, canonnier — voir baseSplashRadiusFor etc. plus haut)
    stance: 'idle', holdX: null, holdY: null, // stance 'hold' conservée pour compat (plus câblée à aucun bouton, voir defendPosition ci-dessous dans 06-training-build.js — remplacée par l'ordre 'defend' ciblé)
    aiScout: false, // ouvrier rival désigné éclaireur ("fourmi" en exploration), voir aiUpdateScouts dans 09-update.js
    animSeed: Math.random() * 1000,
    path: null, pathTargetX: null, pathTargetY: null, pathCooldown: 0,
    yieldTimer: 0 // cumul du temps passé à céder le passage à une autre unité, voir handleYield plus bas
  };
  applyResearchToUnit(u);
  u.hp = u.maxhp; // naît à pleine vie (applyResearchToUnit préserve une PROPORTION de vie existante, non pertinent ici)
  u.attackDamage = baseAttackDamageFor(type);
  u.attackRange = baseAttackRangeFor(type);
  u.attackCooldown = baseAttackCooldownFor(type);
  u.splashRadius = baseSplashRadiusFor(type);
  u.buildingDamageMult = baseBuildingDamageMultFor(type);
  u.wallBuster = isWallBuster(type);
  units.push(u);
  return u;
}

// Cherche une case franchissable libre sur le pourtour d'un bâtiment, en élargissant l'anneau
// de recherche (ring) case par case jusqu'à 10 cases de distance — utilisé pour faire sortir
// une unité nouvellement formée (base/caserne) sur une case adjacente accessible.
function findFreeAdjacent(b) {
  for (let ring = 1; ring <= 10; ring++) {
    const x0 = b.x - ring, x1 = b.x + b.w - 1 + ring;
    const y0 = b.y - ring, y1 = b.y + b.h - 1 + ring;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const onEdge = (yy === y0 || yy === y1 || xx === x0 || xx === x1);
        if (!onEdge) continue;
        if (isWalkable(xx, yy)) return { x: xx, y: yy };
      }
    }
  }
  return null;
}

// Avance une unité d'un pas vers le centre de la case (nx,ny), à sa vitesse (u.speed) et pour
// une durée dt — si la distance restante est inférieure au pas possible, se cale exactement
// sur le centre de la case plutôt que de la dépasser.
function stepUnitTo(u, nx, ny, dt) {
  const tpx = nx + 0.5, tpy = ny + 0.5;
  const ddx = tpx - u.x, ddy = tpy - u.y;
  const d = Math.hypot(ddx, ddy);
  const move = u.speed * dt;
  if (d <= move || d < 0.001) { u.x = tpx; u.y = tpy; }
  else { u.x += ddx / d * move; u.y += ddy / d * move; }
}

// Cherche la case minable la plus proche de l'unité dans sa zone assignée, en ignorant les
// cases mises en quarantaine récemment (isBlacklisted, voir plus bas) et celles non encore
// explorées (le brouillard cache leur vrai contenu, on ne peut pas les cibler directement).
function findNearestMinableInZone(u, zone) {
  let best = null, bestD = Infinity;
  const okTile = (xx, yy) => isMinable(xx, yy) && (!fogEnabled || exploredTile[idx(xx, yy)]) && !isBlacklisted(u, xx, yy);
  if (zone.type === 'rect') {
    for (let yy = zone.y0; yy <= zone.y1; yy++) {
      for (let xx = zone.x0; xx <= zone.x1; xx++) {
        if (okTile(xx, yy)) {
          const d = (xx + 0.5 - u.x) ** 2 + (yy + 0.5 - u.y) ** 2;
          if (d < bestD) { bestD = d; best = { x: xx, y: yy }; }
        }
      }
    }
  } else if (zone.type === 'path') {
    for (const t of zone.tiles) {
      if (okTile(t.x, t.y)) {
        const d = (t.x + 0.5 - u.x) ** 2 + (t.y + 0.5 - u.y) ** 2;
        if (d < bestD) { bestD = d; best = { x: t.x, y: t.y }; }
      }
    }
  }
  return best;
}

// Une case a-t-elle été mise en quarantaine pour cette unité (échec de minage/accès récent) ?
// Évite qu'une unité retente en boucle immédiatement la même case inaccessible.
function isBlacklisted(u, xx, yy) {
  if (!u.avoid) return false;
  const exp = u.avoid[xx + ',' + yy];
  return exp !== undefined && exp > gameTime;
}
// Met une case en quarantaine pour cette unité pendant `seconds` secondes de temps de jeu.
function blacklistTile(u, xx, yy, seconds) {
  u.avoid = u.avoid || {};
  u.avoid[xx + ',' + yy] = gameTime + seconds;
}
// La zone contient-elle encore au moins une case jamais explorée ? Sert à savoir s'il vaut la
// peine de creuser plus loin dans la zone (tunnel) même quand plus aucune case minable connue
// n'y est visible pour l'instant.
function zoneHasUnexplored(zone) {
  if (!fogEnabled) return false;
  if (zone.type === 'rect') {
    for (let yy = zone.y0; yy <= zone.y1; yy++) for (let xx = zone.x0; xx <= zone.x1; xx++) if (!exploredTile[idx(xx, yy)]) return true;
  } else if (zone.type === 'path') {
    for (const t of zone.tiles) if (!exploredTile[idx(t.x, t.y)]) return true;
  }
  return false;
}

// Cherche le meilleur point d'entrée non exploré d'une zone à percer au tunnel, en évaluant
// pour chaque case candidate le VRAI coût de chemin (via findPath avec canMine=true), pas
// juste la distance à vol d'oiseau — une case proche mais séparée par un mur épais peut ainsi
// être écartée au profit d'une case un peu plus loin mais réellement plus rapide à atteindre.
// Seul le pourtour de la zone est testé (pas chaque case intérieure) : c'est là que se trouvent
// les points d'entrée possibles, et ça limite le nombre d'appels findPath (chacun coûteux, un
// A* complet) à la taille du périmètre plutôt qu'à la surface totale de la zone.
//
// cost = longueur du chemin (+15 par case minable traversée en creusant, pour rester cohérent
// avec la pénalité de findPath) ; si le chemin renvoyé est PARTIEL (findPath n'a pas atteint
// xx,yy exactement, voir son propre commentaire dans 03-simulation.js), on ajoute une grosse
// pénalité proportionnelle à la distance à vol d'oiseau restant à couvrir, pour continuer à
// préférer une case dont on connaît un chemin complet.
//
// Renvoie { point, path } : path est le chemin A* déjà calculé vers le point choisi (réutilisé
// tel quel par l'appelant, voir zoneBreachPoint, pour éviter un second calcul redondant).
function nearestPointInZone(u, zone) {
  let best = null, bestCost = Infinity;
  let bestPath = null;
  // Repli si AUCUNE case candidate n'a de chemin trouvé (unité totalement enfermée) : on garde
  // simplement la case la plus proche à vol d'oiseau parmi celles sans chemin, pour au moins
  // donner une direction à l'unité plutôt que de renoncer. Suivi séparément de bestCost, qui
  // lui ne concerne que les candidates AVEC un chemin trouvé.
  let bestNoPath = null, bestNoPathD = Infinity;

  const consider = (xx, yy) => {
    if (fogEnabled && exploredTile[idx(xx, yy)]) return; // déjà exploré : pas utile d'y retourner comme point de percée

    const curX = Math.floor(u.x), curY = Math.floor(u.y);
    const path = findPath(curX, curY, xx, yy, true);

    if (path) {
        let cost = 0;
        for (let i = 0; i < path.length; i++) {
            if (!isWalkable(path[i].x, path[i].y)) cost += 15;
            cost += 1;
        }

        // Chemin partiel (n'atteint pas xx,yy) : on ajoute une forte pénalité correspondant à
        // la distance restante estimée à creuser, pour ne pas préférer à tort une case dont on
        // ne sait en fait atteindre qu'une partie du trajet.
        let lastNode = path[path.length - 1];
        if (lastNode && (lastNode.x !== xx || lastNode.y !== yy)) {
            cost += dist(lastNode.x, lastNode.y, xx, yy) * 16;
        }

        if (cost < bestCost) {
            bestCost = cost;
            best = { x: xx, y: yy };
            bestPath = path;
        }
    } else {
        const d = (xx + 0.5 - u.x) ** 2 + (yy + 0.5 - u.y) ** 2;
        if (d < bestNoPathD) { bestNoPathD = d; bestNoPath = { x: xx, y: yy }; }
    }
  };

  if (zone.type === 'rect') {
    // Uniquement le pourtour du rectangle (voir le commentaire de la fonction).
    for (let xx = zone.x0; xx <= zone.x1; xx++) {
        consider(xx, zone.y0);
        if (zone.y1 !== zone.y0) consider(xx, zone.y1);
    }
    for (let yy = zone.y0 + 1; yy <= zone.y1 - 1; yy++) {
        consider(zone.x0, yy);
        if (zone.x1 !== zone.x0) consider(zone.x1, yy);
    }
  } else {
    for (const t of zone.tiles) consider(t.x, t.y);
  }

  // Aucune case candidate n'avait de chemin complet trouvé : on retombe sur la meilleure sans
  // chemin (la plus proche à vol d'oiseau), sans chemin pré-calculé à réutiliser.
  if (!best && bestNoPath) return { point: bestNoPath, path: null };

  return { point: best, path: bestPath };
}

// Point de percée COMMUN à toute une zone (au lieu d'un point recalculé indépendamment par
// chaque ouvrier d'après SA propre position) : le premier ouvrier qui en a besoin en choisit
// un et le mémorise sur la zone elle-même (zone.breachPoint) ; tous les autres ouvriers
// réutilisent ensuite ce même point tant qu'il reste à explorer, au lieu que chacun creuse son
// propre tunnel séparé vers sa cible individuelle la plus proche. Une fois ce point atteint
// (exploré), le cache est invalidé et un nouveau point est choisi pour la poche suivante s'il
// en reste une. Sur un cache-hit, path vaut null (le chemin n'a été calculé — et n'est
// réutilisable — que par l'ouvrier qui a initialement déterminé ce point).
function zoneBreachPoint(u, zone) {
  const cached = zone.breachPoint;
  if (cached && (!fogEnabled || !exploredTile[idx(cached.x, cached.y)])) return { point: cached, path: null };
  const fresh = nearestPointInZone(u, zone);
  if (fresh.point) zone.breachPoint = fresh.point;
  return fresh;
}

// Enregistre une case comme réellement ciblée pour le minage sous un ordre "tunnel" ou
// "harvest" : la surbrillance affichée (10-render.js) ne montre plus un tracé théorique
// précalculé, mais exactement les cases que l'unité a effectivement décidé de miner, au fur
// et à mesure.
function recordTunnelMine(u, o, x, y) {
  if (o.kind !== 'tunnel' && o.kind !== 'harvest') return;
  u.tunnelPath = u.tunnelPath || [];
  if (!u.tunnelPath.some(p => p.x === x && p.y === y)) u.tunnelPath.push({ x, y });
}

// DÉSACTIVÉ : shouldYieldMovement / handleYield / tryClearJam ne sont plus appelés nulle part
// dans updateUnit (voir plus bas) — la répulsion mutuelle qui gérait les collisions entre
// unités est elle-même coupée (voir 09-update.js), donc cette cession de passage ne faisait
// plus que ralentir inutilement les unités sans jamais résoudre de vrai chevauchement ensuite.
// Fonctions laissées en place (inutilisées) plutôt que supprimées, au cas où la répulsion
// mutuelle serait un jour réactivée en même temps que ce mécanisme.
//
// Une unité de priorité plus basse (id plus grand) occupe-t-elle déjà (ou s'approche-t-elle
// de) la case de destination visée ? Priorité fixe par id : seule celle de priorité plus basse
// attendra, jamais les deux à la fois (pas de blocage mutuel façon "personne ne bouge").
function shouldYieldMovement(u, tx, ty) {
  for (const other of units) {
    if (other === u || other.id >= u.id) continue;
    const ddx = other.x - (tx + 0.5), ddy = other.y - (ty + 0.5);
    if (ddx * ddx + ddy * ddy < 0.22) return true;
  }
  return false;
}

const YIELD_PATIENCE = 1.2; // secondes d'attente max avant de forcer le passage (voir handleYield)

// Tente d'élargir un passage bloqué en minant une case voisine (perpendiculaire à la
// direction de marche) : ne fait rien si l'unité n'est pas un ouvrier, ou si aucune des deux
// cases voisines n'est minable (mur ou vide déjà dégagé, rien à creuser).
function tryClearJam(u, dx, dy) {
  if (u.minePower <= 0) return false;
  const curX = Math.floor(u.x), curY = Math.floor(u.y);
  const sides = dx !== 0 ? [[curX, curY - 1], [curX, curY + 1]] : [[curX - 1, curY], [curX + 1, curY]];
  for (const [sx, sy] of sides) {
    if (isMinable(sx, sy)) {
      u.mining = true; u.mineTarget = { x: sx, y: sy }; u.mineTimer = 0;
      return true;
    }
  }
  return false;
}

// Gère la cession de passage AVEC une patience bornée : sans limite, une unité pouvait
// attendre indéfiniment une autre à l'arrêt (en train de miner, inactive...) même quand la
// voie était large et bien dégagée ailleurs — c'était un vrai bug de blocage, pas juste un
// ralentissement (voir u.stuckTimer plus bas, dont le filet de sécurité anti-blocage général
// ne doit JAMAIS être réinitialisé pendant une attente, sous peine de le neutraliser). Passé
// le délai, elle essaie d'abord de creuser une case voisine pour élargir le passage (si elle
// est ouvrière), sinon elle avance quand même : un éventuel chevauchement bref est résorbé par
// la répulsion mutuelle (voir update() dans 09-update.js).
function handleYield(u, tx, ty, dx, dy, dt) {
  if (!shouldYieldMovement(u, tx, ty)) { u.yieldTimer = 0; return false; }
  u.yieldTimer = (u.yieldTimer || 0) + dt;
  if (u.yieldTimer <= YIELD_PATIENCE) return true; // attend encore un peu
  if (tryClearJam(u, dx, dy)) { u.yieldTimer = 0; return true; }
  u.yieldTimer = 0;
  return false; // patience écoulée, rien à dégager : on avance quand même
}

// Renvoie le bâtiment de dépôt (base principale ou avant-poste, voir OUTPOST_SIZE dans
// 01-constants.js) DU MÊME CAMP que l'unité (u.owner — 'player' ou 'rival', voir updateRivalAI
// dans 09-update.js) le plus proche de l'unité — pour qu'un ouvrier travaillant loin de sa base
// principale rentre déposer à l'avant-poste le plus proche plutôt que de toujours traverser
// toute la carte. Repli sur baseBuilding (toujours présente) UNIQUEMENT pour le joueur ; côté
// rival, renvoie null si toutes ses bases ont été détruites (voir le null-check dans la
// résolution de l'ordre 'deposit', plus bas dans updateUnit).
function nearestDepositBuilding(u) {
  let best = (u.owner === 'player') ? baseBuilding : null, bestD = Infinity;
  for (const b of buildings) {
    if (b.owner !== u.owner) continue;
    if (b.type !== 'base' && b.type !== 'outpost') continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const d = (cx - u.x) ** 2 + (cy - u.y) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}
// Construit un ordre 'deposit' vers le point de dépôt le plus proche de l'unité — mémorise
// l'id du bâtiment ciblé (depositId) pour que la résolution de l'ordre (plus bas) continue de
// viser CE bâtiment précis même s'il n'est plus le plus proche entre-temps (évite de changer
// de cible en cours de route). Renvoie null si l'unité n'a plus aucun bâtiment de dépôt (voir
// nearestDepositBuilding) — l'appelant doit alors traiter ça comme "pas d'ordre".
function depositOrderFor(u) {
  const dep = nearestDepositBuilding(u);
  if (!dep) return null;
  return { kind: 'deposit', x: clamp(Math.floor(u.x), dep.x, dep.x + dep.w - 1), y: clamp(Math.floor(u.y), dep.y, dep.y + dep.h - 1), depositId: dep.id };
}

// ---------- Combat ----------
// Unité OU bâtiment ennemi (camp différent de `owner`) le plus proche du point (px,py), dans un
// rayon donné — un soldat isolé peut très bien s'en prendre à un bâtiment ennemi non gardé, pas
// seulement à d'autres unités. Simplification volontaire du prototype : cette détection est
// OMNISCIENTE (elle ignore le brouillard de guerre), contrairement au rendu (voir drawUnit dans
// 10-render.js, qui lui respecte bien le brouillard) — un soldat peut donc "sentir" un ennemi
// dans le brouillard avant que le joueur ne le voie à l'écran. Le rayon de détection reste
// volontairement petit (ATTACK_ACQUIRE_RADIUS) pour que ça reste discret en pratique.
function findNearestEnemy(owner, px, py, radius) {
  let best = null, bestD = radius, bestIsBuilding = false;
  for (const u of units) {
    if (u.owner === owner || u.hp <= 0) continue; // hp<=0 : déjà mort mais pas encore purgé cette frame (voir cleanupDeadFromCombat), à ignorer
    const d = Math.hypot(u.x - px, u.y - py);
    if (d < bestD) { bestD = d; best = u; bestIsBuilding = false; }
  }
  for (const b of buildings) {
    if (b.owner === owner || b.hp <= 0) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const d = Math.hypot(cx - px, cy - py);
    if (d < bestD) { bestD = d; best = b; bestIsBuilding = true; }
  }
  return best ? { target: best, isBuilding: bestIsBuilding, dist: bestD } : null;
}

// Inflige des dégâts à une cible (unité ou bâtiment) — se contente de réduire ses PV, SANS la
// retirer immédiatement même si elle tombe à 0 ou moins : la suppression effective se fait en
// une passe séparée, une fois par frame (voir cleanupDeadFromCombat, appelée depuis update()
// dans 09-update.js), après que toute la logique de la frame a tourné. Même convention que les
// dégâts d'explosion de gaz (voir triggerExplosion, 03-simulation.js, qui fait déjà
// `units = units.filter(u => u.hp > 0)` en une seule passe après coup) : retirer une unité
// immédiatement PENDANT la boucle `for (const u of units) updateUnit(u, dt)` (09-update.js)
// n'aurait aucun effet sur cette itération déjà en cours (elle continuerait de traiter
// l'unité "morte" jusqu'à la fin de la frame), donc autant le faire proprement après coup.
function applyDamage(target, isBuilding, amount) {
  target.hp -= amount;
}

// Purge en une seule passe toutes les unités et tous les bâtiments tombés à 0 PV ou moins au
// combat cette frame (voir applyDamage ci-dessus) : dégage l'empreinte des bâtiments détruits
// sur buildingGrid, désélectionne tout ce qui vient de disparaître, force un recalcul de la
// vision si au moins un bâtiment a été détruit. Pas de remboursement de ressources (contrairement
// à un recyclage volontaire, voir destroySelectedBuilding dans 06-training-build.js) : une
// destruction au combat est une perte, pas une démolition choisie.
function cleanupDeadFromCombat() {
  const deadBuildings = buildings.filter(b => b.hp <= 0);
  if (deadBuildings.length > 0) {
    for (const b of deadBuildings) {
      for (let yy = b.y; yy < b.y + b.h; yy++)
        for (let xx = b.x; xx < b.x + b.w; xx++)
          buildingGrid[idx(xx, yy)] = -1;
      delete buildingsById[b.id];
      if (selectedBuilding === b) selectedBuilding = null;
    }
    buildings = buildings.filter(b => b.hp > 0);
    invalidateBuildingVision();
  }

  const deadUnits = units.filter(u => u.hp <= 0);
  if (deadUnits.length > 0) {
    for (const u of deadUnits) selectedIds.delete(u.id);
    units = units.filter(u => u.hp > 0);
    bumpSelection();
  }
}

// Boucle de combat d'une unité, appelée en tout premier depuis updateUnit (avant toute logique
// de zone/minage/construction) : détermine si l'unité doit se battre CETTE frame plutôt que
// suivre son comportement normal. Renvoie true si le combat a "consommé" la frame (updateUnit
// doit s'arrêter là), false sinon (aucun ennemi engagé — pour un ordre "attack" sans cible en
// vue, ça laisse la résolution d'ordre normale de updateUnit prendre le relais comme un simple
// déplacement vers le point ciblé : voir o.kind === 'attack' plus bas dans updateUnit).
//
// Trois cas, dans l'ordre de priorité :
// 1) Ordre "attack" explicite (bouton "Attaquer", voir issueAttackOrderAtScreen dans
//    06-training-build.js) : cible mémorisée sur l'ordre si toujours vivante, sinon repli sur
//    la détection automatique autour de la position actuelle (attaque-déplacement classique).
// 2) Stance "hold" (bouton "Défendre position", voir defendPosition) : détecte autour du point
//    ancré (u.holdX/holdY), y retourne tranquillement si plus aucun ennemi en vue.
// 3) Ni ordre ni stance "hold" : vigilance passive à l'arrêt — un soldat sans ordre riposte
//    quand même si un ennemi s'approche, sans action du joueur (comportement "garde").
function updateCombat(u, dt) {
  if (!u.attackDamage) return false; // pas un combattant (ouvrier) : sortie immédiate, coût nul
  if (u.mining || u.building) return false; // priorité au travail en cours (n'arrive normalement jamais pour un soldat, mais reste correct si un jour ça change)

  let target = null, isBuilding = false;

  // 'attack' ET 'defend' partagent la même logique d'engagement opportuniste ("si elle croise
  // un ennemi dans son champ de vision elle attaque") — seule leur résolution d'arrivée diffère
  // (voir updateUnit plus bas : 'defend' repart ensuite vers son point d'origine, 'attack' non).
  if (u.order && (u.order.kind === 'attack' || u.order.kind === 'defend')) {
    let explicit = null, explicitIsBuilding = false;
    if (u.order.targetUnitId !== null && u.order.targetUnitId !== undefined) {
      const t = units.find(uu => uu.id === u.order.targetUnitId);
      if (t && t.hp > 0) { explicit = t; explicitIsBuilding = false; }
    } else if (u.order.targetBuildingId !== null && u.order.targetBuildingId !== undefined) {
      const t = buildingsById[u.order.targetBuildingId];
      if (t && t.hp > 0) { explicit = t; explicitIsBuilding = true; }
    }
    if (explicit) {
      // Cible explicite mémorisée sur l'ordre (clic direct sur une unité/un bâtiment précis) :
      // ne bascule en engagement "combat" (déplacement direct sans A*, voir plus bas) que si
      // elle est déjà relativement proche. Trop loin, on laisse la résolution d'ordre normale
      // de updateUnit (A*, voir plus bas dans cette même fonction) rapprocher l'unité du point
      // cliqué au moment de l'ordre — sinon un soldat envoyé attaquer un bâtiment à l'autre
      // bout de la carte marcherait tout droit vers lui sans contourner le moindre obstacle et
      // pourrait rester bloqué indéfiniment contre un mur.
      const ex = explicitIsBuilding ? explicit.x + explicit.w / 2 : explicit.x;
      const ey = explicitIsBuilding ? explicit.y + explicit.h / 2 : explicit.y;
      if (Math.hypot(u.x - ex, u.y - ey) <= ATTACK_CHASE_RADIUS) { target = explicit; isBuilding = explicitIsBuilding; }
    }
    // Un canonnier (wallBuster) visant directement un mur (T_WALL) — clic droit "Attaquer" sur
    // un mur ennemi, voir issueAttackOrderAtScreen dans 06-training-build.js — traite ce mur
    // comme une cible à part entière, avec son propre marqueur __wallTile (voir plus bas).
    if (!target && u.wallBuster) {
      const wx = u.order.x, wy = u.order.y;
      if (inBounds(wx, wy) && grid[idx(wx, wy)] === T_WALL) target = { __wallTile: true, x: wx, y: wy };
    }
    if (!target) {
      const found = findNearestEnemy(u.owner, u.x, u.y, ATTACK_ACQUIRE_RADIUS);
      if (found) { target = found.target; isBuilding = found.isBuilding; }
    }
  } else if (u.order) {
    return false; // en train de faire autre chose (déplacement simple...) : pas de riposte automatique
  } else {
    const anchorX = u.stance === 'hold' ? u.holdX : u.x;
    const anchorY = u.stance === 'hold' ? u.holdY : u.y;
    const found = findNearestEnemy(u.owner, anchorX, anchorY, ATTACK_ACQUIRE_RADIUS);
    if (found) { target = found.target; isBuilding = found.isBuilding; }
    else if (u.stance === 'hold' && Math.hypot(u.x - u.holdX, u.y - u.holdY) > 0.05) {
      // Aucun ennemi en vue : retourne tranquillement se poster sur le point défendu.
      stepUnitTo(u, Math.floor(u.holdX), Math.floor(u.holdY), dt);
      return true;
    } else {
      return false;
    }
  }

  if (!target) return false;

  const isWallTile = !!target.__wallTile;
  const tx = isWallTile ? target.x + 0.5 : (isBuilding ? target.x + target.w / 2 : target.x);
  const ty = isWallTile ? target.y + 0.5 : (isBuilding ? target.y + target.h / 2 : target.y);
  const d = Math.hypot(u.x - tx, u.y - ty);

  if (d > u.attackRange) {
    // Cible repérée mais hors de portée : approche directe (un soldat n'a pas besoin du
    // pathfinding sophistiqué des ouvriers pour engager un ennemi déjà repéré et visible).
    const dirX = (tx - u.x) / d, dirY = (ty - u.y) / d;
    const move = u.speed * dt;
    const nx = u.x + dirX * move, ny = u.y + dirY * move;
    if (isWalkable(Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
    return true;
  }

  // À portée : tir au rythme du cooldown plutôt qu'à chaque frame.
  u.attackTimer = (u.attackTimer || 0) - dt;
  if (u.attackTimer <= 0) {
    if (isWallTile) {
      const ii = idx(target.x, target.y);
      if (grid[ii] === T_WALL) {
        tileHP[ii] -= u.attackDamage * (u.buildingDamageMult || 1);
        if (tileHP[ii] <= 0) onTileCleared(target.x, target.y);
      }
    } else {
      const dmgMult = isBuilding ? (u.buildingDamageMult || 1) : 1;
      applyDamage(target, isBuilding, u.attackDamage * dmgMult);
      // Dégâts de zone (grenadier/canonnier, voir baseSplashRadiusFor dans spawnUnit) : touche
      // aussi tout ennemi (unité ou bâtiment) proche du point d'impact, à dégâts réduits (60%)
      // par rapport au coup direct sur la cible principale — et, pour une unité "casse-mur"
      // (wallBuster), fissure également tout mur (T_WALL) dans le rayon de l'explosion, même
      // s'il n'était pas la cible visée : c'est ce qui permet à un canonnier de raser un mur en
      // combattant simplement ce qui se trouve derrière.
      if (u.splashRadius > 0) {
        for (const ou of units) {
          if (ou === target || ou.owner === u.owner || ou.hp <= 0) continue;
          if (Math.hypot(ou.x - tx, ou.y - ty) <= u.splashRadius) applyDamage(ou, false, u.attackDamage * 0.6);
        }
        for (const ob of buildings) {
          if (ob === target || ob.owner === u.owner || ob.hp <= 0) continue;
          const ocx = ob.x + ob.w / 2, ocy = ob.y + ob.h / 2;
          if (Math.hypot(ocx - tx, ocy - ty) <= u.splashRadius) applyDamage(ob, true, u.attackDamage * (u.buildingDamageMult || 1) * 0.6);
        }
        if (u.wallBuster) {
          const rad = Math.ceil(u.splashRadius);
          const cxT = Math.floor(tx), cyT = Math.floor(ty);
          for (let yy = cyT - rad; yy <= cyT + rad; yy++) {
            for (let xx = cxT - rad; xx <= cxT + rad; xx++) {
              if (!inBounds(xx, yy)) continue;
              if (Math.hypot(xx + 0.5 - tx, yy + 0.5 - ty) > u.splashRadius) continue;
              const ii = idx(xx, yy);
              if (grid[ii] === T_WALL) {
                tileHP[ii] -= u.attackDamage * (u.buildingDamageMult || 1) * 0.6;
                if (tileHP[ii] <= 0) onTileCleared(xx, yy);
              }
            }
          }
        }
      }
    }
    u.attackTimer = u.attackCooldown;
    hitSparks.push({ x: tx * TILE, y: ty * TILE, t: 0 }); // retour visuel du coup, voir 10-render.js
  }
  return true;
}

// Combat des BÂTIMENTS (tourelle) : se comporte comme un soldat immobile — détecte tout seul un
// ennemi à portée (même détection omnisciente que findNearestEnemy pour les unités, voir son
// commentaire) et riposte à cadence fixe, sans jamais se déplacer ni recevoir d'ordre explicite.
// Appelé une fois par frame pour toutes les tourelles (voir update() dans 09-update.js), pas
// dans updateUnit (une tourelle n'est pas dans le tableau `units`).
function updateBuildingCombat(dt) {
  for (const b of buildings) {
    if (b.type !== 'turret' || b.hp <= 0) continue;
    b.attackTimer = (b.attackTimer || 0) - dt;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const found = findNearestEnemy(b.owner, cx, cy, TURRET_ATTACK_RANGE);
    if (!found || b.attackTimer > 0) continue;
    const tx = found.isBuilding ? found.target.x + found.target.w / 2 : found.target.x;
    const ty = found.isBuilding ? found.target.y + found.target.h / 2 : found.target.y;
    applyDamage(found.target, found.isBuilding, TURRET_ATTACK_DAMAGE);
    b.attackTimer = TURRET_ATTACK_COOLDOWN;
    hitSparks.push({ x: tx * TILE, y: ty * TILE, t: 0 });
  }
}

// Boucle d'IA principale d'une unité, appelée une fois par frame pour chaque unité (voir
// update() dans 09-update.js). Résout l'ordre courant (u.order) en actions concrètes :
// choix de cible (si en zone et sans ordre), minage, construction, dépôt de ressources, et
// déplacement (pathfinding A* + secours ligne droite/creusement direct).
function updateUnit(u, dt) {
  // Combat AVANT tout le reste : un soldat qui engage un ennemi (ordre "attack", stance "hold",
  // ou simple vigilance passive à l'arrêt — voir updateCombat) n'exécute rien d'autre cette
  // frame. Ne consomme rien pour un ouvrier (attackDamage === 0, sortie immédiate).
  if (updateCombat(u, dt)) return;

  // Pas d'ordre en cours mais l'unité est assignée à une zone : décide automatiquement de la
  // prochaine action (miner une ressource visible, creuser vers l'inconnu, ou rentrer déposer
  // si l'inventaire est plein / la zone est entièrement épuisée et explorée).
  if (!u.order && !u.mining && !u.building) {
    if (u.zone) {
      if (u.carryAmount >= effectiveCarryCapacity()) {
        u.order = depositOrderFor(u);
      } else {
        const target = findNearestMinableInZone(u, u.zone);
        if (target) {
          u.order = { kind: 'harvest', x: target.x, y: target.y };
          u.tunnelPath = [];
        } else if (zoneHasUnexplored(u.zone)) {
          // Rien d'exploré/minable dans la zone pour l'instant : on creuse vers un point à
          // révéler, partagé par TOUTE la zone (zoneBreachPoint) — voir son commentaire pour
          // le détail. Si un chemin a déjà été calculé pour trouver ce point (breach.path,
          // premier ouvrier à l'atteindre), on le réutilise directement comme u.path plutôt
          // que de forcer un second calcul A* redondant juste après.
          const breach = zoneBreachPoint(u, u.zone);
          if (breach.point) {
              const near = breach.point;
              u.order = { kind: 'tunnel', x: near.x, y: near.y };
              u.tunnelPath = [];

              if (breach.path) {
                  u.path = breach.path;
                  u.pathTargetX = near.x;
                  u.pathTargetY = near.y;
                  u.pathCooldown = 1.0;

                  // Pré-remplit la surbrillance de tunnel avec les cases minables déjà connues
                  // du chemin réutilisé, pour qu'elle apparaisse immédiatement plutôt que
                  // d'attendre que l'unité les atteigne une à une (voir recordTunnelMine).
                  for (let i = 0; i < u.path.length; i++) {
                      let px = u.path[i].x, py = u.path[i].y;
                      if (!isWalkable(px, py) && isMinable(px, py)) {
                          recordTunnelMine(u, u.order, px, py);
                      }
                  }
              }
          } else {
              // Vraiment aucun point de percée trouvable (zone totalement inaccessible) :
              // on abandonne la zone plutôt que de boucler indéfiniment dessus.
              u.zone = null;
          }
        } else {
          u.zone = null;
          if (u.carryAmount > 0) {
            u.order = depositOrderFor(u);
          }
        }
      }
    } else if (u.carryAmount > 0) {
      u.order = depositOrderFor(u);
    }
  }

  if (!u.order) return;
  const o = u.order;
  const curX = Math.floor(u.x), curY = Math.floor(u.y);

  // Garde-fou anti-blocage : si l'unité a un ordre de déplacement mais ne progresse plus du
  // tout pendant plusieurs secondes (ni minage, ni construction en cours), on force un nouvel
  // essai plutôt que de la laisser plantée indéfiniment. IMPORTANT : ce chrono n'est JAMAIS
  // remis à zéro manuellement ailleurs pendant une cession de passage (voir handleYield) —
  // sinon une attente prolongée derrière une unité à l'arrêt désactiverait ce filet de
  // sécurité et l'unité pourrait rester figée indéfiniment malgré un passage disponible.
  if (!u.mining && !u.building) {
    if (u.stuckCheckX === undefined || Math.hypot(u.x - u.stuckCheckX, u.y - u.stuckCheckY) > 0.15) {
      u.stuckCheckX = u.x; u.stuckCheckY = u.y; u.stuckTimer = 0;
    } else {
      u.stuckTimer = (u.stuckTimer || 0) + dt;
      if (u.stuckTimer > 3) {
        if (o.kind === 'harvest') blacklistTile(u, o.x, o.y, 15);
        u.order = null; u.path = null; u.pathTargetX = null; u.pathTargetY = null; u.stuckTimer = 0;
        return;
      }
    }
  }

  // ---- Minage en cours ----
  if (u.mining) {
    const { x: mx, y: my } = u.mineTarget;
    if (!isMinable(mx, my)) { u.mining = false; u.mineTarget = null; return; }
    if (grid[idx(mx, my)] === T_GAS) {
      triggerExplosion(mx, my);
      u.mining = false; u.mineTarget = null; u.order = null;
      return;
    }
    // Inventaire plein en cours de minage : on interrompt (la case garde ses PV restants,
    // rien n'est perdu) pour aller déposer, puis on reprendra automatiquement (voir le bloc
    // 'deposit' plus bas, u.resumeTarget/u.resumeOrder).
    if (u.carryAmount >= effectiveCarryCapacity()) {
      u.mining = false;
      u.resumeTarget = { x: mx, y: my };
      u.resumeOrder = { kind: o.kind, x: o.x, y: o.y };
      u.order = depositOrderFor(u);
      return;
    }
    u.mineTimer += dt;
    if (u.mineTimer >= MINE_INTERVAL) {
      u.mineTimer -= MINE_INTERVAL;
      const i = idx(mx, my);
      const tType = grid[i];
      tileHP[i] -= u.minePower;
      if (tileHP[i] <= 0) {
        // Case épuisée : +1 unité de la ressource correspondante dans l'inventoire PAR TYPE de
        // l'ouvrier (voir spawnUnit) — carryAmount (le total) sert de jauge globale contre
        // effectiveCarryCapacity(), indépendamment de la répartition entre bois/minerai/pierre.
        const resType = tType === T_WOOD ? 'bois' : tType === T_MINERAL ? 'minerai' : tType === T_STONE ? 'pierre' : null;
        if (resType && u.carryAmount < effectiveCarryCapacity()) {
          u.inventory[resType]++;
          u.carryAmount++;
        }
        onTileCleared(mx, my);
        u.mining = false; u.mineTarget = null;
      }
    }
    return;
  }

  // ---- Construction en cours ----
  if (u.building) {
    const site = u.buildSite;
    if (!site || !sites.includes(site)) { u.building = false; u.buildSite = null; u.order = null; return; }
    u.buildTimer = (u.buildTimer || 0) + dt;
    if (u.buildTimer >= MINE_INTERVAL) {
      u.buildTimer -= MINE_INTERVAL;
      site.hp += BUILD_POWER;
      if (site.hp >= site.targetHp) {
        completeSite(site);
        u.building = false; u.buildSite = null; u.order = null;
        // File d'attente de constructions (plusieurs chantiers assignés d'un coup) : enchaîne
        // automatiquement sur le suivant une fois celui-ci terminé.
        if (u.buildQueue && u.buildQueue.length > 0) {
          const nextId = u.buildQueue.shift();
          const nextSite = sites.find(s => s.id === nextId);
          if (nextSite) {
            const cx = Math.floor(u.x), cy = Math.floor(u.y);
            const ax = clamp(cx, nextSite.x, nextSite.x + nextSite.w - 1);
            const ay = clamp(cy, nextSite.y, nextSite.y + nextSite.h - 1);
            u.order = { kind: 'build', x: ax, y: ay, siteId: nextSite.id };
          }
        }
      }
    }
    return;
  }

  // ---- Résolution de l'ordre courant selon son type ----
  if (o.kind === 'move' && curX === o.x && curY === o.y) { u.order = null; return; }
  if (o.kind === 'tunnel' && curX === o.x && curY === o.y) { u.order = null; return; }
  if (o.kind === 'attack' && curX === o.x && curY === o.y) { u.order = null; return; } // point d'attaque-déplacement atteint sans avoir croisé d'ennemi
  if (o.kind === 'defend' && curX === o.x && curY === o.y) {
    // Zone atteinte sans (ou plus) d'ennemi à combattre (updateCombat aurait sinon empêché
    // d'arriver jusqu'ici, voir plus haut) : repart vers le point d'origine mémorisé sur l'ordre
    // (o.returnX/returnY) au lieu de s'arrêter là — c'est ce qui distingue "Défendre" d'
    // "Attaquer" (voir issueDefendOrderAtScreen dans 06-training-build.js). Deuxième arrivée
    // (déjà en phase 'return') : ordre terminé, l'unité redevient libre.
    if (o.phase !== 'return') {
      u.order = { kind: 'defend', x: Math.floor(o.returnX), y: Math.floor(o.returnY), targetUnitId: null, targetBuildingId: null, returnX: o.returnX, returnY: o.returnY, phase: 'return' };
    } else {
      u.order = null;
    }
    return;
  }

  if (o.kind === 'harvest') {
    if (!isMinable(o.x, o.y)) { u.order = null; return; }
    const cheb = Math.max(Math.abs(curX - o.x), Math.abs(curY - o.y));
    if (cheb <= 1) { u.mining = true; u.mineTarget = { x: o.x, y: o.y }; u.mineTimer = 0; return; }
  } else if (o.kind === 'build') {
    const site = sites.find(s => s.id === o.siteId);
    if (!site) { u.order = null; return; }
    const cheb = Math.max(Math.abs(curX - o.x), Math.abs(curY - o.y));
    if (cheb <= 1) { u.building = true; u.buildSite = site; u.buildTimer = 0; return; }
  } else if (o.kind === 'deposit') {
    // Vise le bâtiment mémorisé sur l'ordre (o.depositId, voir depositOrderFor) plutôt que
    // toujours le même bâtiment — repli sur le point de dépôt le plus proche DU MÊME CAMP si ce
    // bâtiment précis a été détruit entre-temps (voir nearestDepositBuilding, owner-aware).
    const dep = (o.depositId !== undefined && buildingsById[o.depositId]) || nearestDepositBuilding(u);
    if (!dep) { u.order = null; return; } // plus aucun point de dépôt pour ce camp (toutes ses bases détruites)
    const cheb = chebRectDist(curX, curY, dep.x, dep.y, dep.w, dep.h);
    if (cheb <= 1) {
      // Dépose TOUTES les catégories de ressources transportées d'un coup (bois/minerai/pierre
      // simultanément si l'unité a miné plusieurs types), chacune avec son propre multiplicateur
      // de rendement (WOOD_YIELD/MINERAL_YIELD/STONE_YIELD, voir 01-constants.js) — crédité au
      // pool de ressources DU CAMP de l'unité (resourcesFor, voir 03-simulation.js), pas
      // toujours à celui du joueur.
      if (u.carryAmount > 0) {
        const pool = resourcesFor(u.owner);
        for (const [resType, amount] of Object.entries(u.inventory)) {
          if (amount > 0) {
            let yieldMult = 1;
            if (resType === 'bois') yieldMult = WOOD_YIELD;
            else if (resType === 'minerai') yieldMult = MINERAL_YIELD;
            else if (resType === 'pierre') yieldMult = STONE_YIELD;
            pool[resType] += amount * yieldMult;
            u.inventory[resType] = 0;
          }
        }
      }
      u.carryAmount = 0;
      // Reprend le trajet vers la destination lointaine d'origine si le dépôt a interrompu un
      // ordre "tunnel" (pas seulement la case qu'on était en train de miner quand l'inventaire
      // s'est rempli), sinon reprend directement le minage de la case interrompue.
      if (u.resumeOrder && u.resumeOrder.kind === 'tunnel') {
        u.order = { kind: 'tunnel', x: u.resumeOrder.x, y: u.resumeOrder.y };
      } else if (u.resumeTarget && isMinable(u.resumeTarget.x, u.resumeTarget.y)) {
        u.order = { kind: 'harvest', x: u.resumeTarget.x, y: u.resumeTarget.y };
      } else {
        u.order = null;
      }
      u.resumeTarget = null; u.resumeOrder = null;
      return;
    }
  }

  // ---- Déplacement vers la cible de l'ordre ----
  // Seuls les ordres qui ont explicitement le droit de miner (harvest = récolter une ressource
  // précise, tunnel = outil "Miner vers") peuvent creuser en chemin ; un simple déplacement
  // ('move') ne détruit jamais de blocs, même s'il est bloqué par de la roche.
  const canMineThrough = (o.kind === 'harvest' || o.kind === 'tunnel') && u.minePower > 0;

  let dx = Math.sign(o.x - curX), dy = Math.sign(o.y - curY);
  if (dx === 0 && dy === 0) { u.order = null; return; }

  u.pathCooldown = (u.pathCooldown || 0) - dt;

  // Un ordre "tunnel" (outil "Miner vers") NE lance PAS d'A* de façon proactive à chaque
  // changement de cible : le comportement NORMAL est de creuser tout droit vers la cible (bloc
  // de creusement direct plus bas), exactement ce que la surbrillance affiche dès l'émission
  // de l'ordre (voir directLineTiles dans issueTunnelOrderAtScreen, 06-training-build.js).
  // Lancer un A* borné (findPath, maxNodes=1000) à chaque ordre était à la fois inutilement
  // coûteux pour un long tunnel ET la cause du bug "la surbrillance montre les premiers blocs
  // mais pas le reste" : au-delà de son budget de recherche, findPath renvoyait un chemin
  // PARTIEL tronqué, et seule cette portion était préremplie dans u.tunnelPath. L'A* n'est
  // maintenant déclenché pour un tunnel que ponctuellement, quand l'unité est RÉELLEMENT
  // bloquée (mur incassable ou cavité qui rend la ligne directe impraticable) — voir tout en
  // bas de cette fonction.
  if (o.kind !== 'tunnel') {
    // Recalcule le chemin A* uniquement si la cible a changé ou si le chemin précédent a été
    // invalidé ET que le délai anti-spam (pathCooldown) est écoulé — un A* complet à chaque
    // frame serait bien trop coûteux. canMineThrough est transmis à findPath pour autoriser (ou
    // non) les détours creusés à travers la roche, voir 03-simulation.js.
    if (!u.path || u.pathTargetX !== o.x || u.pathTargetY !== o.y) {
      if (u.pathTargetX !== o.x || u.pathTargetY !== o.y || u.pathCooldown <= 0) {
        u.path = findPath(curX, curY, o.x, o.y, canMineThrough);
        u.pathTargetX = o.x;
        u.pathTargetY = o.y;
        if (!u.path) u.pathCooldown = 1.0;
      }
    }
  }

  // Suit un chemin A* déjà calculé, qu'il vienne du recalcul proactif ci-dessus (ordres
  // non-tunnel) OU d'un contournement ponctuel déclenché plus bas parce qu'un tunnel s'est
  // retrouvé bloqué. Une fois ce chemin épuisé, le creusement direct qui suit reprend
  // automatiquement vers la vraie cible de l'ordre.
  if (u.path && u.path.length > 0) {
    let next = u.path[0];
    if (curX === next.x && curY === next.y) {
      u.path.shift();
      if (u.path.length > 0) next = u.path[0];
    }

    if (u.path.length > 0) {
      // Le chemin A* peut traverser une case minable non franchissable (voir canMine dans
      // findPath) : si la prochaine case du chemin en est une, on la mine plutôt que de
      // rester bloqué devant.
      if (!isWalkable(next.x, next.y) && isMinable(next.x, next.y) && canMineThrough) {
        if (Math.max(Math.abs(curX - next.x), Math.abs(curY - next.y)) <= 1) {
            u.mining = true; u.mineTarget = { x: next.x, y: next.y }; u.mineTimer = 0;
            recordTunnelMine(u, o, next.x, next.y);
            return;
        }
      }

      if (isWalkable(next.x, next.y)) {
        // La cession de passage (handleYield) est désactivée : la répulsion mutuelle qui
        // gérait les collisions est elle-même coupée (voir 09-update.js), donc céder le
        // passage ici ne faisait plus que ralentir les unités pour rien, sans plus jamais
        // résoudre de vrai chevauchement ensuite.
        stepUnitTo(u, next.x, next.y, dt);
        return;
      } else {
        u.path = null;
      }
    }
  }

  // Creusement / marche EN LIGNE DIRECTE vers la cible : comportement normal d'un tunnel, et
  // repli d'un ordre non-tunnel resté sans chemin A* exploitable.
  let nx = curX + dx, ny = curY + dy;
  let canDiag = true;
  if (dx !== 0 && dy !== 0) {
    if (!isWalkable(curX + dx, curY) || !isWalkable(curX, curY + dy)) canDiag = false;
  }
  if (canDiag && isWalkable(nx, ny)) {
    stepUnitTo(u, nx, ny, dt); return;
  }

  if (canMineThrough) {
    if (isMinable(nx, ny)) { u.mining = true; u.mineTarget = { x: nx, y: ny }; u.mineTimer = 0; recordTunnelMine(u, o, nx, ny); return; }
    if (dx !== 0 && isMinable(curX + dx, curY)) { u.mining = true; u.mineTarget = { x: curX + dx, y: curY }; u.mineTimer = 0; recordTunnelMine(u, o, curX + dx, curY); return; }
    if (dy !== 0 && isMinable(curX, curY + dy)) { u.mining = true; u.mineTarget = { x: curX, y: curY + dy }; u.mineTimer = 0; recordTunnelMine(u, o, curX, curY + dy); return; }
  }

  if (dx !== 0 && isWalkable(curX + dx, curY)) {
    stepUnitTo(u, curX + dx, curY, dt); return;
  }
  if (dy !== 0 && isWalkable(curX, curY + dy)) {
    stepUnitTo(u, curX, curY + dy, dt); return;
  }

  // Vraiment coincé en ligne directe : ni pas droit/diagonal franchissable, ni case minable
  // adjacente dans la bonne direction (mur incassable, ou cavité dont le bord empêche tout pas
  // direct vers la cible).
  if (o.kind === 'tunnel') {
    // Pour un tunnel, on ne renonce pas à l'ordre : c'est exactement le cas où l'A* (findPath,
    // creusement autorisé) prend le relais pour se rapprocher du point atteignable le plus
    // proche de la cible (repli sur chemin partiel, voir findPath dans 03-simulation.js), quitte
    // à devoir emprunter un vrai détour. Le creusement direct reprendra tout seul, plus haut
    // dans cette fonction, une fois ce chemin de contournement épuisé.
    if (u.pathCooldown <= 0) {
      const detour = findPath(curX, curY, o.x, o.y, true);
      u.pathCooldown = 1.0;
      if (detour && detour.length > 0) {
        u.path = detour;
        u.pathTargetX = o.x;
        u.pathTargetY = o.y;
      }
    }
    // Ordre conservé dans tous les cas (contournement trouvé ou pas encore) : on retentera à la
    // frame suivante plutôt que d'abandonner, l'unité n'ayant rien de mieux à faire entre-temps.
    return;
  }

  // Autre ordre (harvest) vraiment coincé : on abandonne pour laisser la logique de plus haut
  // (zone, dépôt...) retenter avec une autre cible.
  if (o.kind === 'harvest') blacklistTile(u, o.x, o.y, 15);
  u.order = null;
  u.path = null;
}
