/* === 09-update.js — Boucle de mise à jour (update) : simulation par frame (original: lignes 1642-1693) === */
// ---------- Boucle de jeu ----------
let lastT = performance.now();
let fpsAcc = 0, fpsCount = 0;
let overviewTimer = 0;
let gameTime = 0;

function update(dt) {
  gameTime += dt;
  const PAN = 520;
  if (keys.has('w') || keys.has('arrowup')) camera.y -= PAN * dt / zoom;
  if (keys.has('s') || keys.has('arrowdown')) camera.y += PAN * dt / zoom;
  if (keys.has('a') || keys.has('arrowleft')) camera.x -= PAN * dt / zoom;
  if (keys.has('d') || keys.has('arrowright')) camera.x += PAN * dt / zoom;
  clampCamera();

  // Répulsion mutuelle : plus ferme qu'avant (les unités se marchaient encore visiblement
  // dessus dans les zones ouvertes) et gère le cas de deux unités parfaitement superposées
  // (ex. spawn au même endroit) en les écartant dans une direction aléatoire plutôt que de ne
  // rien faire (l'ancien calcul, basé sur dx/dist, ne pouvait pas gérer une distance nulle).
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
  updateVision();

  zones = zones.filter(z => units.some(u => u.zone === z));

  for (let i = pings.length - 1; i >= 0; i--) { pings[i].t += dt; if (pings[i].t > 0.45) pings.splice(i, 1); }
  for (let i = explosions.length - 1; i >= 0; i--) { explosions[i].t += dt; if (explosions[i].t > 0.9) explosions.splice(i, 1); }

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) document.getElementById('toast').textContent = ''; }

  overviewTimer += dt;
  if (overviewTimer > 1) { overviewTimer = 0; rebuildOverview(); }

  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) { document.getElementById('fps').textContent = Math.round(fpsCount / fpsAcc) + ' fps'; fpsAcc = 0; fpsCount = 0; }

  updateHUD();
}

