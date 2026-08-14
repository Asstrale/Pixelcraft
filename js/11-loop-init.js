/* === 11-loop-init.js — Boucle principale (loop) + initialisation du jeu (init) (original: lignes 1915-1954) === */
// Boucle requestAnimationFrame classique : calcule dt en secondes (borné à 0.05s = 20 fps mini,
// pour éviter un "saut" énorme de simulation après un onglet mis en veille), met à jour puis
// dessine. Le try/catch empêche qu'une exception dans update()/draw() ne tue silencieusement
// toute la boucle de jeu (elle continue à tourner frame après frame malgré l'erreur affichée
// en console) — utile en développement, quand du code est modifié à chaud.
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  try {
    update(dt);
    draw(now / 1000);
  } catch (err) {
    console.error('Erreur dans la boucle de jeu :', err);
  }
  requestAnimationFrame(loop);
}

// ---------- Initialisation ----------
// Point d'entrée du jeu : génère la carte, fait apparaître 3 ouvriers de départ autour de la
// base du joueur (à 3 cases de son bord), centre la caméra dessus, calcule la vision/minicarte
// initiales, puis démarre la boucle de jeu.
function init() {
  generateMap();

  const outside = Math.floor(BASE_SIZE / 2) + 3;
  const spots = [
    { x: spawnCX - outside, y: spawnCY },
    { x: spawnCX + outside, y: spawnCY },
    { x: spawnCX, y: spawnCY - outside }
  ];
  for (const s of spots) {
    if (isWalkable(s.x, s.y)) spawnUnit('worker', s.x, s.y);
    else {
      // Position théorique bloquée (roche/mur) : repli sur la première case libre trouvée
      // autour de la base plutôt que de faire apparaître l'ouvrier dans un mur.
      const fallback = findFreeAdjacent(baseBuilding);
      spawnUnit('worker', fallback ? fallback.x : spawnCX, fallback ? fallback.y : spawnCY - outside);
    }
  }

  // Même chose pour chaque base rivale (voir updateRivalAI dans 09-update.js) : sans ces
  // ouvriers de départ, l'IA n'aurait jamais rien pour démarrer sa propre économie. Mêmes 3
  // positions relatives que pour le joueur (pas d'appels répétés à findFreeAdjacent seul, qui
  // renverrait la même case à chaque fois et ferait apparaître les 3 ouvriers empilés).
  for (const sp of spawnPoints) {
    if (sp.owner === 'player') continue;
    const rivalSpots = [
      { x: sp.x - outside, y: sp.y },
      { x: sp.x + outside, y: sp.y },
      { x: sp.x, y: sp.y - outside },
    ];
    for (const s of rivalSpots) {
      if (isWalkable(s.x, s.y)) spawnUnit('worker', s.x, s.y, 'rival');
      else {
        const fallback = findFreeAdjacent(sp.base);
        if (fallback) spawnUnit('worker', fallback.x, fallback.y, 'rival');
      }
    }
  }

  selectedBuilding = baseBuilding;
  centerOnBase();
  updateVision();
  rebuildOverview();
  updateBuildUI();
  updateHUD();
  requestAnimationFrame(loop);
}

init();
