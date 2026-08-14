/* === 08-hud-ui.js — Boutons UI, icônes pixel-art, panneau de commande (command card), HUD (original: lignes 1388-1640) === */
// ---------- Boutons UI ----------
document.getElementById('btn-fog').addEventListener('click', () => setFogEnabled(!fogEnabled));

let uiScale = 2.0; // échelle de base de l'interface (voir aussi le slider #slider-ui-scale dans le menu Échap, plage 0.8–2.2)
function applyUiScale() {
  document.documentElement.style.setProperty('--ui-scale', uiScale.toFixed(2));
}
applyUiScale();

// ---------- Panneau d'aide (contrôles) : rétractable ----------
// Se rétracte automatiquement 30s après son dernier affichage (au chargement, ou après une
// réouverture manuelle) pour ne pas encombrer l'écran en permanence ; la petite languette
// ronde (#help-toggle, toujours visible même rétracté) permet de le rouvrir/refermer à la main
// à tout moment.
let helpVisible = true;
let helpAutoHideTimer = null;
function setHelpVisible(v) {
  helpVisible = v;
  document.getElementById('help').classList.toggle('collapsed', !v);
  if (helpAutoHideTimer) { clearTimeout(helpAutoHideTimer); helpAutoHideTimer = null; }
  if (v) helpAutoHideTimer = setTimeout(() => setHelpVisible(false), 30000);
}
document.getElementById('help-toggle').addEventListener('click', () => setHelpVisible(!helpVisible));
setHelpVisible(true);

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

// Active/désactive le mode "pose de bâtiment" (mur/caserne/pilier) pour le groupe d'ouvriers
// actuellement sélectionné — cliquer à nouveau sur le même type l'annule (toggle).
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

// Délégation de clic unique sur tout le panneau de commande (plutôt qu'un listener par
// bouton) : les boutons d'action sont recréés dynamiquement (voir rebuildPanel/refreshPanel),
// un seul listener sur le conteneur parent évite d'avoir à le ré-attacher à chaque fois.
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
  else if (id === 'btn-build-outpost') startBuildMode('outpost');
  else if (id === 'btn-build-lab') startBuildMode('lab');
  else if (id === 'btn-research-inventory') startResearch('inventory');
  else if (id === 'btn-research-speed') startResearch('speed');
  else if (id === 'btn-research-drill') startResearch('drill');
  else if (id === 'btn-research-resist') startResearch('resist');
  else if (id === 'btn-research-production') startResearch('production');
  else if (id === 'btn-attack') startAttackMode();
  else if (id === 'btn-defend') defendPosition();
  else if (id === 'tab-miner') { activeTab = 'miner'; lastActionsTab = null; updateHUD(); }
  else if (id === 'tab-construire') { activeTab = 'construire'; lastActionsTab = null; updateHUD(); }
  else {
    const portrait = e.target.closest && e.target.closest('.unit-portrait');
    if (portrait && portrait.dataset.uid) {
      const uid = Number(portrait.dataset.uid);
      selectedIds.clear(); selectedIds.add(uid); selectedBuilding = null; selectedWall = null;
      bumpSelection();
      updateHUD();
    }
  }
});

// Reflète l'état des modes d'outil actifs (zone/pinceau/construction) sur les boutons
// correspondants (classe .active) et sur le curseur du canvas.
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
  
  canvas.style.cursor = attackMode ? 'crosshair' : (zoneMode || brushMode || mineTool) ? 'cell' : (buildMode ? 'copy' : 'crosshair');
}

let panelKey = null;
let activeTab = 'miner';
let lastActionsTab = null;

