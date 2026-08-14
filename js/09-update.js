/* === 09-update.js — Boucle de mise à jour (update) : simulation par frame (original: lignes 1642-1693) === */
// ---------- Boucle de jeu ----------
let lastT = performance.now();
let fpsAcc = 0, fpsCount = 0;
let overviewTimer = 0;
let gameTime = 0;

// Boucle de simulation principale, appelée une fois par frame avec dt = temps écoulé (en
// secondes) depuis la frame précédente (voir gameLoop dans 11-loop-init.js). Ordre des étapes :
// défilement caméra (WASD/flèches) -> répulsion mutuelle des unités -> IA de chaque unité
// (updateUnit) -> production des bâtiments -> recalcul du brouillard de guerre -> nettoyage
// des zones orphelines/effets temporaires -> minicarte (throttlée à 1x/s) -> HUD.
function update(dt) {
  gameTime += dt;
  const PAN = 520;
  if (keys.has('w') || keys.has('arrowup')) camera.y -= PAN * dt / zoom;
  if (keys.has('s') || keys.has('arrowdown')) camera.y += PAN * dt / zoom;
  if (keys.has('a') || keys.has('arrowleft')) camera.x -= PAN * dt / zoom;
  if (keys.has('d') || keys.has('arrowright')) camera.x += PAN * dt / zoom;
  clampCamera();

  // NOTE : répulsion mutuelle DÉSACTIVÉE (bloc commenté ci-dessous). Tant qu'elle reste ainsi,
  // deux unités peuvent à nouveau se superposer/se traverser sans être écartées (c'est ce que
  // ce bloc corrigeait à l'origine). handleYield (04-units.js) gère toujours la cession de
  // passage sur la case de DESTINATION visée, mais plus la séparation physique une fois que
  // deux unités se retrouvent effectivement l'une sur l'autre. Si c'est temporaire (debug/perf
  // avec NUM_PLAYERS=4), pensez à le réactiver ; description d'origine du correctif :
  // plus ferme qu'avant (les unités se marchaient encore visiblement dessus dans les zones
  // ouvertes) et gère le cas de deux unités parfaitement superposées (ex. spawn au même
  // endroit) en les écartant dans une direction aléatoire plutôt que de ne rien faire (l'ancien
  // calcul, basé sur dx/dist, ne pouvait pas gérer une distance nulle).
  // for (let i = 0; i < units.length; i++) {
  //   for (let j = i + 1; j < units.length; j++) {
  //     const u1 = units[i], u2 = units[j];
  //     const dx = u1.x - u2.x;
  //     const dy = u1.y - u2.y;
  //     const distSq = dx * dx + dy * dy;
  //     if (distSq < 0.5) {
  //       let dist = Math.sqrt(distSq);
  //       let ux, uy;
  //       if (dist < 0.0001) {
  //         const ang = Math.random() * Math.PI * 2;
  //         ux = Math.cos(ang); uy = Math.sin(ang); dist = 0;
  //       } else {
  //         ux = dx / dist; uy = dy / dist;
  //       }
  //       const push = (0.7 - dist) * 0.45;
  //       const px = ux * push, py = uy * push;
  //       if (isWalkable(Math.floor(u1.x + px), Math.floor(u1.y + py))) { u1.x += px; u1.y += py; }
  //       if (isWalkable(Math.floor(u2.x - px), Math.floor(u2.y - py))) { u2.x -= px; u2.y -= py; }
  //     }
  //   }
  // }

  for (const u of units) updateUnit(u, dt);
  updateBuildings(dt);
  updateResearch(dt);
  updateRivalAI(dt);
  // Purge des unités/bâtiments tués au combat cette frame (voir applyDamage dans 04-units.js) —
  // APRÈS la boucle d'IA des unités et l'IA rivale (toutes deux peuvent infliger des dégâts),
  // AVANT updateVision (pour qu'un bâtiment détruit cesse immédiatement de contribuer au
  // brouillard de guerre plutôt que d'attendre le prochain rafraîchissement périodique).
  cleanupDeadFromCombat();
  updateVision();

  // Une zone dont plus aucune unité n'est membre (toutes réassignées ailleurs, mortes...)
  // devient orpheline et inutile à garder en mémoire.
  zones = zones.filter(z => units.some(u => u.zone === z));

  // Purge des effets visuels temporaires une fois leur durée de vie écoulée (pings de clic
  // droit, particules d'explosion de gaz, fumée de recherche, éclairs d'impact de combat).
  for (let i = pings.length - 1; i >= 0; i--) { pings[i].t += dt; if (pings[i].t > 0.45) pings.splice(i, 1); }
  for (let i = explosions.length - 1; i >= 0; i--) { explosions[i].t += dt; if (explosions[i].t > 0.9) explosions.splice(i, 1); }
  for (let i = smokeParticles.length - 1; i >= 0; i--) { smokeParticles[i].t += dt; if (smokeParticles[i].t > smokeParticles[i].life) smokeParticles.splice(i, 1); }
  for (let i = hitSparks.length - 1; i >= 0; i--) { hitSparks[i].t += dt; if (hitSparks[i].t > 0.25) hitSparks.splice(i, 1); }

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) document.getElementById('toast').textContent = ''; }

  overviewTimer += dt;
  if (overviewTimer > 1) { overviewTimer = 0; rebuildOverview(); }

  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) { document.getElementById('fps').textContent = Math.round(fpsCount / fpsAcc) + ' fps'; fpsAcc = 0; fpsCount = 0; }

  updateHUD();
}

