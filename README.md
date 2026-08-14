# PIXELCRAFT — structure découpée

`pixelcraft6.html` a été découpé en segments pour que chaque modification
n'oblige plus à relire/réécrire les ~2000 lignes (~75k tokens) du fichier
unique. Le comportement du jeu est **strictement identique** — aucun code
n'a été changé, seulement déplacé dans des fichiers séparés (vérifié par
diff automatisé + test dans un navigateur headless : le jeu se lance,
spawn les 3 ouvriers, réagit aux clics/clavier, sans erreur).

## Comment ouvrir le jeu

Ouvrez `index.html` directement dans le navigateur (double-clic), exactement
comme avant. Les fichiers `.js` sont chargés en `<script src="...">`
classiques (pas de modules ES) pour continuer à fonctionner en `file://`
sans serveur local, sans souci de CORS.

## Structure

```
Pixelcraft/
├── index.html              structure HTML (HUD, canvas, menus)
├── css/
│   └── style.css           tous les styles
└── js/
    ├── 01-constants.js       constantes du jeu, grilles de données, utilitaires (idx, clamp, dist…)
    ├── 02-worldgen.js        bâtiments (registre) + génération procédurale de la carte
    ├── 03-simulation.js      palette de rendu, ressources, déplacement/minage, pathfinding A*, explosions, chantiers
    ├── 04-units.js           unités : spawn + IA (updateUnit) — mine, construit, se déplace
    ├── 05-fog-overview.js    brouillard de guerre + minicarte
    ├── 06-training-build.js  entraînement d'unités, construction, sélection, zones (rect + pinceau)
    ├── 07-camera-input.js    caméra + souris/clavier
    ├── 08-hud-ui.js          icônes, panneau de commande, HUD
    ├── 09-update.js          boucle de mise à jour (simulation par frame)
    ├── 10-render.js          rendu canvas (tuiles, bâtiments, unités, effets)
    └── 11-loop-init.js       boucle principale (loop) + initialisation (init)
```

Les scripts partagent un scope global commun (comme avant, dans un seul
`<script>`) : les fonctions/variables déclarées dans un fichier sont
utilisables dans les suivants, tant que l'ordre de chargement dans
`index.html` est respecté.

## Où éditer selon ce que vous voulez changer

- **Équilibrage (coûts, PV, vitesses, temps de formation)** → `01-constants.js`
- **Génération de la carte (taille, poches de gaz, tunnels, minerais)** → `02-worldgen.js`
- **Récolte, pathfinding, explosions de gaz, chantiers** → `03-simulation.js`
- **Comportement des unités (IA de déplacement/minage/construction)** → `04-units.js`
- **Brouillard de guerre / minicarte** → `05-fog-overview.js`
- **Formation d'unités, construction de bâtiments, sélection, zones/pinceau** → `06-training-build.js`
- **Contrôles caméra, souris, clavier, menu Échap** → `07-camera-input.js`
- **Interface (boutons, icônes, panneau de commande, HUD)** → `08-hud-ui.js`
- **Logique de simulation par frame** → `09-update.js`
- **Rendu visuel (couleurs, effets, dessin canvas)** → `10-render.js`
- **Boucle de jeu / démarrage** → `11-loop-init.js`
- **CSS / apparence de l'interface** → `css/style.css`
- **HTML / structure du HUD** → `index.html`

Pour la plupart des demandes ("change le coût du mur", "corrige le
pathfinding", "améliore le rendu des unités"), une seule modification dans
un seul de ces fichiers suffit — au lieu de charger tout le projet.

## Changelog

**2026-08-13**
- Correctif : la surbrillance de l'ordre "Miner vers" (outil 1) suivait
  l'ouvrier au lieu de rester figée sur l'ensemble de blocs prévu
  (`js/10-render.js`, `js/03-simulation.js` : nouveau `computeLinePath`
  calculé une seule fois à l'émission de l'ordre).
- Correctif : le pinceau (largeur 1, tracé en ligne) pouvait perdre des
  cases en cours de trace ; la logique qui retirait une case déjà ajoutée
  a été supprimée (`js/06-training-build.js`).
- Correctif : une case déjà minée pouvait rester affichée en surbrillance
  (zones "pinceau" et ordre "Miner vers") — le rendu ne dessine plus que
  les cases encore minables (`js/10-render.js`).
- Fonctionnalité : la vision est désormais en "projection" (ligne de vue)
  et non plus un simple cercle — un obstacle (roche/bois/minerai/mur/gaz)
  bloque la vue au-delà de sa face, chaque unité/bâtiment calculant sa
  propre ligne de vue indépendamment. La portée des ouvriers/soldats/base
  ne change pas ; le pilier (tour de vision) a désormais une portée quasi
  illimitée, seulement arrêtée par les obstacles. La vision des bâtiments
  (statiques) est mise en cache et recalculée 1x/seconde plutôt qu'à
  chaque frame, pour rester performante même avec une très grande portée
  (`js/05-fog-overview.js`, `VISION_MAX_RANGE` dans `js/01-constants.js`).
- Fonctionnalité : les murs sont désormais sélectionnables (clic) et une
  action "Détruire" (icône rouge) permet de démolir/recycler un mur, une
  caserne ou un pilier — rembourse 50% du coût de construction. La base
  ne peut pas être détruite. Raccourci clavier : touche Suppr
  (`js/06-training-build.js`, `js/08-hud-ui.js`, `js/10-render.js` pour la
  sélection visuelle du mur).

Note : ce prototype n'a pas de système de combat (aucune unité n'attaque
une autre), donc les PV des murs/bâtiments ne bougent que via l'action
Détruire — ils ne peuvent pas encore être endommagés progressivement au
combat.
