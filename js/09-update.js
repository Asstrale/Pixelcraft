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
  updateBuildingCombat(dt); // tourelles : ripostent seules, sans passer par updateUnit (ce ne sont pas des unités, voir 04-units.js)
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

  // Ordre des passes, chacune SUR TOUTES LES BASES avant de passer à la suivante — c'est ce qui
  // corrige le bug "aucune caserne, aucune troupe" : rivalResources est un pool COMMUN aux 3
  // bases rivales (voir 03-simulation.js), et l'ancienne version traitait chaque base
  // entièrement (ouvriers PUIS caserne PUIS soldats) avant de passer à la suivante — la première
  // base de la liste épuisait alors la totalité du bois disponible dans sa propre quête
  // d'ouvriers (AI_WORKER_TARGET_PER_BASE) avant même que les deux autres n'aient pu tenter quoi
  // que ce soit. Ici, l'infrastructure (caserne, indispensable à tout le reste) est prioritaire
  // pour TOUTES les bases avant qu'aucune ne commence à dépenser en ouvriers supplémentaires.
  for (const base of rivalBases) aiTryBuildInfrastructure(base);
  for (const base of rivalBases) aiTopUpWorkers(base);
  for (const base of rivalBases) aiAssignIdleWorkers(base);
  for (const base of rivalBases) aiTrainGarrison(base);

  aiUpdateScouts(rivalBases);
  aiRunMilitary(rivalBases);
}

// Construit l'infrastructure d'UNE base rivale, par ordre de priorité : une caserne si elle n'en
// a pas encore (condition absolue à tout le reste — pas de garnison possible sans elle), sinon
// une tourelle défensive si elle n'a pas encore atteint son quota (AI_TURRETS_TARGET_PER_BASE).
function aiTryBuildInfrastructure(base) {
  const hasBarracks = buildings.some(b => b.owner === 'rival' && b.type === 'barracks' && dist(b.x, b.y, base.x, base.y) < AI_BUILDING_SEARCH_RADIUS);
  if (!hasBarracks) { aiTryBuild(base, 'barracks'); return; }
  const nearbyTurrets = buildings.filter(b => b.owner === 'rival' && b.type === 'turret' && dist(b.x, b.y, base.x, base.y) < AI_BUILDING_SEARCH_RADIUS).length;
  if (nearbyTurrets < AI_TURRETS_TARGET_PER_BASE) aiTryBuild(base, 'turret');
}

// Complète l'effectif d'ouvriers d'UNE base rivale jusqu'à AI_WORKER_TARGET_PER_BASE.
function aiTopUpWorkers(base) {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const nearbyWorkers = units.filter(u => u.owner === 'rival' && u.type === 'worker' && dist(u.x, u.y, cx, cy) < 40).length;
  if (nearbyWorkers < AI_WORKER_TARGET_PER_BASE && rivalResources.bois >= WORKER_COST_BOIS) {
    rivalResources.bois -= WORKER_COST_BOIS;
    enqueueProduction(base, ['train'], 'worker'); // toujours un seul emplacement côté IA (pas de recherche "production" pour le camp rival)
  }
}

// Affecte les ouvriers inactifs d'UNE base rivale à la ressource minable la plus proche — ignore
// les éclaireurs en mission (u.aiScout, voir aiUpdateScouts) : un ouvrier envoyé explorer ne doit
// pas être aussitôt réaffecté au minage dès qu'il perd son ordre de déplacement en route.
function aiAssignIdleWorkers(base) {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const nearbyWorkers = units.filter(u => u.owner === 'rival' && u.type === 'worker' && dist(u.x, u.y, cx, cy) < 40);
  for (const u of nearbyWorkers) {
    if (u.order || u.mining || u.building || u.zone || u.aiScout) continue; // déjà occupé, on ne le réaffecte pas
    const target = aiFindMinableNear(base, AI_ECONOMY_RADIUS);
    if (target) u.order = { kind: 'harvest', x: target.x, y: target.y };
  }
}

// Bag de tirage pour la composition de la garnison rivale : majoritairement des soldats, avec
// un mélange d'archers/grenadiers/canonniers pour que l'IA ait aussi accès aux unités à
// distance/de siège plutôt que de spammer un seul type.
const AI_GARRISON_MIX = ['soldier', 'soldier', 'archer', 'grenadier', 'soldier', 'cannoneer'];
// Forme des combattants (toute unité de COMBAT_UNIT_TYPES, pas seulement des soldats) depuis
// toute caserne proche d'UNE base rivale, tant que l'objectif de garnison n'est pas atteint.
function aiTrainGarrison(base) {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const nearbyBarracks = buildings.filter(b => b.owner === 'rival' && b.type === 'barracks' && dist(b.x, b.y, base.x, base.y) < AI_BUILDING_SEARCH_RADIUS);
  if (nearbyBarracks.length === 0) return;
  const nearbyCombatCount = units.filter(u => u.owner === 'rival' && COMBAT_UNIT_TYPES.includes(u.type) && dist(u.x, u.y, cx, cy) < 40).length;
  if (nearbyCombatCount >= AI_SOLDIER_TARGET_PER_BASE) return;
  for (const bk of nearbyBarracks) {
    const pick = AI_GARRISON_MIX[Math.floor(Math.random() * AI_GARRISON_MIX.length)];
    const spec = UNIT_TRAIN_TYPES[pick];
    const affordable = Object.entries(spec.cost).every(([res, amount]) => rivalResources[res] >= amount);
    if (affordable) {
      for (const [res, amount] of Object.entries(spec.cost)) rivalResources[res] -= amount;
      enqueueProduction(bk, ['train'], pick);
    }
  }
}