// ---------- IA rivale ----------
// L'IA pilote UN SEUL camp collectif 'rival' (voir la note dans 01-constants.js : toutes les
// bases non-joueur générées par NUM_PLAYERS partagent le même owner 'rival', il n'y a pas de
// distinction entre elles). Elle tourne au ralenti (AI_TICK_INTERVAL, pas à chaque frame) :
// à chaque tick, chaque base/avant-poste rival fait progresser sa propre économie
// (aiRunEconomy), puis une passe militaire globale (aiRunMilitary) réagit à toute menace
// détectée près de n'importe laquelle de ses bases. Simplifications volontaires de prototype,
// à garder en tête : détection omnisciente (ignore le brouillard, voir findNearestEnemy dans
// 04-units.js), pas de vrai système de zones comme le joueur (juste "la ressource minable la
// plus proche de la base"), bâtiments rivaux construits instantanément dès que le terrain et
// les ressources le permettent (pas de chantier ni d'ouvrier assigné, contrairement au joueur).
let aiTickTimer = AI_TICK_INTERVAL;
function updateRivalAI(dt) {
  aiTickTimer -= dt;
  if (aiTickTimer > 0) return;
  aiTickTimer = AI_TICK_INTERVAL;

  const rivalBases = buildings.filter(b => b.owner === 'rival' && (b.type === 'base' || b.type === 'outpost'));
  if (rivalBases.length === 0) return; // toutes les bases rivales détruites : IA neutralisée, plus rien à décider

  for (const base of rivalBases) aiRunEconomy(base);
  aiRunMilitary(rivalBases);
}

// Fait progresser l'économie d'UNE base rivale : complète son effectif d'ouvriers, affecte les
// ouvriers inactifs à la ressource minable la plus proche, construit une caserne si elle n'en a
// pas encore, et forme des soldats de garnison depuis toute caserne à proximité tant que
// l'objectif (AI_SOLDIER_TARGET_PER_BASE) n'est pas atteint.
function aiRunEconomy(base) {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const nearbyWorkers = units.filter(u => u.owner === 'rival' && u.type === 'worker' && dist(u.x, u.y, cx, cy) < 40);

  if (nearbyWorkers.length < AI_WORKER_TARGET_PER_BASE && rivalResources.bois >= WORKER_COST_BOIS) {
    rivalResources.bois -= WORKER_COST_BOIS;
    enqueueProduction(base, ['train'], 'worker'); // toujours un seul emplacement côté IA (pas de recherche "production" pour le camp rival)
  }

  for (const u of nearbyWorkers) {
    if (u.order || u.mining || u.building || u.zone) continue; // déjà occupé, on ne le réaffecte pas
    const target = aiFindMinableNear(base, AI_ECONOMY_RADIUS);
    if (target) u.order = { kind: 'harvest', x: target.x, y: target.y };
  }

  const hasBarracks = buildings.some(b => b.owner === 'rival' && b.type === 'barracks' && dist(b.x, b.y, base.x, base.y) < AI_BUILDING_SEARCH_RADIUS);
  if (!hasBarracks) aiTryBuild(base, 'barracks');

  const nearbyBarracks = buildings.filter(b => b.owner === 'rival' && b.type === 'barracks' && dist(b.x, b.y, base.x, base.y) < AI_BUILDING_SEARCH_RADIUS);
  const nearbySoldierCount = units.filter(u => u.owner === 'rival' && u.type === 'soldier' && dist(u.x, u.y, cx, cy) < 40).length;
  if (nearbySoldierCount < AI_SOLDIER_TARGET_PER_BASE) {
    for (const bk of nearbyBarracks) {
      if (rivalResources.bois >= SOLDIER_COST_BOIS && rivalResources.minerai >= SOLDIER_COST_MINERAI) {
        rivalResources.bois -= SOLDIER_COST_BOIS; rivalResources.minerai -= SOLDIER_COST_MINERAI;
        enqueueProduction(bk, ['train'], 'soldier');
      }
    }
  }
}

