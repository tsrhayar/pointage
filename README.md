# Pointage — suivi des heures de travail

PWA 100 % statique (HTML, CSS, JS) pour pointer son entrée/sortie, suivre ses heures par jour et par semaine et son **solde cumulé** (« Tu dois rattraper 1 h 16 mn »).
**Aucun backend** : les données restent uniquement sur l'appareil (`localStorage`, clé `pointage.v1`).

## Lancer en local (Laragon)
1. Laragon → **Start All**
2. Ouvrir <http://localhost/pointage/>

## Fonctionnalités
- **Entrée / Sortie** en un clic, chrono en direct, plusieurs périodes par jour (les trous entre périodes = pauses).
- **Tableau de bord** : travaillé aujourd'hui / objectif, reste, **sortie estimée** pour atteindre l'objectif, **sortie pour solde à 0** (rattrape aussi le cumul), semaine en cours, solde cumulé au jour d'hier + « en sortant maintenant ».
- **Historique** par mois et par semaine : périodes, total, écart du jour, totaux semaine/mois. Toucher un jour pour l'éditer (ajouter/modifier/supprimer des périodes, oubli de pointage) ou le marquer **jour férié / congé / maladie / autre** (objectif 0, ou demi-journée).
- **Réglages** : objectif par jour (8h par défaut), jours travaillés (lun–ven), objectif hebdo optionnel (réparti sur les jours travaillés), objectif différent par jour, date de début du solde, **solde de départ** (ex. `-1h16` pour reprendre le chiffre des RH), arrondi des périodes (1/5/10/15/30 mn, plus proche/inférieur/supérieur), langue (FR / EN / العربية), thème (auto/clair/sombre).
- **Données** : sauvegarde/import JSON, export CSV (séparateur `;`, s'ouvre dans Excel).
- **PWA** : installable (bouton « Installer »), fonctionne hors ligne.

Formats de durée acceptés : `8`, `7h30`, `7:30`, `45mn`, `-1h16`. Un nombre seul ≤ 24 = heures (`40` pour l'hebdo = 40 h).

## Règles de calcul
- Objectif d'un jour = objectif par jour (ou hebdo ÷ nb de jours travaillés, ou objectif du jour de la semaine) ; 0 si jour non travaillé ou jour off ; moitié si demi-journée.
- Solde cumulé = solde de départ + Σ (travaillé − objectif) depuis la date de début, jusqu'à **hier inclus** (comme les messages RH « au 19 Nov au cumul »).
- Une période restée ouverte un jour précédent compte 0 jusqu'à ce qu'elle soit corrigée (un bandeau le signale).

## Fichiers
```
index.html               page unique
manifest.webmanifest     manifeste PWA (chemins relatifs, start_url/scope "./")
sw.js                    service worker (cache de l'app, hors ligne)
.htaccess                type MIME du manifeste + pas de cache pour sw.js (Apache/Laragon)
assets/css/style.css
assets/js/core.js        calculs purs (dates, objectifs, solde, formats, CSV)
assets/js/i18n.js        textes FR / EN / AR
assets/js/app.js         interface + stockage local
assets/icons/            icônes (favicon, 192, 512, maskable, apple-touch)
```

## Mise à jour / publication
- Tous les chemins sont relatifs : le dossier peut être publié tel quel sur GitHub Pages (ex. `https://<user>.github.io/pointage/`), Netlify, Cloudflare Pages…
- **Après toute modification** de HTML/CSS/JS/icônes, augmenter `VERSION` dans `sw.js` (`"v1"` → `"v2"`) pour que les apps installées récupèrent la nouvelle version. Les données (localStorage) ne sont jamais effacées par ce changement.

## Sauvegarde
Les données sont liées au navigateur et à l'adresse (localhost ≠ github.io). Effacer les données du navigateur efface les pointages : exporter régulièrement une **Sauvegarde JSON** (Réglages → Données).
