/* === 01-constants.js — Constantes du jeu, grilles de données, fonctions utilitaires de base (original: lignes 202-264) === */
"use strict";

/* =========================================================
   PIXELCRAFT — prototype RTS pixel-art (v2, procédural)
   ========================================================= */

// ---------- Carte & bases ----------
const TILE = 14;              // taille d'une case en pixels à l'écran (avant zoom caméra)
const MAP_W = 320, MAP_H = 320;
const BASE_SIZE = 3;           // largeur/hauteur (en cases) de la base principale de chaque joueur
const SPAWN_CLEAR_RADIUS = 13; // rayon (en cases) déblayé autour de chaque base au moment de la génération
const NUM_PLAYERS = 4;         // nombre de bases générées sur la carte (1 = joueur, le reste = rivaux IA/neutres)

// ---------- Types de case ----------
const T_EMPTY = 0, T_STONE = 1, T_WOOD = 2, T_MINERAL = 3, T_WALL = 4, T_GAS = 5;

// PV et rendement (quantité de ressource obtenue) par type de case minable.
// STONE_YIELD/WOOD_YIELD/MINERAL_YIELD ne sont PAS le nombre d'unités ajoutées à
// l'inventaire de l'ouvrier (toujours +1 par case minée, voir updateUnit dans
// 04-units.js) mais le multiplicateur appliqué aux ressources du joueur au dépôt
// à la base (voir le bloc 'deposit' dans updateUnit).
const STONE_HP = 42, STONE_YIELD = 2;
const WOOD_HP = 18, WOOD_YIELD = 14;
const MINERAL_HP = 24, MINERAL_YIELD = 12;
const WALL_HP = 26;
const GAS_HP = 8;

// ---------- Coûts / temps de production ----------
const WORKER_COST_BOIS = 20, WORKER_TIME = 5;
const SOLDIER_COST_BOIS = 10, SOLDIER_COST_MINERAI = 25, SOLDIER_TIME = 6;
// Nombre maximum d'unités en attente dans la file de production d'un même bâtiment (au-delà
// des emplacements actifs train/train2) — évite qu'un joueur ne bloque toutes ses ressources
// d'un coup en spammant le bouton sans limite (voir enqueueProduction dans 06-training-build.js).
const TRAIN_QUEUE_MAX = 5;
const WALL_COST_PIERRE = 8;
const BARRACKS_COST_BOIS = 40, BARRACKS_COST_MINERAI = 20;

// Base secondaire ("avant-poste") : un second point de dépôt/production, pour réduire les
// longs allers-retours des ouvriers travaillant loin de la base principale. Même gabarit que
// la base principale (BASE_SIZE), un peu moins résistante, destructible (contrairement à la
// base principale) — voir destroySelectedBuilding dans 06-training-build.js.
const OUTPOST_SIZE = BASE_SIZE;
const OUTPOST_COST_BOIS = 60, OUTPOST_COST_PIERRE = 40;
const OUTPOST_BUILD_HP = 70;
const OUTPOST_HP = 300;

// Laboratoire de recherche : débloque les niveaux d'amélioration (voir plus bas) contre du
// minerai, avec un temps de recherche fixe (particules de fumée pendant toute sa durée, voir
// drawBuilding dans 10-render.js et startResearch dans 06-training-build.js).
const LAB_SIZE = 2;
const LAB_COST_BOIS = 30, LAB_COST_MINERAI = 40;
const LAB_BUILD_HP = 50;
const LAB_HP = 120;
const RESEARCH_DURATION = 60; // secondes

// ---------- Améliorations (recherche) ----------
// 4 niveaux pour la plupart des améliorations, appliqués GLOBALEMENT à toutes les unités
// concernées du joueur (existantes ET futures) dès que le niveau est débloqué — pas une
// amélioration à appliquer unité par unité. Coût en minerai uniquement, croissant par niveau.
const RESEARCH_MAX_LEVEL = 4;
const RESEARCH_COSTS_MINERAI = [60, 120, 200, 300]; // coût du niveau N = RESEARCH_COSTS_MINERAI[N-1]
const RESEARCH_INVENTORY_PER_LEVEL = 5;  // + CARRY_CAPACITY par niveau (ex. donné par le joueur, "60 minerai > +1 slot" : la capacité de base ayant depuis été portée à 30, on garde ici un bonus proportionnel plutôt que le chiffre littéral "6" — à ajuster si besoin)
const RESEARCH_SPEED_PER_LEVEL = 0.10;   // +10% de la vitesse de base par niveau
const RESEARCH_DRILL_PER_LEVEL = 0.15;   // +15% de puissance de minage (u.minePower) par niveau
const RESEARCH_RESIST_PER_LEVEL = 0.20;  // +20% de PV max par niveau
// "Production" : amélioration à palier UNIQUE (pas 4 niveaux) — la base principale peut alors
// former 2 unités à la fois au lieu d'1 (voir b.train2 dans 02-worldgen.js / 06-training-build.js).
const RESEARCH_PRODUCTION_COST_MINERAI = 150;

