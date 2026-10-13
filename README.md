# M-nage 🧹

Application web (installable sur téléphone) pour organiser le rangement de la maison avec tout le foyer.

## Fonctionnalités

- **Membres du foyer** : ajout / suppression des prénoms (onglet « Foyer »).
- **Tâches** : ajout / suppression, attribution à une personne ou à tout le monde, nombre de points, date de rappel, répétition (aucune, chaque jour, chaque semaine).
- **Points** : chaque tâche cochée « ✓ » rapporte ses points à la personne qui l'a faite (celle choisie en haut de l'écran).
- **Classement hebdomadaire** : du lundi au dimanche, avec navigation vers les semaines précédentes et l'historique des dernières tâches.
- **Rappels par notification** : à l'heure du rappel, la personne attribuée (ou tout le foyer) reçoit une notification sur son téléphone. Les tâches répétées se reprogramment automatiquement une fois faites.

## Lancer l'application

Prérequis : Node.js 18 ou plus.

```bash
npm install
npm start
```

L'application est disponible sur `http://localhost:3000`.

Variables d'environnement facultatives :

| Variable        | Défaut                 | Rôle                                         |
|-----------------|------------------------|----------------------------------------------|
| `PORT`          | `3000`                 | Port HTTP                                    |
| `TZ`            | `Europe/Paris`         | Fuseau horaire (début de semaine le lundi)   |
| `DATA_DIR`      | `./data`               | Dossier des données (`db.json`, clés VAPID)  |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact transmis aux services de notification |

Les données sont stockées dans `data/db.json` ; les clés de notification sont générées automatiquement au premier lancement dans `data/vapid.json` (à conserver, sinon il faudra réactiver les notifications sur chaque téléphone).

## Utilisation sur les téléphones

Les notifications sur téléphone exigent que l'application soit servie en **HTTPS** (sauf `localhost`). Il faut donc l'héberger sur un serveur accessible par tous les téléphones du foyer avec un certificat HTTPS (par exemple un Raspberry Pi derrière un reverse proxy comme Caddy, ou un hébergeur Node.js).

Ensuite, sur chaque téléphone :

1. Ouvrir l'adresse de l'application.
2. L'ajouter à l'écran d'accueil :
   - **Android (Chrome)** : menu ⋮ → « Installer l'application » / « Ajouter à l'écran d'accueil ».
   - **iPhone (Safari, iOS 16.4 minimum)** : bouton Partager → « Sur l'écran d'accueil ». Sur iPhone, les notifications ne fonctionnent que depuis l'application ouverte depuis l'écran d'accueil.
3. Choisir son prénom en haut de l'écran.
4. Onglet « Foyer » → « Activer les notifications sur ce téléphone », puis « Envoyer une notification test » pour vérifier.

## Limites

- Pas de mot de passe : toute personne ayant l'adresse peut modifier les tâches. À héberger sur une adresse privée ou derrière une protection d'accès.
- Les rappels sont vérifiés chaque minute par le serveur, qui doit donc rester allumé.
