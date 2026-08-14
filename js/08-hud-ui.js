/* === 08-hud-ui.js — Boutons UI, icônes pixel-art, panneau de commande (command card), HUD (original: lignes 1388-1640) === */
// ---------- Boutons UI ----------
document.getElementById('btn-fog').addEventListener('click', () => setFogEnabled(!fogEnabled));

let uiScale = 1.8;
function applyUiScale() {
  document.documentElement.style.setProperty('--ui-scale', uiScale.toFixed(2));
}
applyUiScale();

let escMenuOpen = false;
function toggleEscMenu() {
  escMenuOpen = !escMenuOpen;
  document.getElementById('escmenu').classList.toggle('hidden', !escMenuOpen);
}
document.getElementById('btn-menu').addEventListener('click', toggleEscMenu);
document.getElementById('btn-escmenu-close').addEventListener('click', toggleEscMenu);
document.getElementById('escmenu').addEventListener('click', (e) => {
  if (e.target.id === 'escmenu') toggleEscMenu(); 
});

document.getElementById('slider-ui-scale').addEventListener('input', (e) => {
  uiScale = parseFloat(e.target.value);
  applyUiScale();
  document.getElementById('slider-ui-scale-val').textContent = uiScale.toFixed(2) + 'x';
});

function setFogEnabled(v) {
  fogEnabled = v;
  const btn = document.getElementById('btn-fog');
  btn.textContent = 'Brouillard : ' + (fogEnabled ? 'ON' : 'OFF');
  btn.classList.toggle('off', !fogEnabled);
  document.getElementById('chk-fog').checked = fogEnabled;
  rebuildOverview();
}
document.getElementById('chk-fog').addEventListener('change', (e) => setFogEnabled(e.target.checked));

function startBuildMode(type) {
  if (selectedIds.size === 0) return;
  const ids = [];
  for (const u of units) if (selectedIds.has(u.id) && u.type === 'worker') ids.push(u.id);
  if (ids.length === 0) { showToast('Sélectionnez des ouvriers'); return; }
  buildUnitIds = ids;
  buildMode = buildMode === type ? null : type;
  zoneMode = false;
  brushMode = false;
  mineTool = false;
  updateBuildUI();
}

document.getElementById('commandcard').addEventListener('click', (e) => {
  const id = e.target && e.target.id;
  if (id === 'btn-train-worker') trainWorker();
  else if (id === 'btn-train-soldier') trainSoldier();
  else if (id === 'btn-destroy-building') destroySelectedBuilding();
  else if (id === 'btn-destroy-wall') destroySelectedWall();
  else if (id === 'btn-zone') startZoneMode();
  else if (id === 'btn-brush') startBrushMode();
  else if (id === 'btn-mine-tool') startMineTool();
  else if (id === 'btn-build-wall') startBuildMode('wall');
  else if (id === 'btn-build-barracks') startBuildMode('barracks');
  else if (id === 'btn-build-pillar') startBuildMode('pillar');
  else if (id === 'tab-miner') { activeTab = 'miner'; lastActionsTab = null; updateHUD(); }
  else if (id === 'tab-construire') { activeTab = 'construire'; lastActionsTab = null; updateHUD(); }
  else {
    const portrait = e.target.closest && e.target.closest('.unit-portrait');
    if (portrait && portrait.dataset.uid) {
      const uid = Number(portrait.dataset.uid);
      selectedIds.clear(); selectedIds.add(uid); selectedBuilding = null; selectedWall = null;
      updateHUD();
    }
  }
});

function updateBuildUI() {
  const zBtn = document.getElementById('btn-zone');
  if (zBtn) zBtn.classList.toggle('active', zoneMode);
  
  const brBtn = document.getElementById('btn-brush');
  if (brBtn) brBtn.classList.toggle('active', brushMode);
  
  const wBtn = document.getElementById('btn-build-wall');
  if (wBtn) wBtn.classList.toggle('active', buildMode === 'wall');
  
  const bBtn = document.getElementById('btn-build-barracks');
  if (bBtn) bBtn.classList.toggle('active', buildMode === 'barracks');
  
  const brushTools = document.getElementById('brush-tools');
  if (brushTools) brushTools.classList.toggle('hidden', !brushMode);
  
  canvas.style.cursor = (zoneMode || brushMode || mineTool) ? 'cell' : (buildMode ? 'copy' : 'crosshair');
}

let panelKey = null;
let activeTab = 'miner';
let lastActionsTab = null;

