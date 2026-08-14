/* === 03-simulation.js — Palette de rendu, ressources joueur, déplacement/minage, pathfinding A*, explosions de gaz, chantiers de construction (original: lignes 419-573) === */
// ---------- Palette de rendu ----------
const stoneShades = [];
for (let s = 0; s < 14; s++) {
  const v = 38 + s * 1.6;
  stoneShades.push(`rgb(${Math.round(v)},${Math.round(v + 3)},${Math.round(v + 7)})`);
}
const COLOR_WOOD_HI = [166, 122, 60], COLOR_WOOD_LO = [70, 50, 26];
const COLOR_MIN_HI = [92, 168, 232], COLOR_MIN_LO = [34, 60, 92];
function lerpColor(a, b, t) {
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
}

// ---------- Ressources du joueur ----------
const resources = { bois: 100, minerai: 100, pierre: 100 };

// ---------- Déplacement / minage ----------
function isWalkable(x, y) {
  if (!inBounds(x, y)) return false;
  if (buildingGrid[idx(x, y)] !== -1) return false;
  return grid[idx(x, y)] === T_EMPTY;
}
function isMinable(x, y) {
  if (!inBounds(x, y)) return false;
  const t = grid[idx(x, y)];
  return t === T_STONE || t === T_WOOD || t === T_MINERAL || t === T_GAS;
}
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

// ---------- Pathfinding (A*) avec gestion des diagonales ----------
function findPath(startX, startY, targetX, targetY) {
  const maxNodes = 600; 
  let open = [{ x: startX, y: startY, g: 0, f: dist(startX, startY, targetX, targetY), parent: null }];
  let closed = new Set();
  
  while (open.length > 0 && closed.size < maxNodes) {
    open.sort((a, b) => a.f - b.f);
    let curr = open.shift();
    let key = curr.x + ',' + curr.y;
    
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

      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        if (!isWalkable(curr.x + dx, curr.y) || !isWalkable(curr.x, curr.y + dy)) continue;
      }

      if (!isWalkable(nx, ny) && !(nx === targetX && ny === targetY)) continue;
      if (closed.has(nx + ',' + ny)) continue;
      
      let g = curr.g + Math.hypot(dx, dy);
      let h = dist(nx, ny, targetX, targetY);
      let existing = open.find(n => n.x === nx && n.y === ny);
      
      if (!existing) open.push({ x: nx, y: ny, g, f: g + h, parent: curr });
      else if (g < existing.g) { existing.g = g; existing.f = g + h; existing.parent = curr; }
    }
  }
  return null;
}

// ---------- Explosions de gaz ----------
let explosions = [];
const GAS_LEAK_BUDGET = 85; 
const GAS_STONE_BREAK_CHANCE = 0.45;

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
    if (t === T_GAS && !(cell.x === mx && cell.y === my)) triggerExplosion(cell.x, cell.y);
    if (cell.power <= 0) continue;

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    dirs.sort((a, b) => {
      const da = (a[0] - cell.dx) * (a[0] - cell.dx) + (a[1] - cell.dy) * (a[1] - cell.dy);
      const db = (b[0] - cell.dx) * (b[0] - cell.dx) + (b[1] - cell.dy) * (b[1] - cell.dy);
      return (da - db) + (Math.random() - 0.5) * 3;
    });
    const maxBranches = Math.random() < 0.82 ? 1 : 2;
    let pushed = 0;
    for (const [dx, dy] of dirs) {
      if (pushed >= maxBranches) break;
      const nx = cell.x + dx, ny = cell.y + dy;
      if (!inBounds(nx, ny)) continue;
      const key = nx + ',' + ny;
      if (visited.has(key)) continue;
      const nt = grid[idx(nx, ny)];
      if (nt === T_WALL) continue; 
      let nextPower = cell.power - 1;
      if (nt === T_STONE) {
        if (Math.random() > GAS_STONE_BREAK_CHANCE) continue;
        nextPower -= 4;
      }
      if (nextPower < 0) continue;
      visited.add(key);
      frontier.push({ x: nx, y: ny, power: nextPower, dx, dy });
      pushed++;
    }
  }

  explosions.push({ x: mx * TILE + TILE / 2, y: my * TILE + TILE / 2, t: 0 });

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
let sites = [];
let nextSiteId = 1;
const BUILD_POWER = 8;
const WALL_BUILD_HP = 20, BARRACKS_BUILD_HP = 90, PILLAR_BUILD_HP = 30;
const PILLAR_COST_PIERRE = 15, PILLAR_COST_BOIS = 10;
// La tour de vision a une portée quasi infinie : seuls les obstacles l'arrêtent (voir
// revealLOS / computeLOSVisibleTiles dans 05-fog-overview.js), pas une distance fixe.
const PILLAR_VISION = VISION_MAX_RANGE;

function siteAt(tx, ty) {
  for (const s of sites) if (tx >= s.x && tx < s.x + s.w && ty >= s.y && ty < s.y + s.h) return s;
  return null;
}
function completeSite(site) {
  if (site.type === 'wall') setTile(site.x, site.y, T_WALL);
  else if (site.type === 'barracks') placeBuilding('barracks', site.x, site.y, site.w, site.h, 80, 'player');
  else if (site.type === 'pillar') placeBuilding('pillar', site.x, site.y, site.w, site.h, 40, 'player');
  sites = sites.filter(s => s !== site);
  // Un nouveau mur/bâtiment peut ouvrir ou boucher une ligne de vue : on force un recalcul
  // de la vision (mise en cache) des bâtiments au prochain frame plutôt que d'attendre
  // jusqu'à une seconde.
  invalidateBuildingVision();
}
