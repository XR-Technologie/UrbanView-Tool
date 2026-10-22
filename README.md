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

Logiciel Windows (.exe, Electron) :

```bash
npm run desktop:install   # une seule fois
npm run desktop:start     # tester l'application de bureau
npm run desktop:exe       # → desktop/release/ (installateur + version portable)
```

L'application de bureau embarque le serveur ; les visites sont stockées dans
`%APPDATA%\Urbanview 360 XR\data` (Linux : `~/.config/Urbanview 360 XR/data`).

**Linux (.deb / AppImage)** : à fabriquer sous Linux (sharp doit être la version Linux).
- Automatique : onglet **Actions** du dépôt GitHub → « Logiciel de bureau » → *Run workflow*
  (ou pousser un tag `v1.0.0` pour créer une Release avec .deb, .AppImage et .exe).
- Manuel sur une machine Ubuntu : `npm ci && npm ci --prefix desktop && npm run build && npm run dist:linux --prefix desktop`
- Installation : `sudo apt install ./urbanview-360-xr_1.0.0_amd64.deb`

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

### Retouche (bouton pinceau ou `R`)

| Outil | Usage |
|---|---|
| **Effacer** (`E`) | Peindre sur un objet (trépied, poubelle, câble…) : il est remplacé par la texture environnante (PatchMatch multi-échelle) |
| **Flouter** (`B`) | Peindre sur un visage ou une plaque : flou gaussien, intensité réglable |
| **Vue** (`H` ou Espace maintenu) | Tourner / zoomer pour cadrer la zone |
| **Sol** | Vue plongeante au nadir, idéale pour le trépied |

La retouche se fait dans la vue (sans déformation), puis est reprojetée dans le panorama.
`Ctrl+Z` annule, `[` / `]` change la taille du pinceau. À l'enregistrement, la photo d'origine
est conservée et peut être restaurée (bouton **Original**).

### Carte & Google Street View

| Action | Comment |
|---|---|
| Positionner | Bouton **Carte** → outil épingle → clic sur la carte (enchaîne sur la photo suivante). GPS EXIF lu automatiquement à l'import |
| Orienter | Panneau de la photo → **Nord ici** (en vue 360, regarder vers le nord) ou curseur **Cap**. *Auto* = déduit des ponts |
| Ponts | Outil chaîne : cliquer deux photos → points de passage créés dans les deux 360 ; baguette = relier auto (≤ 40 m) ; clic sur un pont = supprimer |
| Publier | Icône globe → identifiants Google → **Se connecter** → **Publier sur Street View** |

Prérequis Google (une fois) : dans la [console Google Cloud](https://console.cloud.google.com/),
activer l'API **Street View Publish**, configurer l'écran de consentement OAuth (ajouter votre compte
comme utilisateur test), puis créer un identifiant OAuth de type **Application de bureau**.
Photos ≥ 7,5 Mpx au format 2:1. Le bouton **Ponts** met à jour positions, caps et connexions sans renvoyer les photos.

**Vue d'arrivée automatique** : si la scène de destination contient un lien retour, on arrive
dos à ce lien — on regarde dans le sens de la marche. Sinon, on utilise la vue par défaut de la scène.

### Relevé sur téléphone (positions exactes sans GPS)

En intérieur, le GPS des photos est souvent faux. L'appli **Relevé 360** (téléphone Android, réalité augmentée)
mesure sur place la position de chaque emplacement du trépied et la direction de l'objectif, à quelques
centimètres près. Dans le studio, on cale **un seul point** sur la carte : toutes les photos suivent.

**Installer l'appli** : elle est publiée automatiquement sur GitHub Pages (workflow « Appli de relevé » ;
une seule fois : *Settings → Pages → Source = GitHub Actions*). Ouvrir l'adresse dans **Chrome Android**
(appareil compatible ARCore / « Google Play Services for AR »), puis menu ⋮ → *Ajouter à l'écran d'accueil*.
Elle fonctionne ensuite hors ligne.

**Sur place** (à chaque emplacement, avant ou après la prise de vue) :
1. **＋** : viser au sol le pied du trépied.
2. **↑** : viser le sol un ou deux mètres devant l'objectif (✕ pour passer).
3. Marcher normalement jusqu'au point suivant, sans masquer la caméra du téléphone.

Si la réalité augmentée s'interrompt (appel, écran éteint…), **Continuer** demande de re-viser les
2 derniers points pour recaler la suite. Fin : **Envoyer** (Drive, e-mail, WhatsApp…) ou ⬇ pour le fichier `.uvplan`.

**Dans le studio**, onglet **Plan** :
| Action | Comment |
|---|---|
| Importer | **Importer un relevé**, ou glisser le `.uvplan` dans l'éditeur — les photos sont reliées aux points automatiquement (ordre des heures de prise de vue) |
| Corriger une liaison | Cliquer un point puis une photo de la colonne de gauche, ou glisser la photo sur le point |
| Objectif | Écart entre l'objectif et le centre du panorama (0° pour la plupart des caméras) |
| Caler | **Caler le point N** → cliquer son emplacement sur la carte. Glisser ensuite n'importe quelle autre photo du relevé pour régler la rotation (curseur **Rotation** pour affiner) |
| Ponts du parcours | Crée les passages entre points successifs, orientés grâce aux caps relevés |

Test sans GitHub : `npm run dev`, téléphone en USB, `adb reverse tcp:5173 tcp:5173`, puis ouvrir
`http://localhost:5173/capture.html` dans Chrome Android. Build local : `npm run build:capture` → `web/dist-capture/`.

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
  src/plan.ts     relevé .uvplan : format, liaison photos ↔ points, calage géographique
  src/capture/    appli de relevé téléphone (WebXR, PWA)
  player.html     point d'entrée du lecteur exporté
  capture.html    point d'entrée de l'appli de relevé
data/     base SQLite + médias (créé au premier lancement)
legacy/   première version mono-fichier
```
