/* === 11-loop-init.js — Boucle principale (loop) + initialisation du jeu (init) (original: lignes 1915-1954) === */
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
      const fallback = findFreeAdjacent(baseBuilding);
      spawnUnit('worker', fallback ? fallback.x : spawnCX, fallback ? fallback.y : spawnCY - outside);
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