// ---------- Combat ----------
// Seuls les soldats ont des dégâts/une portée non nuls (voir baseAttackDamageFor/
// baseAttackRangeFor dans 04-units.js) — un ouvrier ne se bat jamais, même attaqué. Ces valeurs
// sont volontairement STATIQUES (pas affectées par la recherche, contrairement à
// vitesse/minage/PV max) : seule la résistance (PV) rend un soldat plus dur à tuer, pas plus
// dangereux — un choix d'équilibrage simple pour ce prototype, à ajuster si besoin.
const SOLDIER_ATTACK_DAMAGE = 8;
const SOLDIER_ATTACK_RANGE = 3.2;   // en cases
const ATTACK_COOLDOWN = 0.8;        // secondes entre deux coups d'un même soldat
// Rayon (en cases) dans lequel un soldat sans ordre d'attaque explicite (posté en "Défendre
// position", ou simplement inactif) détecte tout seul un ennemi et riposte — un peu plus large
// que sa portée de tir pour qu'il s'avance l'engager avant d'être déjà au contact.
const ATTACK_ACQUIRE_RADIUS = 6;
// Distance à partir de laquelle une cible EXPLICITE d'un ordre "Attaquer" (clic direct sur une
// unité/un bâtiment précis) bascule en engagement direct (déplacement en ligne droite, sans
// A*, voir updateCombat dans 04-units.js) plutôt que de continuer à s'approcher via le
// pathfinding normal de l'ordre — au-delà, une approche en ligne droite risquerait de rester
// bloquée sur un obstacle non contourné.
const ATTACK_CHASE_RADIUS = 10;

// ---------- IA rivale ----------
// L'IA ne gère qu'un seul camp partagé ('rival') : dans ce prototype, TOUTES les bases non-
// joueur générées par NUM_PLAYERS appartiennent au même camp 'rival' (pas de distinction entre
// elles), donc une seule IA "collective" pilote l'ensemble plutôt qu'une IA par base. Voir
// updateRivalAI dans 09-update.js.
const AI_TICK_INTERVAL = 2.5;      // secondes entre deux prises de décision de l'IA (pas besoin de recalculer à chaque frame)
const AI_WORKER_TARGET_PER_BASE = 6;  // nombre d'ouvriers visé, par base/avant-poste rival
const AI_SOLDIER_TARGET_PER_BASE = 4; // nombre de soldats de garnison visé, par base rivale
const AI_ECONOMY_RADIUS = 22;      // rayon (cases) dans lequel l'IA cherche du minerai/bois/pierre autour d'une de ses bases
const AI_BUILDING_SEARCH_RADIUS = 30; // rayon dans lequel l'IA considère une caserne/un labo comme "à elle" pour une base donnée
const AI_ATTACK_DETECTION_RADIUS = 18; // rayon autour de chaque bâtiment rival qui, une fois un ennemi détecté dedans, déclenche l'envoi de la garnison disponible pour riposter

// MINE_INTERVAL très bas (quasi 0) : le minage/la construction ne sont pas limités par un
// "tick" perceptible, mais par les PV de la case/du chantier divisés par la puissance de
// minage/construction (u.minePower / BUILD_POWER) — c'est donc dt qui fixe la vraie cadence.
const MINE_INTERVAL = 0.0001;
const CARRY_CAPACITY = 30; // nombre total de ressources (toutes catégories confondues) qu'un ouvrier peut transporter avant de devoir déposer
const HP_PER_RESOURCE = 8; // dégâts infligés par seconde de minage à la case ciblée (= u.minePower des ouvriers)

