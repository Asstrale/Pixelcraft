/* === 01-constants.js — Constantes du jeu, grilles de données, fonctions utilitaires de base (original: lignes 202-264) === */
"use strict";

/* =========================================================
   PIXELCRAFT — prototype RTS pixel-art (v2, procédural)
   ========================================================= */

const TILE = 14;
const MAP_W = 320, MAP_H = 320;
const BASE_SIZE = 3;           
const SPAWN_CLEAR_RADIUS = 13; 
const NUM_PLAYERS = 4;         

const T_EMPTY = 0, T_STONE = 1, T_WOOD = 2, T_MINERAL = 3, T_WALL = 4, T_GAS = 5;

const STONE_HP = 42, STONE_YIELD = 2;
const WOOD_HP = 18, WOOD_YIELD = 14;
const MINERAL_HP = 24, MINERAL_YIELD = 12;
const WALL_HP = 26;
const GAS_HP = 8;

const WORKER_COST_BOIS = 20, WORKER_TIME = 5;
const SOLDIER_COST_BOIS = 10, SOLDIER_COST_MINERAI = 25, SOLDIER_TIME = 6;
const WALL_COST_PIERRE = 8;
const BARRACKS_COST_BOIS = 40, BARRACKS_COST_MINERAI = 20;

const MINE_INTERVAL = 0.0001; 
const CARRY_CAPACITY = 30; 
const HP_PER_RESOURCE = 8; 

function chebRectDist(px, py, rx, ry, rw, rh) {
  const cx = clamp(px, rx, rx + rw - 1), cy = clamp(py, ry, ry + rh - 1);
  return Math.max(Math.abs(px - cx), Math.abs(py - cy));
}

const GAS_DAMAGE = 220; 

const WORKER_VISION = 7, SOLDIER_VISION = 8, BASE_VISION = 6, BARRACKS_VISION = 10;
const OVERVIEW_THRESHOLD = 0.35;

// Portée "infinie" pratique pour la vision en projection (tour de vision) : bornée à la
// diagonale de la carte, seuls les obstacles l'arrêtent réellement avant ça (voir revealLOS
// dans 05-fog-overview.js).
const VISION_MAX_RANGE = Math.ceil(Math.hypot(MAP_W, MAP_H));

const grid = new Uint8Array(MAP_W * MAP_H);
const tileHP = new Int16Array(MAP_W * MAP_H);
const tileMaxHP = new Int16Array(MAP_W * MAP_H);
const tileSeed = new Uint8Array(MAP_W * MAP_H);
const buildingGrid = new Int32Array(MAP_W * MAP_H).fill(-1);
const exploredTile = new Uint8Array(MAP_W * MAP_H);
const visibleNow = new Uint8Array(MAP_W * MAP_H);

function idx(x, y) { return y * MAP_W + x; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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
