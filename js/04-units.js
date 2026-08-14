/* === 04-units.js — Unités : spawn, IA de déplacement/minage/construction (updateUnit) (original: lignes 575-880) === */
// ---------- Unités ----------
let units = [];
let nextUnitId = 1;
function spawnUnit(type, tx, ty) {
  const u = {
    id: nextUnitId++, type, owner: 'player',
    x: tx + 0.5, y: ty + 0.5,
    order: null, mining: false, mineTarget: null, mineTimer: 0, zone: null,
    building: false, buildSite: null, buildTimer: 0, buildQueue: [],
    carryType: null, carryAmount: 0, resumeTarget: null, resumeOrder: null,
    stuckTimer: 0, stuckCheckX: undefined, stuckCheckY: undefined, avoid: null,
    hp: type === 'soldier' ? 40 : 20, maxhp: type === 'soldier' ? 40 : 20,
    speed: type === 'soldier' ? 1.7 : 2.0,
    minePower: type === 'worker' ? HP_PER_RESOURCE : 0,
    animSeed: Math.random() * 1000,
    path: null, pathTargetX: null, pathTargetY: null, pathCooldown: 0,
    yieldTimer: 0
  };
  units.push(u);
  return u;
}
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
function stepUnitTo(u, nx, ny, dt) {
  const tpx = nx + 0.5, tpy = ny + 0.5;
  const ddx = tpx - u.x, ddy = tpy - u.y;
  const d = Math.hypot(ddx, ddy);
  const move = u.speed * dt;
  if (d <= move || d < 0.001) { u.x = tpx; u.y = tpy; }
  else { u.x += ddx / d * move; u.y += ddy / d * move; }
}

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
function isBlacklisted(u, xx, yy) {
  if (!u.avoid) return false;
  const exp = u.avoid[xx + ',' + yy];
  return exp !== undefined && exp > gameTime;
}
function blacklistTile(u, xx, yy, seconds) {
  u.avoid = u.avoid || {};
  u.avoid[xx + ',' + yy] = gameTime + seconds;
}
function zoneHasUnexplored(zone) {
  if (!fogEnabled) return false;
  if (zone.type === 'rect') {
    for (let yy = zone.y0; yy <= zone.y1; yy++) for (let xx = zone.x0; xx <= zone.x1; xx++) if (!exploredTile[idx(xx, yy)]) return true;
  } else if (zone.type === 'path') {
    for (const t of zone.tiles) if (!exploredTile[idx(t.x, t.y)]) return true;
  }
  return false;
}
function nearestPointInZone(u, zone) {
  let best = null, bestD = Infinity;
  const consider = (xx, yy) => {
    if (fogEnabled && exploredTile[idx(xx, yy)]) return; // déjà exploré : pas utile d'y retourner
    const d = (xx + 0.5 - u.x) ** 2 + (yy + 0.5 - u.y) ** 2;
    if (d < bestD) { bestD = d; best = { x: xx, y: yy }; }
  };
  if (zone.type === 'rect') {
    for (let yy = zone.y0; yy <= zone.y1; yy++) for (let xx = zone.x0; xx <= zone.x1; xx++) consider(xx, yy);
  } else {
    for (const t of zone.tiles) consider(t.x, t.y);
  }
  if (best) return best;
  if (zone.type === 'rect') return { x: clamp(Math.floor(u.x), zone.x0, zone.x1), y: clamp(Math.floor(u.y), zone.y0, zone.y1) };
  return { x: Math.floor(u.x), y: Math.floor(u.y) };
}