// Génère une petite icône pixel-art en SVG inline à partir d'une grille de caractères (rows :
// tableau de chaînes, un caractère = une case ; '.' = transparent, tout autre caractère est
// mappé vers une couleur via colorMap) — évite d'avoir à gérer des fichiers image séparés pour
// des icônes aussi simples.
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
const ICON_OUTPOST = pxIcon(['.OOO.', 'OO.OO', 'OOOOO', 'OOOOO'], { O: '#d1a35c' });
const ICON_LAB = pxIcon(['..L..', '.LLL.', 'LLLLL', 'L.L.L'], { L: '#8ad1e0' });
// Icône générique (utilisée nulle part directement, gardée pour compat/référence) — chaque
// amélioration du labo a maintenant sa PROPRE icône pixel-art distincte ci-dessous, pour qu'on
// puisse les reconnaître au premier coup d'œil dans le panneau plutôt que de réutiliser le
// même pictogramme partout.
const ICON_RESEARCH = pxIcon(['..A..', '.AAA.', 'AA.AA', '..A..'], { A: '#7fd1ae' });
// Inventaire : petit sac/coffre (silhouette de conteneur), ambre pour rappeler le bois/stockage.
const ICON_RESEARCH_INVENTORY = pxIcon(['.III.', 'IIIII', 'I...I', 'IIIII'], { I: '#c98f3a' });
// Vitesse : éclair en zigzag, jaune vif.
const ICON_RESEARCH_SPEED = pxIcon(['.SS..', '.S...', '..SS.', '...S.', '..S..'], { S: '#f2e14a' });
// Vitesse de forage : mèche de perceuse en diagonale, cuivre.
const ICON_RESEARCH_DRILL = pxIcon(['D....', 'DD...', '.DD..', '..DD.', '...DD'], { D: '#e3a23c' });
// Résistance : bouclier, sarcelle (même famille que la barre de PV en bonne santé).
const ICON_RESEARCH_RESIST = pxIcon(['.RRR.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'], { R: '#4fd1c5' });
// Production : engrenage (petit + grand cran), vert pour évoquer la croissance/l'expansion.
const ICON_RESEARCH_PRODUCTION = pxIcon(['P.P.P', '.PPP.', 'PPPPP', '.PPP.', 'P.P.P'], { P: '#8fd15c' });
// Attaquer : épée en diagonale, rouge vif (même famille que la couleur des soldats).
const ICON_ATTACK = pxIcon(['....A', '...A.', '..A..', '.A...', 'AA...'], { A: '#e0483f' });
// Défendre position : bouclier, bleu (distinct du bouclier "résistance" du labo, sarcelle).
const ICON_DEFEND = pxIcon(['.DDD.', 'DDDDD', 'DDDDD', '.DDD.', '..D..'], { D: '#5a8fd1' });

// Génère le HTML d'un bouton d'action de la command card (icône + raccourci clavier affiché +
// coût optionnel), utilisé pour tous les boutons construits dynamiquement dans rebuildPanel/refreshPanel.
function actionBtnHtml(id, hotkey, icon, label, cost) {
  return '<button class="action-btn" id="' + id + '" title="' + label + (cost ? ' — ' + cost : '') + '">' +
    '<span class="hk">' + hotkey + '</span><span>' + icon + '</span>' +
    (cost ? '<span class="cost">' + cost + '</span>' : '') + '</button>';
}