function pxIcon(rows, colorMap, size) {
  size = size || 22;
  const n = rows.length;
  const cell = size / n;
  let s = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.' || !colorMap[c]) continue;
      s += '<rect x="' + (x * cell).toFixed(1) + '" y="' + (y * cell).toFixed(1) + '" width="' + cell.toFixed(1) + '" height="' + cell.toFixed(1) + '" fill="' + colorMap[c] + '"/>';
    }
  }
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' + s + '</svg>';
}
const ICON_WORKER = pxIcon(['.WW.', 'WWWW', 'WWWW', '.WW.'], { W: '#f2f2ea' });
const ICON_SOLDIER = pxIcon(['.RR.', 'RRRR', 'RRRR', '.RR.'], { R: '#e0483f' });
const ICON_ZONE = pxIcon(['A.A.', '....', '..A.', 'A.A.'], { A: '#e3a23c' });
const ICON_BRUSH = pxIcon(['.AA..', '..AA.', '...A.', '..AA.', '.AA..'], { A: '#e3a23c' });
const ICON_WALL = pxIcon(['TTTTT', 'T...T', 'TTTTT'], { T: '#d8cf9d' });
const ICON_BARRACKS = pxIcon(['.BB..', 'BBBBB', 'B.B.B', 'BBBBB'], { B: '#c1543f' });
const ICON_TUNNEL = pxIcon(['..A..', '.AAA.', 'A.A.A', '..A..'], { A: '#e3a23c' });
const ICON_PILLAR = pxIcon(['.PP.', '.PP.', 'PPPP', 'PPPP'], { P: '#7fd1ae' });
const ICON_DESTROY = pxIcon(['A...A', '.A.A.', '..A..', '.A.A.', 'A...A'], { A: '#d8544a' });

function actionBtnHtml(id, hotkey, icon, label, cost) {
  return '<button class="action-btn" id="' + id + '" title="' + label + (cost ? ' — ' + cost : '') + '">' +
    '<span class="hk">' + hotkey + '</span><span>' + icon + '</span>' +
    (cost ? '<span class="cost">' + cost + '</span>' : '') + '</button>';
}

function rebuildPanel(kind) {
  const cc = document.getElementById('commandcard');
  if (kind === 'none') { cc.classList.add('hidden'); return; }
  cc.classList.remove('hidden');
  const info = document.getElementById('cc-info'), unitsBox = document.getElementById('cc-units'), actions = document.getElementById('cc-actions');

  if (kind === 'base') {
    info.innerHTML = '<h3>Base principale</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-train-worker', '1', ICON_WORKER, 'Former Ouvrier', WORKER_COST_BOIS + ' Bois') +
      '<div class="bar-bg" id="train-bar-bg" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill"></div></div>';
  } else if (kind === 'base-rival') {
    info.innerHTML = '<h3>Base rivale</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div class="hint">Hors de portée.</div>';
    unitsBox.innerHTML = ''; actions.innerHTML = '';
  } else if (kind === 'barracks') {
    info.innerHTML = '<h3>Caserne</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-train-soldier', '1', ICON_SOLDIER, 'Former Soldat', SOLDIER_COST_BOIS + 'B/' + SOLDIER_COST_MINERAI + 'M') +
      '<div class="bar-bg" id="train-bar-bg" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill"></div></div>' +
      actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'pillar') {
    info.innerHTML = '<h3>Pilier</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div class="hint">Tour de vision (portée quasi illimitée, bloquée par les obstacles).</div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'wall') {
    info.innerHTML = '<h3>Mur</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-destroy-wall', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'units') {
    info.innerHTML = '<h3>Sélection</h3><div class="row"><span>Ouvriers</span><span id="panel-workers">0</span></div><div class="row"><span>Soldats</span><span id="panel-soldiers">0</span></div>';
    actions.innerHTML = '';
    lastActionsTab = null;
    // Les portraits ne sont (re)construits qu'ici, au changement de sélection — pas à
    // chaque frame — sinon avec beaucoup d'unités sélectionnées, recréer tous ces
    // éléments DOM 60x/sec devient très coûteux (c'était la vraie cause du lag).
    unitsBox.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const u of units) {
      if (!selectedIds.has(u.id)) continue;
      const hpFrac = Math.max(0, u.hp / u.maxhp);
      const div = document.createElement('div');
      div.className = 'unit-portrait';
      div.dataset.uid = u.id;
      div.title = u.type === 'worker' ? 'Ouvrier' : 'Soldat';
      div.innerHTML = '<span class="icon" style="display:flex;align-items:center;justify-content:center;">' +
        (u.type === 'worker' ? ICON_WORKER : ICON_SOLDIER) + '</span>' +
        '<div class="hpbar"><i style="width:' + Math.round(hpFrac * 100) + '%;background:' + (hpFrac < 0.3 ? 'var(--danger)' : 'var(--cyan)') + ';"></i></div>';
      frag.appendChild(div);
    }
    unitsBox.appendChild(frag);
  }
}

function refreshTrainBar(b, costOk, btnId) {
  const training = b.train && b.train.active;
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = training || !costOk;
  const bg = document.getElementById('train-bar-bg'), fill = document.getElementById('train-bar-fill');
  if (training) { bg.style.display = ''; fill.style.width = Math.round(100 * (1 - b.train.timeLeft / b.train.totalTime)) + '%'; }
  else if (bg) bg.style.display = 'none';
}