// Point de percée COMMUN à toute une zone (au lieu d'un point recalculé indépendamment par
// chaque ouvrier d'après SA propre position) : le premier ouvrier qui en a besoin en choisit
// un et le mémorise sur la zone elle-même (zone.breachPoint) ; tous les autres ouvriers
// réutilisent ensuite ce même point tant qu'il reste à explorer, au lieu que chacun creuse son
// propre tunnel séparé vers sa cible individuelle la plus proche. Une fois ce point atteint
// (exploré), le cache est invalidé et un nouveau point est choisi pour la poche suivante s'il
// en reste une.
function zoneBreachPoint(u, zone) {
  const cached = zone.breachPoint;
  if (cached && (!fogEnabled || !exploredTile[idx(cached.x, cached.y)])) return cached;
  const fresh = nearestPointInZone(u, zone);
  zone.breachPoint = fresh;
  return fresh;
}

// Enregistre une case comme réellement ciblée pour le minage sous un ordre "tunnel" : la
// surbrillance affichée (10-render.js) ne montre plus un tracé théorique précalculé, mais
// exactement les cases que l'unité a effectivement décidé de miner, au fur et à mesure.
function recordTunnelMine(u, o, x, y) {
  if (o.kind !== 'tunnel') return;
  u.tunnelPath = u.tunnelPath || [];
  if (!u.tunnelPath.some(p => p.x === x && p.y === y)) u.tunnelPath.push({ x, y });
}

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

const YIELD_PATIENCE = 1.2; // secondes d'attente max avant de forcer le passage

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
// ralentissement. Passé le délai, elle essaie d'abord de creuser une case voisine pour
// élargir le passage (si elle est ouvrière), sinon elle avance quand même : un éventuel
// chevauchement bref est résorbé par la répulsion mutuelle (voir update()).
function handleYield(u, tx, ty, dx, dy, dt) {
  if (!shouldYieldMovement(u, tx, ty)) { u.yieldTimer = 0; return false; }
  u.yieldTimer = (u.yieldTimer || 0) + dt;
  if (u.yieldTimer <= YIELD_PATIENCE) return true; // attend encore un peu
  if (tryClearJam(u, dx, dy)) { u.yieldTimer = 0; return true; }
  u.yieldTimer = 0;
  return false; // patience écoulée, rien à dégager : on avance quand même
}

