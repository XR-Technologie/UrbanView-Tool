# Urbanview 360 XR — Studio de visites virtuelles

Créez des visites 360° immersives : importez vos photos équirectangulaires, reliez-les, réglez la vue d'arrivée de chaque passage, publiez ou exportez.

## Démarrage

Prérequis : **Node.js 22.13+** (testé avec Node 24).

```bash
npm install          # une seule fois
npm run dev          # développement → http://localhost:5173 (API sur :3360)
```

Production (un seul serveur, interface + API + médias) :

```bash
npm run build
npm start            # → http://localhost:3360
```

Variables d'environnement : `PORT` (3360), `HOST` (0.0.0.0), `UV_DATA_DIR` (./data).

## Utilisation

| Action | Comment |
|---|---|
| Importer | Glisser-déposer les photos 360° dans l'éditeur, ou **+** dans la colonne de gauche |
| Créer un lien | Outil **Lien** (`L`) puis clic dans la photo → choisir la destination |
| Vue d'arrivée | Dans le panneau du lien, orienter la mini-vue 360 (enregistré automatiquement) |
| Vues de départ d'une scène | Sans sélection : liste « Par défaut » + une vue par scène de provenance |
| Lien retour | Bouton **Retour** du lien (crée le lien inverse) |
| Point info | Outil **Info** (`I`) |
| Déplacer un point | Le glisser dans la photo |
| Supprimer | `Suppr` sur le point sélectionné |
| Réordonner | Glisser les vignettes de la colonne de gauche |

**Vue d'arrivée automatique** : si la scène de destination contient un lien retour, on arrive
dos à ce lien — on regarde dans le sens de la marche. Sinon, on utilise la vue par défaut de la scène.

## Publication

- **Lien en ligne** : `/tour/<id>` (bouton *Aperçu*) une fois le serveur déployé.
- **Export ZIP** : lecteur autonome + photos. À déposer sur n'importe quel hébergement web
  (le fichier ne fonctionne pas en double-cliquant, car les navigateurs bloquent WebGL en `file://`).
  Test local : `npx serve` dans le dossier décompressé.

## Architecture

```
server/   Fastify · SQLite (node:sqlite) · sharp · archiver
  src/routes.ts   API REST (visites, médias, export)
  src/media.ts    optimisation : full 8192 / mid 4096 / low 1536 / vignette
web/      React · TypeScript · Vite
  src/engine/     moteur WebGL2 maison (projection, transitions, petite planète, chargement progressif)
  src/pages/      Tableau de bord · Éditeur · Lecteur
  player.html     point d'entrée du lecteur exporté
data/     base SQLite + médias (créé au premier lancement)
legacy/   première version mono-fichier
```