function refreshPanel(kind) {
  if (kind === 'none') return;
  if (kind === 'base' || kind === 'base-rival') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    if (kind === 'base') refreshTrainBar(b, resources.bois >= WORKER_COST_BOIS, 'btn-train-worker');
  } else if (kind === 'barracks') {
    const b = selectedBuilding;
    document.getElementById('panel-hp').textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    refreshTrainBar(b, resources.bois >= SOLDIER_COST_BOIS && resources.minerai >= SOLDIER_COST_MINERAI, 'btn-train-soldier');
  } else if (kind === 'pillar') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
  } else if (kind === 'wall') {
    if (!selectedWall || grid[idx(selectedWall.x, selectedWall.y)] !== T_WALL) { selectedWall = null; updateHUD(); return; }
    const i = idx(selectedWall.x, selectedWall.y);
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, tileHP[i]) + '/' + tileMaxHP[i];
  } else if (kind === 'units') {
    let workers = 0, soldiers = 0;
    for (const u of units) {
      if (!selectedIds.has(u.id)) continue;
      if (u.type === 'worker') workers++; else soldiers++;
    }
    document.getElementById('panel-workers').textContent = workers;
    document.getElementById('panel-soldiers').textContent = soldiers;

    const actions = document.getElementById('cc-actions');
    if (workers > 0) {
      if (lastActionsTab !== activeTab) {
        lastActionsTab = activeTab;
        let tools = '';
        if (activeTab === 'miner') {
          tools = actionBtnHtml('btn-mine-tool', '1', ICON_TUNNEL, 'Miner vers (clic droit)', '') +
            actionBtnHtml('btn-zone', '2', ICON_ZONE, 'Zone rectangulaire', '') +
            actionBtnHtml('btn-brush', '3', ICON_BRUSH, 'Pinceau', '');
        } else {
          tools = actionBtnHtml('btn-build-wall', '1', ICON_WALL, 'Mur', WALL_COST_PIERRE + 'P') +
            actionBtnHtml('btn-build-barracks', '2', ICON_BARRACKS, 'Caserne', BARRACKS_COST_BOIS + 'B/' + BARRACKS_COST_MINERAI + 'M') +
            actionBtnHtml('btn-build-pillar', '3', ICON_PILLAR, 'Pilier (tour de vision)', PILLAR_COST_PIERRE + 'P/' + PILLAR_COST_BOIS + 'B');
        }
        actions.innerHTML =
          '<div id="cc-tabs" style="grid-column:1/-1;display:flex;gap:4px;margin-bottom:2px;">' +
          '<button class="tab-btn" id="tab-miner">Miner</button>' +
          '<button class="tab-btn" id="tab-construire">Construire</button>' +
          '</div>' + tools;
      }
      document.getElementById('tab-miner').classList.toggle('active', activeTab === 'miner');
      document.getElementById('tab-construire').classList.toggle('active', activeTab === 'construire');
      if (activeTab === 'miner') {
        document.getElementById('btn-mine-tool').classList.toggle('active', mineTool);
        document.getElementById('btn-zone').classList.toggle('active', zoneMode);
        document.getElementById('btn-brush').classList.toggle('active', brushMode);
      } else {
        document.getElementById('btn-build-wall').disabled = resources.pierre < WALL_COST_PIERRE;
        document.getElementById('btn-build-wall').classList.toggle('active', buildMode === 'wall');
        document.getElementById('btn-build-barracks').disabled = resources.bois < BARRACKS_COST_BOIS || resources.minerai < BARRACKS_COST_MINERAI;
        document.getElementById('btn-build-barracks').classList.toggle('active', buildMode === 'barracks');
        document.getElementById('btn-build-pillar').disabled = resources.pierre < PILLAR_COST_PIERRE || resources.bois < PILLAR_COST_BOIS;
        document.getElementById('btn-build-pillar').classList.toggle('active', buildMode === 'pillar');
      }
    } else if (actions.innerHTML !== '') {
      actions.innerHTML = '';
      lastActionsTab = null;
    }
  }
}

function updateHUD() {
  document.getElementById('res-bois').textContent = resources.bois;
  document.getElementById('res-minerai').textContent = resources.minerai;
  document.getElementById('res-pierre').textContent = resources.pierre;

  let kind, key;
  if (selectedBuilding) {
    if (selectedBuilding.type === 'base') kind = selectedBuilding.owner === 'player' ? 'base' : 'base-rival';
    else if (selectedBuilding.type === 'pillar') kind = 'pillar';
    else kind = 'barracks';
    key = kind + ':' + selectedBuilding.id;
  } else if (selectedWall) {
    kind = 'wall'; key = 'wall:' + selectedWall.x + ',' + selectedWall.y;
  } else if (selectedIds.size > 0) {
    kind = 'units'; key = 'units:' + Array.from(selectedIds).sort((a, b) => a - b).join(',');
  } else { kind = 'none'; key = 'none'; }

  if (key !== panelKey) { panelKey = key; rebuildPanel(kind); }
  refreshPanel(kind);
}