// (Re)construit ENTIÈREMENT le contenu du panneau de commande pour un type de sélection donné
// ('base' / 'enemy-building' / 'barracks' / 'outpost' / 'lab' / 'pillar' / 'wall' / 'units' /
// 'none') — coûteux (innerHTML,
// création de portraits DOM), donc appelé uniquement quand la sélection change réellement (voir
// panelKey dans updateHUD), jamais à chaque frame ; les mises à jour de valeurs à chaque frame
// (PV, barre de progression...) passent par refreshPanel, plus léger.
function rebuildPanel(kind) {
  const cc = document.getElementById('commandcard');
  if (kind === 'none') { cc.classList.add('hidden'); return; }
  cc.classList.remove('hidden');
  const info = document.getElementById('cc-info'), unitsBox = document.getElementById('cc-units'), actions = document.getElementById('cc-actions');

  if (kind === 'base') {
    info.innerHTML = '<h3>Base principale</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-train-worker', '1', ICON_WORKER, 'Former Ouvrier', WORKER_COST_BOIS + ' Bois') +
      '<div class="bar-bg" id="train-bar-bg" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill"></div></div>' +
      '<div class="bar-bg" id="train-bar-bg2" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill2"></div></div>' +
      '<div class="hint" id="train-queue-hint" style="grid-column:1/-1;"></div>';
  } else if (kind === 'enemy-building') {
    // Panneau générique en lecture seule pour TOUT bâtiment n'appartenant pas au joueur — voir
    // le commentaire sur ce kind dans updateHUD : jamais de bouton d'action ici, quel que soit
    // le type réel du bâtiment (base/caserne/avant-poste/labo rivaux).
    const names = { base: 'Base rivale', barracks: 'Caserne rivale', outpost: 'Avant-poste rival', lab: 'Laboratoire rival', pillar: 'Pilier rival' };
    const label = names[selectedBuilding.type] || 'Bâtiment rival';
    info.innerHTML = '<h3>' + label + '</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div class="hint">Hors de contrôle — attaquez-le avec des soldats pour le détruire.</div>';
    unitsBox.innerHTML = ''; actions.innerHTML = '';
  } else if (kind === 'barracks') {
    info.innerHTML = '<h3>Caserne</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-train-soldier', '1', ICON_SOLDIER, 'Former Soldat', SOLDIER_COST_BOIS + 'B/' + SOLDIER_COST_MINERAI + 'M') +
      '<div class="bar-bg" id="train-bar-bg" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill"></div></div>' +
      '<div class="hint" id="train-queue-hint" style="grid-column:1/-1;"></div>' +
      actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'pillar') {
    info.innerHTML = '<h3>Pilier</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div class="hint">Tour de vision (portée quasi illimitée, bloquée par les obstacles).</div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'outpost') {
    info.innerHTML = '<h3>Avant-poste</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div class="hint">Base secondaire : dépôt + production d\'ouvriers, réduit les trajets.</div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-train-worker', '1', ICON_WORKER, 'Former Ouvrier', WORKER_COST_BOIS + ' Bois') +
      '<div class="bar-bg" id="train-bar-bg" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill"></div></div>' +
      '<div class="bar-bg" id="train-bar-bg2" style="display:none;grid-column:1/-1;"><div class="bar-fill" id="train-bar-fill2"></div></div>' +
      '<div class="hint" id="train-queue-hint" style="grid-column:1/-1;"></div>' +
      actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'lab') {
    info.innerHTML = '<h3>Laboratoire</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div><div id="panel-research-status" class="hint"></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML =
      actionBtnHtml('btn-research-inventory', '1', ICON_RESEARCH_INVENTORY, 'Inventaire (niv. ' + research.inventory + '/' + RESEARCH_MAX_LEVEL + ')', '') +
      actionBtnHtml('btn-research-speed', '2', ICON_RESEARCH_SPEED, 'Vitesse (niv. ' + research.speed + '/' + RESEARCH_MAX_LEVEL + ')', '') +
      actionBtnHtml('btn-research-drill', '3', ICON_RESEARCH_DRILL, 'Vitesse de forage (niv. ' + research.drill + '/' + RESEARCH_MAX_LEVEL + ')', '') +
      actionBtnHtml('btn-research-resist', '4', ICON_RESEARCH_RESIST, 'Résistance (niv. ' + research.resist + '/' + RESEARCH_MAX_LEVEL + ')', '') +
      actionBtnHtml('btn-research-production', '5', ICON_RESEARCH_PRODUCTION, 'Production (base x2)' + (research.production ? ' — débloqué' : ''), '') +
      actionBtnHtml('btn-destroy-building', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'wall') {
    info.innerHTML = '<h3>Mur</h3><div class="row"><span>PV</span><span id="panel-hp">-</span></div>';
    unitsBox.innerHTML = '';
    actions.innerHTML = actionBtnHtml('btn-destroy-wall', 'Suppr', ICON_DESTROY, 'Détruire (recycler)', '');
  } else if (kind === 'units') {
    info.innerHTML = '<h3>Sélection</h3><div class="row"><span>Ouvriers</span><span id="panel-workers">0</span></div><div class="row"><span>Soldats</span><span id="panel-soldiers">0</span></div>';
    // Contenu réel de la zone d'actions (outils de minage/construction si des ouvriers sont
    // sélectionnés, boutons Attaquer/Défendre si ce sont des soldats) entièrement piloté par
    // refreshPanel ci-dessous, qui tourne à CHAQUE frame et sait recomposer selon la composition
    // exacte de la sélection — rebuildPanel ne fait que vider, refreshPanel reconstruit juste
    // après de toute façon (voir updateHUD) donc initialiser autre chose ici serait aussitôt
    // écrasé.
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

// Met à jour la/les barre(s) de progression de production d'un bâtiment (base/avant-poste/
// caserne) et désactive/active le bouton de production selon si TOUTES les productions
// possibles sont déjà en cours ET la file d'attente déjà pleine (voir enqueueProduction dans
// 06-training-build.js), ou si les ressources sont insuffisantes. Le second slot (train2,
// bar-bg2/bar-fill2) n'est utilisé que par base/avant-poste, et seulement une fois
// l'amélioration "production" débloquée. Affiche aussi le nombre d'unités en attente derrière
// les emplacements actifs (plusieurs ouvriers/soldats peuvent être en cours de fabrication).
function refreshTrainBar(b, costOk, btnId) {
  const training = b.train && b.train.active;
  const training2 = b.train2 && b.train2.active;
  const bothSlotsBusy = research.production ? (training && training2) : training;
  const queueLen = (b.trainQueue || []).length;
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = (bothSlotsBusy && queueLen >= TRAIN_QUEUE_MAX) || !costOk;

  const bg = document.getElementById('train-bar-bg'), fill = document.getElementById('train-bar-fill');
  if (training) { bg.style.display = ''; fill.style.width = Math.round(100 * (1 - b.train.timeLeft / b.train.totalTime)) + '%'; }
  else if (bg) bg.style.display = 'none';

  const bg2 = document.getElementById('train-bar-bg2'), fill2 = document.getElementById('train-bar-fill2');
  if (bg2) {
    if (training2) { bg2.style.display = ''; fill2.style.width = Math.round(100 * (1 - b.train2.timeLeft / b.train2.totalTime)) + '%'; }
    else bg2.style.display = 'none';
  }

  const queueHint = document.getElementById('train-queue-hint');
  if (queueHint) queueHint.textContent = queueLen > 0 ? ('En attente : ' + queueLen + '/' + TRAIN_QUEUE_MAX) : '';
}

// Met à jour les valeurs dynamiques du panneau déjà construit par rebuildPanel (PV, barres de
// progression, disponibilité des boutons...) — appelé à CHAQUE frame (voir updateHUD), donc
// doit rester léger : pas de reconstruction DOM ici, seulement des mises à jour de texte/style.
function refreshPanel(kind) {
  if (kind === 'none') return;
  if (kind === 'enemy-building') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
  } else if (kind === 'base') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    refreshTrainBar(b, resources.bois >= WORKER_COST_BOIS, 'btn-train-worker');
  } else if (kind === 'barracks') {
    const b = selectedBuilding;
    document.getElementById('panel-hp').textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    refreshTrainBar(b, resources.bois >= SOLDIER_COST_BOIS && resources.minerai >= SOLDIER_COST_MINERAI, 'btn-train-soldier');
  } else if (kind === 'pillar') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
  } else if (kind === 'outpost') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    refreshTrainBar(b, resources.bois >= WORKER_COST_BOIS, 'btn-train-worker');
  } else if (kind === 'lab') {
    const b = selectedBuilding;
    const hpEl = document.getElementById('panel-hp');
    if (hpEl) hpEl.textContent = Math.max(0, Math.round(b.hp)) + '/' + b.maxhp;
    const statusEl = document.getElementById('panel-research-status');
    const active = b.research && b.research.active;
    if (statusEl) statusEl.textContent = active ? ('Recherche en cours… ' + Math.max(0, Math.ceil(b.research.timeLeft)) + 's') : 'Aucune recherche en cours.';
    for (const [key, btnId] of [['inventory', 'btn-research-inventory'], ['speed', 'btn-research-speed'], ['drill', 'btn-research-drill'], ['resist', 'btn-research-resist'], ['production', 'btn-research-production']]) {
      const btn = document.getElementById(btnId);
      if (!btn) continue;
      const cost = nextResearchCost(key);
      btn.disabled = active || cost === null || resources.minerai < cost;
    }
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
            actionBtnHtml('btn-build-pillar', '3', ICON_PILLAR, 'Pilier (tour de vision)', PILLAR_COST_PIERRE + 'P/' + PILLAR_COST_BOIS + 'B') +
            actionBtnHtml('btn-build-outpost', '4', ICON_OUTPOST, 'Avant-poste (base secondaire)', OUTPOST_COST_BOIS + 'B/' + OUTPOST_COST_PIERRE + 'P') +
            actionBtnHtml('btn-build-lab', '5', ICON_LAB, 'Laboratoire de recherche', LAB_COST_BOIS + 'B/' + LAB_COST_MINERAI + 'M');
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
        document.getElementById('btn-build-outpost').disabled = resources.bois < OUTPOST_COST_BOIS || resources.pierre < OUTPOST_COST_PIERRE;
        document.getElementById('btn-build-outpost').classList.toggle('active', buildMode === 'outpost');
        document.getElementById('btn-build-lab').disabled = resources.bois < LAB_COST_BOIS || resources.minerai < LAB_COST_MINERAI;
        document.getElementById('btn-build-lab').classList.toggle('active', buildMode === 'lab');
      }
    } else if (soldiers > 0) {
      // Sélection de soldats sans aucun ouvrier mélangé dedans : boutons de combat plutôt que
      // les onglets miner/construire (voir startAttackMode/defendPosition dans
      // 06-training-build.js). lastActionsTab sert aussi ici de mémo pour ne reconstruire le
      // HTML qu'au changement réel de contenu, pas à chaque frame.
      if (lastActionsTab !== 'soldiers') {
        lastActionsTab = 'soldiers';
        actions.innerHTML = actionBtnHtml('btn-attack', '1', ICON_ATTACK, 'Attaquer', '') + actionBtnHtml('btn-defend', '2', ICON_DEFEND, 'Défendre position', '');
      }
    } else if (actions.innerHTML !== '') {
      actions.innerHTML = '';
      lastActionsTab = null;
    }
  }
}