function updateUnit(u, dt) {
  if (!u.order && !u.mining && !u.building) {
    if (u.zone) {
      if (u.carryAmount >= CARRY_CAPACITY) {
        u.order = { kind: 'deposit', x: clamp(Math.floor(u.x), baseBuilding.x, baseBuilding.x + baseBuilding.w - 1), y: clamp(Math.floor(u.y), baseBuilding.y, baseBuilding.y + baseBuilding.h - 1) };
      } else {
        const target = findNearestMinableInZone(u, u.zone);
        if (target) {
          u.order = { kind: 'harvest', x: target.x, y: target.y };
        } else if (zoneHasUnexplored(u.zone)) {
          // rien d'exploré/minable dans la zone pour l'instant : on creuse vers un point à
          // révéler, plutôt que d'abandonner tout de suite. Ce point est partagé par TOUTE la
          // zone (zoneBreachPoint) : sans ça, chaque ouvrier calculait sa propre cible la plus
          // proche de LUI et creusait son propre tunnel individuel, résultat plusieurs trous
          // séparés au lieu d'un seul chemin commun emprunté par tout le groupe.
          const near = zoneBreachPoint(u, u.zone);
          u.order = { kind: 'tunnel', x: near.x, y: near.y };
          // Nouvelle cible de tunnel : on repart d'une liste vide, remplie au fil de l'eau
          // avec les cases réellement minées (voir recordTunnelMine) plutôt qu'un tracé
          // théorique précalculé qui pouvait ne pas correspondre à ce qui est vraiment miné.
          u.tunnelPath = [];
        } else {
          u.zone = null;
          if (u.carryAmount > 0) {
            u.order = { kind: 'deposit', x: clamp(Math.floor(u.x), baseBuilding.x, baseBuilding.x + baseBuilding.w - 1), y: clamp(Math.floor(u.y), baseBuilding.y, baseBuilding.y + baseBuilding.h - 1) };
          }
        }
      }
    } else if (u.carryAmount > 0) {
      u.order = { kind: 'deposit', x: clamp(Math.floor(u.x), baseBuilding.x, baseBuilding.x + baseBuilding.w - 1), y: clamp(Math.floor(u.y), baseBuilding.y, baseBuilding.y + baseBuilding.h - 1) };
    }
  }

  if (!u.order) return;
  const o = u.order;
  const curX = Math.floor(u.x), curY = Math.floor(u.y);

  // Garde-fou anti-blocage : si l'unité a un ordre de déplacement mais ne progresse plus
  // du tout pendant plusieurs secondes (ni minage, ni construction en cours), on force un
  // nouvel essai plutôt que de la laisser plantée indéfiniment.
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

  if (u.mining) {
    const { x: mx, y: my } = u.mineTarget;
    if (!isMinable(mx, my)) { u.mining = false; u.mineTarget = null; return; }
    if (grid[idx(mx, my)] === T_GAS) {
      triggerExplosion(mx, my);
      u.mining = false; u.mineTarget = null; u.order = null;
      return;
    }
    if (u.carryAmount >= CARRY_CAPACITY) {
      u.mining = false;
      u.resumeTarget = { x: mx, y: my };
      u.resumeOrder = { kind: o.kind, x: o.x, y: o.y };
      u.order = { kind: 'deposit', x: clamp(curX, baseBuilding.x, baseBuilding.x + baseBuilding.w - 1), y: clamp(curY, baseBuilding.y, baseBuilding.y + baseBuilding.h - 1) };
      return;
    }
    u.mineTimer += dt;
    if (u.mineTimer >= MINE_INTERVAL) {
      u.mineTimer -= MINE_INTERVAL;
      const i = idx(mx, my);
      const tType = grid[i];
      tileHP[i] -= u.minePower;
      if (tileHP[i] <= 0) {
        const resType = tType === T_WOOD ? 'bois' : tType === T_MINERAL ? 'minerai' : tType === T_STONE ? 'pierre' : null;
        if (resType && u.carryAmount < CARRY_CAPACITY && (u.carryType === null || u.carryType === resType)) {
          u.carryType = resType; u.carryAmount++;
        }
        onTileCleared(mx, my);
        u.mining = false; u.mineTarget = null;
      }
    }
    return;
  }

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

  if (o.kind === 'move' && curX === o.x && curY === o.y) { u.order = null; return; }
  if (o.kind === 'tunnel' && curX === o.x && curY === o.y) { u.order = null; return; }

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
    const cheb = chebRectDist(curX, curY, baseBuilding.x, baseBuilding.y, baseBuilding.w, baseBuilding.h);
    if (cheb <= 1) {
      if (u.carryType) {
        let yieldMult = 1;
        if (u.carryType === 'bois') yieldMult = WOOD_YIELD;
        else if (u.carryType === 'minerai') yieldMult = MINERAL_YIELD;
        else if (u.carryType === 'pierre') yieldMult = STONE_YIELD;
        resources[u.carryType] += u.carryAmount * yieldMult;
      }
      u.carryType = null; u.carryAmount = 0;
      if (u.resumeOrder && u.resumeOrder.kind === 'tunnel') {
        // reprendre le trajet vers la destination lointaine d'origine, pas seulement
        // la case qu'on était en train de miner quand l'inventaire s'est rempli
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

  // seuls les ordres qui ont explicitement le droit de miner (harvest = récolter une
  // ressource précise, tunnel = outil "Miner vers") peuvent creuser en chemin ; un simple
  // déplacement ('move') ne détruit jamais de blocs, même s'il est bloqué par de la roche.
  const canMineThrough = (o.kind === 'harvest' || o.kind === 'tunnel') && u.minePower > 0;

  let dx = Math.sign(o.x - curX), dy = Math.sign(o.y - curY);
  if (dx === 0 && dy === 0) { u.order = null; return; }

  u.pathCooldown = (u.pathCooldown || 0) - dt;
  if (!u.path || u.pathTargetX !== o.x || u.pathTargetY !== o.y) {
    if (u.pathTargetX !== o.x || u.pathTargetY !== o.y || u.pathCooldown <= 0) {
      u.path = findPath(curX, curY, o.x, o.y);
      u.pathTargetX = o.x; 
      u.pathTargetY = o.y;
      if (!u.path) u.pathCooldown = 1.0; 
    }
  }

  if (u.path && u.path.length > 0) {
    let next = u.path[0];
    if (curX === next.x && curY === next.y) {
      u.path.shift();
      if (u.path.length > 0) next = u.path[0];
    }
    
    if (u.path.length > 0) {
      if (next.x === o.x && next.y === o.y && isMinable(next.x, next.y) && canMineThrough) {
        if (Math.max(Math.abs(curX - next.x), Math.abs(curY - next.y)) <= 1) {
            u.mining = true; u.mineTarget = { x: next.x, y: next.y }; u.mineTimer = 0;
            recordTunnelMine(u, o, next.x, next.y);
            return;
        }
      }
      if (isWalkable(next.x, next.y)) {
        // Cède le passage (avec patience bornée, voir handleYield) : le chrono anti-blocage
        // n'est PAS remis à zéro ici — sinon une attente indéfinie derrière une unité à l'arrêt
        // désactiverait le filet de sécurité anti-blocage général (voir plus haut dans updateUnit).
        const stepDx = Math.sign(next.x - curX), stepDy = Math.sign(next.y - curY);
        if (handleYield(u, next.x, next.y, stepDx, stepDy, dt)) return;
        stepUnitTo(u, next.x, next.y, dt);
        return;
      } else {
        u.path = null;
      }
    }
  }

  // Pas de route déjà ouverte trouvée par A* : si l'ordre autorise le minage (harvest/tunnel),
  // on creuse une ligne directe vers la cible au lieu de rester planté là ("stuck").
  let nx = curX + dx, ny = curY + dy;
  let canDiag = true;
  if (dx !== 0 && dy !== 0) {
    if (!isWalkable(curX + dx, curY) || !isWalkable(curX, curY + dy)) canDiag = false;
  }
  if (canDiag && isWalkable(nx, ny)) {
    if (handleYield(u, nx, ny, dx, dy, dt)) return;
    stepUnitTo(u, nx, ny, dt); return;
  }

  if (canMineThrough) {
    if (isMinable(nx, ny)) { u.mining = true; u.mineTarget = { x: nx, y: ny }; u.mineTimer = 0; recordTunnelMine(u, o, nx, ny); return; }
    if (dx !== 0 && isMinable(curX + dx, curY)) { u.mining = true; u.mineTarget = { x: curX + dx, y: curY }; u.mineTimer = 0; recordTunnelMine(u, o, curX + dx, curY); return; }
    if (dy !== 0 && isMinable(curX, curY + dy)) { u.mining = true; u.mineTarget = { x: curX, y: curY + dy }; u.mineTimer = 0; recordTunnelMine(u, o, curX, curY + dy); return; }
  }

  if (dx !== 0 && isWalkable(curX + dx, curY)) {
    if (handleYield(u, curX + dx, curY, dx, 0, dt)) return;
    stepUnitTo(u, curX + dx, curY, dt); return;
  }
  if (dy !== 0 && isWalkable(curX, curY + dy)) {
    if (handleYield(u, curX, curY + dy, 0, dy, dt)) return;
    stepUnitTo(u, curX, curY + dy, dt); return;
  }

  // vraiment coincé (par ex. cible entourée de murs, non minables) : on abandonne cet ordre
  // pour laisser la logique de plus haut (zone, dépôt...) retenter avec une autre cible.
  if (o.kind === 'harvest') blacklistTile(u, o.x, o.y, 15);
  u.order = null;
  u.path = null;
}
