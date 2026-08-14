/* === 07-camera-input.js — Caméra + gestion des entrées souris/clavier (original: lignes 1234-1387) === */
// ---------- Caméra ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let camera = { x: 0, y: 0 };
let zoom = 0.9;
const keys = new Set();

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

function screenToWorld(sx, sy) { return { x: camera.x + sx / zoom, y: camera.y + sy / zoom }; }
function worldToTile(wp) { return { x: Math.floor(wp.x / TILE), y: Math.floor(wp.y / TILE) }; }
function clampCamera() {
  const maxX = Math.max(0, MAP_W * TILE - canvas.width / zoom);
  const maxY = Math.max(0, MAP_H * TILE - canvas.height / zoom);
  camera.x = clamp(camera.x, 0, maxX);
  camera.y = clamp(camera.y, 0, maxY);
}
function centerOnBase() {
  camera.x = baseBuilding.x * TILE + baseBuilding.w * TILE / 2 - canvas.width / (2 * zoom);
  camera.y = baseBuilding.y * TILE + baseBuilding.h * TILE / 2 - canvas.height / (2 * zoom);
  clampCamera();
}

// ---------- Entrées ----------
canvas.addEventListener('contextmenu', e => e.preventDefault());

let mouseDown = null;
let dragStart = null, dragCurrent = null, isDragging = false;
let lastMouseScreen = { x: 0, y: 0 };

canvas.addEventListener('mousedown', e => {
  if (e.button === 0) {
    if (brushMode) {
      isBrushing = true;
      brushedTiles.clear();
      addBrushTile(e.offsetX, e.offsetY);
      return;
    }
    if (buildMode) {
      const wp = screenToWorld(e.offsetX, e.offsetY);
      const t = worldToTile(wp);
      issueBuildOrder(buildMode, t.x, t.y);
      return;
    }
    mouseDown = 0;
    dragStart = { x: e.offsetX, y: e.offsetY };
    dragCurrent = { x: e.offsetX, y: e.offsetY };
    isDragging = false;
  } else if (e.button === 2) {
    if (buildMode || zoneMode || brushMode) { cancelBuildOrZoneMode(); return; }
    if (mineTool) { issueTunnelOrderAtScreen(e.offsetX, e.offsetY); return; }
    issueOrderAtScreen(e.offsetX, e.offsetY);
  }
});

canvas.addEventListener('mousemove', e => {
  lastMouseScreen = { x: e.offsetX, y: e.offsetY };
  if (isBrushing) {
    addBrushTile(e.offsetX, e.offsetY);
  } else if (mouseDown === 0 && dragStart) {
    dragCurrent = { x: e.offsetX, y: e.offsetY };
    if (Math.hypot(dragCurrent.x - dragStart.x, dragCurrent.y - dragStart.y) > 6) isDragging = true;
    updateSelBox();
  }
});

window.addEventListener('mouseup', e => {
  if (e.button === 0) {
    if (isBrushing) {
      isBrushing = false;
      if (brushedTiles.size > 0) assignBrushZone(zoneUnitIds, brushedTiles);
      brushMode = false;
      updateBuildUI();
      return;
    }
    if (mouseDown === 0) {
      if (zoneMode) {
        finalizeZoneDrag(dragStart, dragCurrent);
        zoneMode = false; updateBuildUI();
      } else if (isDragging) {
        selectUnitsInBox(dragStart, dragCurrent, e.shiftKey);
      } else {
        selectAtPoint(dragStart.x, dragStart.y, e.shiftKey);
      }
      mouseDown = null; isDragging = false; dragStart = null; dragCurrent = null;
      document.getElementById('selbox').style.display = 'none';
    }
  } else if (e.button === 2) {
    // rien de spécial ici : l'ordre (déplacement ou tunnel) a déjà été donné au mousedown
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const before = screenToWorld(e.offsetX, e.offsetY);
  zoom = clamp(zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.16, 2.5);
  const after = screenToWorld(e.offsetX, e.offsetY);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  clampCamera();
}, { passive: false });

window.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key === 'tab') e.preventDefault();
  keys.add(key);
  if (key === 'escape') {
    if (buildMode || zoneMode || brushMode || mineTool) cancelBuildOrZoneMode();
    else toggleEscMenu();
  }

  const hasWorker = Array.from(selectedIds).some(id => {
    const u = units.find(un => un.id === id);
    return u && u.type === 'worker';
  });

  if (hasWorker) {
    if (key === 'tab') { activeTab = activeTab === 'miner' ? 'construire' : 'miner'; lastActionsTab = null; updateHUD(); }
    else if (activeTab === 'miner') {
      if (key === '1' || key === '&') startMineTool();
      if (key === '2' || key === 'é') startZoneMode();
      if (key === '3' || key === '"') startBrushMode();
    } else {
      if (key === '1' || key === '&') startBuildMode('wall');
      if (key === '2' || key === 'é') startBuildMode('barracks');
      if (key === '3' || key === '"') startBuildMode('pillar');
    }
  } 
  else if (selectedBuilding) {
    if (key === '1' || key === '&') {
      if (selectedBuilding.type === 'base') trainWorker();
      if (selectedBuilding.type === 'barracks') trainSoldier();
    }
  }

  if (key === 'delete') {
    if (selectedBuilding && selectedBuilding.type !== 'base') destroySelectedBuilding();
    else if (selectedWall) destroySelectedWall();
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

document.getElementById('brush-slider').addEventListener('input', e => {
  document.getElementById('brush-val').textContent = e.target.value;
});

function updateSelBox() {
  const el = document.getElementById('selbox');
  if (!dragStart || !dragCurrent) return;
  const x = Math.min(dragStart.x, dragCurrent.x), y = Math.min(dragStart.y, dragCurrent.y);
  const w = Math.abs(dragCurrent.x - dragStart.x), h = Math.abs(dragCurrent.y - dragStart.y);
  el.style.display = 'block';
  el.classList.toggle('zone-mode', zoneMode);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}

