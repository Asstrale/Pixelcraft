/* === 04-units.js — Unités : spawn, IA de déplacement/minage/construction === */
// ---------- Unités ----------
let units = [];
let nextUnitId = 1;
function spawnUnit(type, tx, ty) {
  const u = {
    id: nextUnitId++, type, owner: 'player',
    x: tx + 0.5, y: ty + 0.5,
    order: null, mining: false, mineTarget: null, mineTimer: 0, zone: null,
    building: false, buildSite: null, buildTimer: 0, buildQueue: [],
    inventory: { bois: 0, minerai: 0, pierre: 0 }, carryAmount: 0, resumeTarget: null, resumeOrder: null,
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
  let best = null, bestCost = Infinity;
  let bestPath = null;
  
  const consider = (xx, yy) => {
    if (fogEnabled && exploredTile[idx(xx, yy)]) return; 
    
    const curX = Math.floor(u.x), curY = Math.floor(u.y);
    const path = findPath(curX, curY, xx, yy, true);
    
    if (path) {
        let cost = 0;
        for (let i = 0; i < path.length; i++) {
            if (!isWalkable(path[i].x, path[i].y)) cost += 15; 
            cost += 1; 
        }
        
        // NOUVEAU : Si c'est un chemin partiel (n'atteignant pas xx,yy),
        // on ajoute une forte pénalité correspondant à la distance restante estimée à creuser.
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
        if (d * 16 < bestCost && bestCost === Infinity) { 
            best = { x: xx, y: yy };
        }
    }
  };

  if (zone.type === 'rect') {
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
  
  return { point: best, path: bestPath };
}

function zoneBreachPoint(u, zone) {
  const cached = zone.breachPoint;
  if (cached && (!fogEnabled || !exploredTile[idx(cached.x, cached.y)])) return { point: cached, path: null };
  const fresh = nearestPointInZone(u, zone);
  if (fresh.point) zone.breachPoint = fresh.point;
  return fresh;
}

function recordTunnelMine(u, o, x, y) {
  if (o.kind !== 'tunnel' && o.kind !== 'harvest') return;
  u.tunnelPath = u.tunnelPath || [];
  if (!u.tunnelPath.some(p => p.x === x && p.y === y)) u.tunnelPath.push({ x, y });
}

function shouldYieldMovement(u, tx, ty) {
  for (const other of units) {
    if (other === u || other.id >= u.id) continue;
    const ddx = other.x - (tx + 0.5), ddy = other.y - (ty + 0.5);
    if (ddx * ddx + ddy * ddy < 0.22) return true;
  }
  return false;
}

const YIELD_PATIENCE = 1.2;

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

function handleYield(u, tx, ty, dx, dy, dt) {
  if (!shouldYieldMovement(u, tx, ty)) { u.yieldTimer = 0; return false; }
  u.yieldTimer = (u.yieldTimer || 0) + dt;
  if (u.yieldTimer <= YIELD_PATIENCE) return true; 
  if (tryClearJam(u, dx, dy)) { u.yieldTimer = 0; return true; }
  u.yieldTimer = 0;
  return false; 
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
          u.tunnelPath = [];
        } else if (zoneHasUnexplored(u.zone)) {
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
                  
                  for (let i = 0; i < u.path.length; i++) {
                      let px = u.path[i].x, py = u.path[i].y;
                      if (!isWalkable(px, py) && isMinable(px, py)) {
                          recordTunnelMine(u, u.order, px, py);
                      }
                  }
              }
          } else {
              u.zone = null;
          }
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
        if (resType && u.carryAmount < CARRY_CAPACITY) {
          u.inventory[resType]++;
          u.carryAmount++;
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
      if (u.carryAmount > 0) {
        for (const [resType, amount] of Object.entries(u.inventory)) {
          if (amount > 0) {
            let yieldMult = 1;
            if (resType === 'bois') yieldMult = WOOD_YIELD;
            else if (resType === 'minerai') yieldMult = MINERAL_YIELD;
            else if (resType === 'pierre') yieldMult = STONE_YIELD;
            resources[resType] += amount * yieldMult;
            u.inventory[resType] = 0;
          }
        }
      }
      u.carryAmount = 0;
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

  const canMineThrough = (o.kind === 'harvest' || o.kind === 'tunnel') && u.minePower > 0;

  let dx = Math.sign(o.x - curX), dy = Math.sign(o.y - curY);
  if (dx === 0 && dy === 0) { u.order = null; return; }

  u.pathCooldown = (u.pathCooldown || 0) - dt;
  if (!u.path || u.pathTargetX !== o.x || u.pathTargetY !== o.y) {
    if (u.pathTargetX !== o.x || u.pathTargetY !== o.y || u.pathCooldown <= 0) {
      u.path = findPath(curX, curY, o.x, o.y, canMineThrough);
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
      if (!isWalkable(next.x, next.y) && isMinable(next.x, next.y) && canMineThrough) {
        if (Math.max(Math.abs(curX - next.x), Math.abs(curY - next.y)) <= 1) {
            u.mining = true; u.mineTarget = { x: next.x, y: next.y }; u.mineTimer = 0;
            recordTunnelMine(u, o, next.x, next.y);
            return;
        }
      }

      if (isWalkable(next.x, next.y)) {
        const stepDx = Math.sign(next.x - curX), stepDy = Math.sign(next.y - curY);
        if (handleYield(u, next.x, next.y, stepDx, stepDy, dt)) return;
        stepUnitTo(u, next.x, next.y, dt);
        return;
      } else {
        u.path = null;
      }
    }
  }

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

  if (o.kind === 'harvest') blacklistTile(u, o.x, o.y, 15);
  u.order = null;
  u.path = null;
}