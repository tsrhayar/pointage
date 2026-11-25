# Pointage — suivi des heures de travail

PWA 100 % statique (HTML, CSS, JS) pour pointer son entrée/sortie, suivre ses heures par jour et par semaine et son **solde cumulé** (« Tu dois rattraper 1 h 16 mn »).
**Aucun backend** : les données restent uniquement sur l'appareil (`localStorage`, clé `pointage.v1`).

## Lancer en local (Laragon)
1. Laragon → **Start All**
2. Ouvrir <http://localhost/pointage/>

## Fonctionnalités
- **Entrée / Sortie** en un clic, chrono en direct, plusieurs périodes par jour (les trous entre périodes = pauses).
- **Tableau de bord** : travaillé aujourd'hui / objectif, reste, **sortie estimée** pour atteindre l'objectif, **sortie pour solde à 0** (rattrape aussi le cumul), semaine en cours, solde cumulé au jour d'hier + « en sortant maintenant ».
- **Historique** par mois et par semaine : périodes, total, écart du jour, totaux semaine/mois. Toucher un jour pour l'éditer (ajouter/modifier/supprimer des périodes, oubli de pointage) ou le marquer **jour férié / congé / maladie / télétravail / autre** (objectif 0, ou demi-journée ; le télétravail reste un jour travaillé, simple libellé).
- **Réglages** : objectif par jour (8h par défaut), jours travaillés (lun–ven), objectif hebdo optionnel (réparti sur les jours travaillés), objectif différent par jour, date de début du solde, **solde de départ** (ex. `-1h16` pour reprendre le chiffre des RH), arrondi des périodes (1/5/10/15/30 mn, plus proche/inférieur/supérieur), langue (FR / EN / العربية), thème (auto/clair/sombre), **jours fériés français** automatiques.
- **Données** : sauvegarde/import JSON, export CSV (séparateur `;`, s'ouvre dans Excel), **synchronisation QR** d'un appareil vers un autre (sans serveur).
- **Horaires de prière** (v1.4.2) : carte du jour pour Marrakech (Fajr, Chourouk, Dhuhr, Asr, Maghrib, Isha), calculés hors ligne selon la méthode du ministère des Habous, à la minute près toute l'année. Le tableau officiel publié (oct.–nov. 2026) reste une priorité quand la date est couverte. Compte à rebours, compteur « منذ » pendant 30 min, cases **Afficher sur mobile** / **Afficher sur PC** (indépendantes, conservées après synchro).
- **PWA** : installable (bouton « Installer »), fonctionne hors ligne, raccourcis d'icône **Pointer** et **Voir solde**.

Formats de durée acceptés : `8`, `7h30`, `7:30`, `45mn`, `-1h16`. Un nombre seul ≤ 24 = heures (`40` pour l'hebdo = 40 h).

## Règles de calcul
- Objectif d'un jour = objectif par jour (ou hebdo ÷ nb de jours travaillés, ou objectif du jour de la semaine) ; 0 si jour non travaillé ou jour off ; moitié si demi-journée.
- Solde cumulé = solde de départ + Σ (travaillé − objectif) depuis la date de début, jusqu'à **hier inclus** (comme les messages RH « au 19 Nov au cumul »).
- Une période restée ouverte un jour précédent compte 0 jusqu'à ce qu'elle soit corrigée (un bandeau le signale).

## Fichiers
```
index.html               page unique
manifest.webmanifest     manifeste PWA (chemins relatifs, start_url/scope "./", id "/pointage/")
sw.js                    service worker (cache de l'app, hors ligne)
.htaccess                type MIME du manifeste + pas de cache pour sw.js (Apache/Laragon)
assets/css/style.css
assets/js/core.js        calculs purs (dates, objectifs, solde, formats, CSV)
assets/js/prayer-marrakech.js  tableau officiel Habous Marrakech (1er oct. – 30 nov. 2026)
assets/js/prayer.js      horaires de prière (méthode Habous + tableau officiel en priorité)
assets/js/i18n.js        textes FR / EN / AR
assets/js/sync.js        compression, QR (découpage, somme de contrôle, fusion)
assets/js/vendor/        lz-string, qrcode-generator, jsQR (hors ligne, pas de CDN)
assets/js/app.js         interface + stockage local
assets/icons/            icônes (favicon, 192, 512, maskable, apple-touch)
```

## Mise à jour / publication
- Tous les chemins sont relatifs : le dossier peut être publié tel quel sur GitHub Pages (ex. `https://<user>.github.io/pointage/`), Netlify, Cloudflare Pages…
- **Après toute modification** de HTML/CSS/JS/icônes, augmenter `VERSION` dans `sw.js` (`"v9"` → `"v10"`, …) pour que les apps installées récupèrent la nouvelle version. Les données (localStorage) ne sont jamais effacées par ce changement.


## Identifiant PWA (v1.3.2)

L'`id` du manifeste est désormais `/pointage/` (au lieu de `./`). Chrome résout `id` par rapport à l'origine de `start_url` : `"./"` devenait `https://tsrhayar.github.io/` et entrait en collision avec une autre app du même domaine (Rakaat). `start_url` et `scope` restent inchangés. Après mise à jour, réinstalle l'app bureau si elle ouvre encore la mauvaise app.

## Sauvegarde
Les données sont liées au navigateur et à l'adresse (localhost ≠ github.io). Effacer les données du navigateur efface les pointages : exporter régulièrement une **Sauvegarde JSON** (Réglages → Données).

## Message RH → solde (v1.1)
Bouton **📋 Coller message RH** (écran Aujourd'hui, carte « Solde cumulé », et Réglages). Colle un ou plusieurs messages, même avec le bruit du chat (nom, heures, liens, puces) :
> au 19 Nov au cumul, tu dois rattraper 1 h 16 mn

- Seul le message **le plus récent par date** est pris (même date deux fois → le dernier du texte). Année = année en cours, ou l'année précédente si la date serait dans le futur.
- Formulations reconnues : *tu dois rattraper / retard / manque* (négatif), *dépassement / en avance / en plus / de plus* (positif), *à jour* (0). Durées : `1 h 16 mn`, `1h16`, `58 mn`, `2 h`, `45 minutes`. Mois : `Nov`, `nov.`, `novembre`, `Déc`…
- Un aperçu s'affiche avant d'appliquer. Appliquer = **ancre** : solde au 19 nov = −1 h 16 mn, date de début = 20 nov, solde de départ = −1h16. L'historique est conservé. L'ancre (date, valeur, texte d'origine) est affichée sur le tableau de bord et dans les Réglages ; modifier à la main la date de début ou le solde de départ la retire.

## Plan de récupération (v1.1)
Quand le solde cumulé est négatif, une carte **Plan de récupération** répartit le retard :
- **Jusqu'à la fin du mois** / **Jusqu'à la fin de la semaine** (jours travaillés restants, jours off exclus), ou **Jours choisis** (sélecteur sur 5 semaines, samedi possible), ou **Désactivé**.
- Option **Inclure aujourd'hui (si pas terminé)**. Répartition en minutes entières, le reste va aux premiers jours (76 mn sur 6 jours → 13,13,13,13,12,12).
- Pour chaque jour : minutes en plus, et une ligne explicite **entrée · pauses · sortie ≈** (`sortie ≈ entrée + objectif + pauses`).
- Par défaut, l'entrée et le total des pauses viennent du **dernier jour travaillé**. Tu peux fixer une **Entrée prévue** et des **Pauses prévues** pour tout le plan, ou toucher un jour pour un réglage manuel (badge **manuel**). « Auto (dernier jour) » les recalcule ; tant que tu ne reviens pas à l'auto, les valeurs manuelles restent enregistrées (rechargement, sauvegarde JSON, synchro).
- **Aujourd'hui** : si tu as déjà pointé, l'estimation utilise la vraie entrée et les pauses déjà prises, plus le reste de pause prévue si tu en as fixé une ; sinon, les horaires prévus/auto. Ces horaires ne changent pas le solde.
- La **sortie estimée** du tableau de bord inclut le plan du jour.
- Le mode choisi et les horaires manuels sont mémorisés.

## Horaires manuels du plan (v1.3.1)

Sur le plan de récupération, l'heure de sortie n'est plus une boîte noire : chaque jour affiche l'entrée et les pauses utilisées. Tu règles une valeur par défaut pour tout le plan, ou jour par jour, et tu reviens à **Auto (dernier jour)** quand tu veux. Voir la section Plan de récupération ci-dessus.

## Synchroniser deux appareils (v1.2)

Les données restent liées au navigateur et à l'adresse (localhost ≠ github.io) : le téléphone et le PC ne se parlent pas tout seuls. Bouton **⇅ Synchroniser** (en-tête, et Réglages → Données). Sur les deux appareils, ouvre la même app (idéalement la même adresse, par ex. `https://tsrhayar.github.io/pointage/` une fois en ligne). **Seul le téléphone scanne** ; le PC n'utilise jamais de caméra.

Choisis le **sens** :

- **PC → Mobile** — le PC affiche un (ou plusieurs) QR ; tu le scanne avec le téléphone. S'il y a plusieurs QR, la séquence défile toute seule (l'ordre n'a pas d'importance).
- **Mobile → PC** — le téléphone envoie le code avec **Partager le code** (API de partage du système : WhatsApp, Mail, Messages… ; sinon le code est copié). Sur le PC, colle le code (**Ctrl+V**) et valide. Le PC n'a pas besoin de webcam.

Un aperçu s'affiche avant d'appliquer (nombre de jours/périodes, plage de dates, dernier message RH). **Remplacer les données** (recommandé, par défaut) écrase les données de l'appareil qui reçoit. **Fusionner** garde, pour chaque jour, la version la plus récente ; les réglages de l'appareil qui reçoit restent inchangés. Une sauvegarde automatique permet d'**Annuler la dernière synchro** une fois (Réglages → Données).

La caméra du téléphone exige une page en **HTTPS** (GitHub Pages convient) ou en **localhost**. Aucun serveur n'est utilisé : le code ne quitte les appareils que via le QR, le partage ou le presse-papiers. Si l'écran affiché n'est pas le bon (PC/téléphone mal détecté), un lien **Je suis sur le PC** / **Je suis sur le téléphone** permet de basculer.


## Jours spéciaux et jours fériés de France (v1.3)

Depuis l'historique (bouton **Jours spéciaux**) ou les Réglages, tu peux marquer un jour ou une **période** (ex. congé du 22 au 26 déc.) :

- **Congé**, **Férié**, **Maladie** : l'objectif du jour passe à 0 (ou à la moitié pour une **demi-journée de congé**), le solde n'est pas pénalisé.
- **Télétravail** : simple libellé, l'objectif et le pointage restent normaux.
- Un badge apparaît dans l'historique.

Les **jours fériés officiels de la France** (pas du Maroc) sont calculés hors ligne : 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre. Le lundi de Pâques, l'Ascension (et le lundi de Pentecôte, optionnel) suivent la date de Pâques (computus).

- Réglage **Appliquer automatiquement les jours fériés français** (activé par défaut).
- Case **Lundi de Pentecôte** (désactivée par défaut : c'est souvent une journée de solidarité travaillée).
- Case **Alsace-Moselle** (Vendredi saint et 26 décembre), désactivée par défaut.
- Tu peux **travailler un jour férié** (le désactiver pour cette date) ou le remettre ensuite. Un jour saisi à la main remplace le férié automatique.
- Le **plan de récupération** saute les fériés, congés et jours de maladie (pas le télétravail).

## Comparaison avec le message RH (v1.3)

Quand tu colles un nouveau message RH, l'app calcule **son propre solde à cette date** (à partir des pointages, et d'une ancre précédente si elle est plus ancienne) **avant** d'appliquer le chiffre RH. Exemple :

> Calcul de l'app au 19 nov. : −1 h 10 mn — RH : −1 h 16 mn — écart 6 mn

Le bandeau est **vert** si les deux chiffres sont d'accord (à 1 mn près), **orange** sinon. Tu choisis alors **Appliquer** (prendre le chiffre RH comme ancre) ou **Garder mon calcul** (rien ne change au solde). Les dernières comparaisons sont conservées (Réglages).

## Raccourcis PWA (v1.3)

Après installation, un appui long sur l'icône de l'app propose :

- **Pointer** — pointe l'entrée ou la sortie selon l'état du jour, puis affiche une confirmation avec l'heure. L'adresse `./?action=punch` est retirée tout de suite (`history.replaceState`) pour éviter un second pointage si la page est rechargée.
- **Voir solde** — ouvre l'app et affiche le solde cumulé (`./?action=balance`).

## Horaires de prière — Marrakech (v1.4.2)

Sur l'écran **Aujourd'hui**, une carte compacte affiche les horaires du jour : **Fajr, Chourouk, Dhuhr, Asr, Maghrib, Isha**.

- **Calcul hors ligne (v1.4.2)** : pour le préréglage Marrakech, les horaires sont calculés selon la méthode du **ministère des Habous et des Affaires islamiques** (la même convention que les applications qui retrouvent le tableau officiel sans réseau, p. ex. Salat First) :
  - soleil apparent de Meeus (nutation complète, équation du temps du ch. 28), itéré à l'instant de chaque prière ;
  - Fajr 19°, Isha 17° (altitudes vraies) ; Asr chaféite sur le soleil apparent (ombre de midi, réfraction de Sæmundsson à midi et de Bennett à l'Asr) ;
  - Dhuhr = transit + 5 min ; Chourouk 1 min avant, et Maghrib 1,8 min après, le soleil à l'altitude −(34′ + semi-diamètre) moins la dépression d'horizon de la ville (est au lever, ouest au Maghrib) ;
  - Fajr arrondi à la minute inférieure, les autres à la minute la plus proche ;
  - horloge du ministère : **GMT+1 jusqu'au 16 septembre 2026 inclus, GMT à partir du 17 septembre 2026** (les horloges légales n'ont basculé que le 20 septembre) ;
  - point de calcul de Marrakech : **31,6283° N, 8,0332° O**, dépressions 0,828° (est) et 0,808° (ouest). L'écran des réglages garde les coordonnées d'affichage 31,6295° N, 7,9811° O.
- **Écart avec le tableau officiel** : 0 minute (max et moyenne) pour les 6 horaires, sur les **61 jours** encore publiés (1er octobre – 30 novembre 2026, 2 mois). Les mois plus anciens n'étaient plus en ligne sur habous.gov.ma (404) au 25 nov. 2026. La mention « calcul approximatif » a été retirée.
- **Tableau officiel en priorité** : les fichiers [horaires-2026-10.js](https://www.habous.gov.ma/data/horaires-2026-10.js) et [horaires-2026-11.js](https://www.habous.gov.ma/data/horaires-2026-11.js) (ville **104**, مراكش, `fuseau: GMT`), récupérés le **25 nov. 2026**, restent intégrés dans `assets/js/prayer-marrakech.js` et sont utilisés tels quels quand la date est couverte. Ailleurs, le même calcul sert pour n'importe quel jour de l'année. D'autres coordonnées utilisent la même méthode, avec les dépressions par défaut au niveau de la mer.
- La **prochaine prière** est mise en évidence, avec un compte à rebours (`dans 12:05`). Pendant les **30 minutes** qui suivent l'heure d'une prière, la carte affiche un compteur « **منذ** 2:35 » et met cette prière en évidence ; ensuite elle repasse au compte à rebours vers la suivante. Chourouk n'est pas une prière : il apparaît dans la liste et le compte à rebours, mais ne déclenche pas le compteur « منذ ».
- Dans **Réglages → Affichage** : deux cases indépendantes, **Afficher sur mobile** et **Afficher sur PC** (activées par défaut), plus des champs facultatifs de latitude / longitude (bouton **Reprendre Marrakech**). Un appareil est traité comme *mobile* si l'user-agent indique un téléphone, ou si le pointeur principal est tactile (`pointer: coarse`), ou si la largeur de la fenêtre est < 768 px ; sinon c'est un *PC*. Le test est fait **sur l'appareil lui-même** : après une synchro PC ↔ mobile, les deux drapeaux voyagent dans `settings.prayer`, mais chaque appareil n'applique que le sien. L'ancien réglage unique `show` est migré (les deux cases prennent sa valeur).