// Case minable la plus proche du centre d'une base rivale, dans un rayon donné — équivalent
// (en beaucoup plus simple) de findNearestMinableInZone pour le joueur (04-units.js) : pas de
// vrai système de zones côté IA, juste "la ressource la plus proche DE LA BASE" pour que les
// ouvriers rivaux restent groupés près de leur territoire plutôt que de s'éparpiller.
function aiFindMinableNear(base, radius) {
  const cx = Math.floor(base.x + base.w / 2), cy = Math.floor(base.y + base.h / 2);
  let best = null, bestD = Infinity;
  for (let yy = cy - radius; yy <= cy + radius; yy++) {
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (!inBounds(xx, yy) || !isMinable(xx, yy)) continue;
      const d = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d < bestD) { bestD = d; best = { x: xx, y: yy }; }
    }
  }
  return best;
}

// Tente de construire `buildType` près d'une base rivale : vérifie le coût (pool rivalResources,
// voir 03-simulation.js), cherche un emplacement libre par anneaux concentriques croissants
// autour de la base, et matérialise le bâtiment DIRECTEMENT (placeBuilding) s'il en trouve un —
// pas de chantier progressif ni d'ouvrier assigné comme pour le joueur (issueBuildOrder, voir
// 06-training-build.js) : simplification volontaire, l'IA ne simule pas le temps de
// construction de ses propres structures. Renvoie true si la construction a eu lieu.
function aiTryBuild(base, buildType) {
  const spec = BUILD_TYPES[buildType];
  if (!spec) return false;
  for (const [res, amount] of Object.entries(spec.cost)) if (rivalResources[res] < amount) return false;
  for (let ring = 2; ring <= 14; ring++) {
    for (let tries = 0; tries < 6; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const tx = Math.round(base.x + base.w / 2 + Math.cos(angle) * ring) - Math.floor(spec.w / 2);
      const ty = Math.round(base.y + base.h / 2 + Math.sin(angle) * ring) - Math.floor(spec.h / 2);
      if (canPlaceFootprint(tx, ty, spec.w, spec.h)) {
        for (const [res, amount] of Object.entries(spec.cost)) rivalResources[res] -= amount;
        placeBuilding(buildType, tx, ty, spec.w, spec.h, spec.targetHp, 'rival');
        invalidateBuildingVision();
        return true;
      }
    }
  }
  return false; // aucun emplacement libre trouvé dans le rayon de recherche : retentera au prochain tick
}

// Passe militaire globale : pour chaque base rivale, cherche la menace (unité ou bâtiment
// ennemi) la plus proche dans un rayon de détection (AI_ATTACK_DETECTION_RADIUS) et, si elle en
// trouve une, envoie tout soldat rival disponible à proximité l'intercepter — c'est ce qui
// donne à l'IA le comportement "si elle trouve un ennemi, elle l'attaque" demandé, en plus de
// la riposte de garde individuelle que chaque soldat fait déjà tout seul de très près (voir la
// vigilance passive dans updateCombat, 04-units.js).
function aiRunMilitary(rivalBases) {
  for (const base of rivalBases) {
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    const threat = findNearestEnemy('rival', cx, cy, AI_ATTACK_DETECTION_RADIUS);
    if (!threat) continue;
    const tx = threat.isBuilding ? threat.target.x + threat.target.w / 2 : threat.target.x;
    const ty = threat.isBuilding ? threat.target.y + threat.target.h / 2 : threat.target.y;
    for (const u of units) {
      if (u.owner !== 'rival' || u.type !== 'soldier') continue;
      if (dist(u.x, u.y, cx, cy) > 40) continue; // ne dégarnit pas les bases lointaines pour une menace purement locale
      if (u.order && u.order.kind === 'attack') continue; // déjà engagé sur sa propre cible
      u.stance = 'idle';
      u.order = {
        kind: 'attack', x: Math.floor(tx), y: Math.floor(ty),
        targetUnitId: threat.isBuilding ? null : threat.target.id,
        targetBuildingId: threat.isBuilding ? threat.target.id : null,
      };
    }
  }
}