// Case minable la plus proche du centre d'une base rivale, dans un rayon donné — équivalent
// (en beaucoup plus simple) de findNearestMinableInZone pour le joueur (04-units.js) : pas de
// vrai système de zones côté IA, juste "la ressource la plus proche DE LA BASE" pour que les
// ouvriers rivaux restent groupés près de leur territoire plutôt que de s'éparpiller.
function aiFindMinableNear(base, radius) {
  const cx = Math.floor(base.x + base.w / 2), cy = Math.floor(base.y + base.h / 2);
  // Préfère nettement le bois/minerai à la simple pierre : T_STONE est la roche de fond qui
  // recouvre la majorité de la carte (voir generateMap, 02-worldgen.js) — elle forme un anneau
  // quasi continu tout autour de chaque base et sera donc TOUJOURS plus proche que la moindre
  // poche de ressource réelle. Sans cette préférence, "la case minable la plus proche" revenait
  // systématiquement à grignoter cet anneau de pierre indéfiniment sans jamais atteindre une
  // poche de bois/minerai un peu plus loin : c'était la VRAIE cause du bug "l'IA rivale ne
  // construit/ne forme plus rien" (confirmé via un harness de diagnostic jsdom) — l'économie
  // rivale se fossilisait sur la seule pierre après sa dépense de départ, plus aucun bois ni
  // minerai ne rentrant jamais, ce qui affamait indéfiniment toute formation d'ouvriers/soldats
  // et toute construction ultérieure (barracks/tourelle exceptées, déjà payées au tout départ).
  let bestPriority = null, bestPriorityD = Infinity;
  let bestStone = null, bestStoneD = Infinity;
  for (let yy = cy - radius; yy <= cy + radius; yy++) {
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (!inBounds(xx, yy) || !isMinable(xx, yy)) continue;
      const t = grid[idx(xx, yy)];
      const d = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (t === T_WOOD || t === T_MINERAL) {
        if (d < bestPriorityD) { bestPriorityD = d; bestPriority = { x: xx, y: yy }; }
      } else if (d < bestStoneD) { bestStoneD = d; bestStone = { x: xx, y: yy }; }
    }
  }
  // Repli sur la pierre UNIQUEMENT si vraiment aucun bois/minerai n'est trouvé dans le rayon —
  // mieux vaut miner de la pierre (utile pour murs/tourelles) que laisser l'ouvrier inactif.
  return bestPriority || bestStone;
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

// Repérage actif ("fourmis" éclaireuses) : remplace l'ancienne détection omnisciente par un vrai
// modèle d'exploration — voir rivalKnownEnemies (03-simulation.js) et le commentaire d'ensemble
// sur AI_SCOUT_VISION/AI_SCOUTS_PER_BASE/AI_MEMORY_DURATION dans 01-constants.js.
//
// 1) Toute unité rivale (pas seulement un éclaireur dédié) qui a un ennemi dans son PROPRE champ
//    de vision (AI_SCOUT_VISION) met à jour la mémoire collective — un soldat de garnison qui
//    croise un ennemi "prévient" la colonie tout autant qu'un éclaireur.
// 2) Désigne/renouvelle jusqu'à AI_SCOUTS_PER_BASE ouvriers par base comme éclaireurs
//    (u.aiScout), envoyés vers un point aléatoire de plus en plus loin de leur base via un
//    simple ordre 'move' (le pathfinding normal du jeu, pas un système dédié) — une fois arrivés
//    (ou bloqués), ils sont libérés et retournent au travail normal (voir aiAssignIdleWorkers).
// 3) Oublie les sightings trop anciens (AI_MEMORY_DURATION) : une position qui a pu changer
//    depuis ne doit pas guider une attaque indéfiniment.
function aiUpdateScouts(rivalBases) {
  for (const u of units) {
    if (u.owner !== 'rival') continue;
    const found = findNearestEnemy('rival', u.x, u.y, AI_SCOUT_VISION);
    if (found) aiRememberEnemy(found);
  }

  for (const base of rivalBases) {
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    const nearbyWorkers = units.filter(u => u.owner === 'rival' && u.type === 'worker' && dist(u.x, u.y, cx, cy) < 50);
    for (const u of nearbyWorkers) {
      if (u.aiScout && !u.order) u.aiScout = false; // arrivé (ou bloqué) : libéré, reprendra le travail normal via aiAssignIdleWorkers
    }
    const stillActive = nearbyWorkers.filter(u => u.aiScout).length;
    if (stillActive >= AI_SCOUTS_PER_BASE) continue;
    const idle = nearbyWorkers.filter(u => !u.aiScout && !u.order && !u.mining && !u.building && !u.zone);
    for (let i = stillActive; i < AI_SCOUTS_PER_BASE && idle.length > 0; i++) {
      const u = idle.pop();
      const angle = Math.random() * Math.PI * 2;
      const radius = 20 + Math.random() * 60;
      const tx = clamp(Math.round(cx + Math.cos(angle) * radius), 0, MAP_W - 1);
      const ty = clamp(Math.round(cy + Math.sin(angle) * radius), 0, MAP_H - 1);
      u.aiScout = true;
      u.order = { kind: 'move', x: tx, y: ty };
    }
  }

  rivalKnownEnemies = rivalKnownEnemies.filter(e => gameTime - e.t < AI_MEMORY_DURATION);
}