// Distance de Tchebychev (en cases) entre un point et le rectangle d'un bâtiment : 0 si le
// point est dans le rectangle ou juste collé dessus en diagonale, sert pour les tests de
// portée "adjacent au bâtiment" (dépôt, construction, etc.).
function chebRectDist(px, py, rx, ry, rw, rh) {
  const cx = clamp(px, rx, rx + rw - 1), cy = clamp(py, ry, ry + rh - 1);
  return Math.max(Math.abs(px - cx), Math.abs(py - cy));
}

const GAS_DAMAGE = 220; // dégâts max infligés par une explosion de gaz au point d'impact (dégressif avec la distance, voir triggerExplosion)

// Rayons de vision "en projection" (line-of-sight) par source ; l'obstruction réelle par les
// murs/roches/bâtiments est gérée par le raycasting DDA dans 05-fog-overview.js, ces valeurs
// ne sont qu'une borne max de portée avant obstruction.
const WORKER_VISION = 7, SOLDIER_VISION = 8, BASE_VISION = 6, BARRACKS_VISION = 10;
// Avant-poste : même portée que la base principale (c'est une base secondaire). Labo : petit
// bâtiment technique, portée modeste (juste de quoi voir ses abords immédiats).
const OUTPOST_VISION = BASE_VISION;
const LAB_VISION = 5;
const OVERVIEW_THRESHOLD = 0.35; // zoom caméra en dessous duquel on bascule sur le rendu minicarte simplifié

// Portée "infinie" pratique pour la vision en projection (tour de vision) : bornée à la
// diagonale de la carte, seuls les obstacles l'arrêtent réellement avant ça (voir revealLOS
// dans 05-fog-overview.js).
const VISION_MAX_RANGE = Math.ceil(Math.hypot(MAP_W, MAP_H));

// ---------- Grilles de données (une entrée par case de la carte, indexée via idx(x,y)) ----------
const grid = new Uint8Array(MAP_W * MAP_H);          // type de case (T_EMPTY, T_STONE, ...)
const tileHP = new Int16Array(MAP_W * MAP_H);         // PV restants de la case (0 si vide/indestructible)
const tileMaxHP = new Int16Array(MAP_W * MAP_H);      // PV max de la case, pour l'affichage de la barre de vie
const tileSeed = new Uint8Array(MAP_W * MAP_H);       // graine aléatoire par case, utilisée par le rendu pour varier les teintes sans recalcul à chaque frame
const buildingGrid = new Int32Array(MAP_W * MAP_H).fill(-1); // id du bâtiment occupant la case, -1 si aucune
const exploredTile = new Uint8Array(MAP_W * MAP_H);   // 1 si la case a déjà été vue au moins une fois (mémoire du brouillard de guerre)
const visibleNow = new Uint8Array(MAP_W * MAP_H);     // 1 si la case est actuellement dans le champ de vision d'une source alliée (recalculé chaque frame, voir updateVision)

// ---------- Fonctions utilitaires de base ----------
function idx(x, y) { return y * MAP_W + x; }                                   // conversion coordonnées (x,y) -> index plat dans les grilles ci-dessus
function inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; } // la case (x,y) existe-t-elle sur la carte ?
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); } // entier aléatoire dans [a, b] inclus
function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }         // distance euclidienne
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }                // restreint v à l'intervalle [a, b]

// Pose une case d'un type donné et initialise ses PV (max) en conséquence — point d'entrée
// unique pour "créer" une case solide (génération de carte, construction d'un mur, etc.),
// pour ne jamais oublier de synchroniser tileHP/tileMaxHP avec grid.
function setTile(x, y, type) {
  const i = idx(x, y);
  grid[i] = type;
  if (type === T_STONE) { tileHP[i] = STONE_HP; tileMaxHP[i] = STONE_HP; }
  else if (type === T_WOOD) { tileHP[i] = WOOD_HP; tileMaxHP[i] = WOOD_HP; }
  else if (type === T_MINERAL) { tileHP[i] = MINERAL_HP; tileMaxHP[i] = MINERAL_HP; }
  else if (type === T_WALL) { tileHP[i] = WALL_HP; tileMaxHP[i] = WALL_HP; }
  else if (type === T_GAS) { tileHP[i] = GAS_HP; tileMaxHP[i] = GAS_HP; }
  else { tileHP[i] = 0; tileMaxHP[i] = 0; }
}