// Point d'entrée principal du HUD, appelé une fois par frame (voir update() dans 09-update.js)
// et après toute action changeant la sélection. Détermine le "kind" de panneau à afficher
// d'après l'état de sélection courant, ne reconstruit le DOM (rebuildPanel) QUE si la clé de
// sélection (panelKey) a changé depuis la dernière frame, puis rafraîchit toujours les valeurs
// (refreshPanel) — c'est ce qui rend le HUD à la fois réactif et peu coûteux en performance.
function updateHUD() {
  document.getElementById('res-bois').textContent = resources.bois;
  document.getElementById('res-minerai').textContent = resources.minerai;
  document.getElementById('res-pierre').textContent = resources.pierre;

  let kind, key;
  if (selectedBuilding) {
    // Un bâtiment qui n'appartient PAS au joueur (base rivale, mais aussi désormais caserne/
    // avant-poste/labo rivaux — voir updateRivalAI dans 09-update.js) reste sélectionnable pour
    // consultation (PV visibles), mais affiche TOUJOURS un panneau générique en lecture seule,
    // sans le moindre bouton d'action : sans ce garde-fou, sélectionner par exemple une caserne
    // ennemie afficherait le vrai panneau "caserne" du joueur, avec un bouton "Former Soldat"
    // qui débiterait les ressources DU JOUEUR pour faire apparaître un soldat... ENNEMI
    // (spawnUnit reçoit b.owner, voir updateBuildings dans 06-training-build.js).
    if (selectedBuilding.owner !== 'player') kind = 'enemy-building';
    else if (selectedBuilding.type === 'base') kind = 'base';
    else if (selectedBuilding.type === 'pillar') kind = 'pillar';
    else if (selectedBuilding.type === 'outpost') kind = 'outpost';
    else if (selectedBuilding.type === 'lab') kind = 'lab';
    else kind = 'barracks';
    key = kind + ':' + selectedBuilding.id;
    // Le panneau 'lab' affiche le niveau courant de chaque amélioration DANS le libellé des
    // boutons (construit une seule fois par rebuildPanel) — sans ce complément de clé, ce
    // libellé resterait figé au niveau d'avant si une recherche se termine pendant que le
    // labo reste sélectionné en continu (refreshPanel seul ne reconstruit pas le HTML).
    if (kind === 'lab') key += ':' + research.inventory + research.speed + research.drill + research.resist + research.production;
  } else if (selectedWall) {
    kind = 'wall'; key = 'wall:' + selectedWall.x + ',' + selectedWall.y;
  } else if (selectedIds.size > 0) {
    // selectionVersion (voir 06-training-build.js) plutôt qu'un tri+jointure de selectedIds :
    // équivalent pour détecter un changement de sélection, mais O(1) au lieu de O(n log n)
    // À CHAQUE FRAME — sensible avec de grosses sélections (des centaines d'unités).
    kind = 'units'; key = 'units:' + selectionVersion;
  } else { kind = 'none'; key = 'none'; }

  if (key !== panelKey) { panelKey = key; rebuildPanel(kind); }
  refreshPanel(kind);
}