// Mémorise/rafraîchit la position d'un ennemi repéré (voir aiUpdateScouts) — une entrée par
// (id, isBuilding) : revoir le même ennemi met juste à jour sa position et son horodatage plutôt
// que d'empiler des doublons.
function aiRememberEnemy(found) {
  const isBuilding = found.isBuilding;
  const id = found.target.id;
  const x = isBuilding ? found.target.x + found.target.w / 2 : found.target.x;
  const y = isBuilding ? found.target.y + found.target.h / 2 : found.target.y;
  const existing = rivalKnownEnemies.find(e => e.isBuilding === isBuilding && e.id === id);
  if (existing) { existing.x = x; existing.y = y; existing.t = gameTime; }
  else rivalKnownEnemies.push({ id, isBuilding, x, y, t: gameTime });
}

// Passe militaire globale : pour chaque base rivale, réagit d'abord à toute menace IMMÉDIATE
// tout près d'elle (AI_DEFENSE_RADIUS, comportement de "garde" — pas besoin d'un éclaireur pour
// voir un ennemi arriver à sa porte), sinon se fie à la mémoire collective de reconnaissance
// (rivalKnownEnemies, voir aiUpdateScouts) pour envoyer ses troupes vers la dernière position
// ennemie connue — "si elles tombent sur une colonie ennemie, elles envoient les troupes". Les
// combattants envoyés reçoivent un ordre 'defend' (pas 'attack') ancré sur LEUR PROPRE base : ils
// engagent tout ennemi croisé en chemin (voir updateCombat, 04-units.js) puis reviennent
// automatiquement garnisonner leur base une fois la zone dégagée, plutôt que de rester plantés
// sur la cible ou de continuer à s'éparpiller.
function aiRunMilitary(rivalBases) {
  for (const base of rivalBases) {
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    const closeThreat = findNearestEnemy('rival', cx, cy, AI_DEFENSE_RADIUS);
    let tx, ty, targetUnitId = null, targetBuildingId = null;

    if (closeThreat) {
      tx = closeThreat.isBuilding ? closeThreat.target.x + closeThreat.target.w / 2 : closeThreat.target.x;
      ty = closeThreat.isBuilding ? closeThreat.target.y + closeThreat.target.h / 2 : closeThreat.target.y;
      targetUnitId = closeThreat.isBuilding ? null : closeThreat.target.id;
      targetBuildingId = closeThreat.isBuilding ? closeThreat.target.id : null;
    } else {
      let best = null, bestD = Infinity;
      for (const e of rivalKnownEnemies) {
        const d = dist(cx, cy, e.x, e.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best || bestD > AI_ATTACK_DETECTION_RADIUS * 3) continue; // rien de connu d'assez proche pour justifier de dégarnir la base
      tx = best.x; ty = best.y;
      targetUnitId = best.isBuilding ? null : best.id;
      targetBuildingId = best.isBuilding ? best.id : null;
    }

    for (const u of units) {
      if (u.owner !== 'rival' || !COMBAT_UNIT_TYPES.includes(u.type)) continue;
      if (u.aiScout) continue; // un éclaireur en mission d'exploration n'est jamais réquisitionné pour attaquer
      if (dist(u.x, u.y, cx, cy) > 40) continue; // ne dégarnit pas les bases lointaines pour une menace purement locale
      if (u.order && u.order.kind === 'defend') continue; // déjà engagé sur sa propre riposte
      u.stance = 'idle';
      u.order = {
        kind: 'defend', x: Math.floor(tx), y: Math.floor(ty),
        targetUnitId, targetBuildingId, returnX: cx, returnY: cy, phase: 'out',
      };
    }
  }
}

