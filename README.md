# M-nage 🧹

Application pour organiser le rangement de la maison avec tout le foyer. Elle est publiée sur GitHub Pages et s'installe sur l'écran d'accueil du téléphone comme une vraie application.

Adresse une fois publiée : **https://eresys21.github.io/m-nage/**

## Fonctionnalités

- **Membres du foyer** : ajout / suppression des prénoms (onglet « Foyer »).
- **Tâches** : ajout / suppression, attribution à une personne ou à tout le monde, nombre de points, date de rappel, répétition (aucune, chaque jour, chaque semaine).
- **Points** : chaque tâche cochée « ✓ » rapporte ses points à la personne choisie en haut de l'écran.
- **Classement hebdomadaire** : du lundi au dimanche, avec les semaines précédentes et l'historique des dernières tâches.
- **Rappels par notification** : à l'heure du rappel, la personne attribuée (ou tout le foyer) reçoit une notification sur son téléphone.

## Fonctionnement

| Élément | Rôle |
|---|---|
| GitHub Pages (`public/`) | L'application elle-même (page web installable) |
| Firebase Firestore | Les données partagées par tout le foyer |
| Firebase Cloud Messaging | L'envoi des notifications aux téléphones |
| GitHub Actions (`reminders.yml`) | Vérifie les rappels toutes les 15 minutes environ |

Tout reste dans les offres gratuites pour un usage familial, aux conditions suivantes :
- le dépôt GitHub doit être **public** (GitHub Pages et les minutes GitHub Actions illimitées ne sont gratuits que pour les dépôts publics, sauf abonnement GitHub Pro) ;
- Firebase reste sur l'offre gratuite « Spark ».

## Mise en place (une seule fois)

### 1. Créer le projet Firebase

1. Aller sur https://console.firebase.google.com et créer un projet (Google Analytics inutile).
2. **Authentication** → Commencer → Méthode de connexion → activer **Anonyme**.
3. **Firestore Database** → Créer une base de données → mode production → choisir une région européenne (ex. `eur3`).
4. Dans Firestore → onglet **Règles**, coller le contenu du fichier `firestore.rules` puis **Publier**.
5. ⚙️ **Paramètres du projet** → onglet **Général** → « Vos applications » → icône **Web `</>`** → donner un nom → copier les valeurs de `firebaseConfig` dans `public/firebase-config.js`.
6. ⚙️ **Paramètres du projet** → onglet **Cloud Messaging** → « Certificats Web Push » → **Générer une paire de clés** → copier la clé dans `vapidKey` de `public/firebase-config.js`.
7. ⚙️ **Paramètres du projet** → onglet **Comptes de service** → **Générer une nouvelle clé privée** : un fichier JSON est téléchargé. ⚠️ Ce fichier est secret : ne jamais l'ajouter au dépôt.

### 2. Configurer GitHub

1. **Settings → General → Danger Zone → Change visibility** → rendre le dépôt public.
2. **Settings → Pages** → Source : **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret** :
   nom `FIREBASE_SERVICE_ACCOUNT`, valeur : tout le contenu du fichier JSON de l'étape 1.7.
4. Enregistrer (commit) `public/firebase-config.js` rempli : la publication se lance automatiquement (onglet **Actions**).

### 3. Sur chaque téléphone

1. Ouvrir https://eresys21.github.io/m-nage/
2. L'ajouter à l'écran d'accueil :
   - **Android (Chrome)** : menu ⋮ → « Installer l'application » / « Ajouter à l'écran d'accueil ».
   - **iPhone (Safari, iOS 16.4 minimum)** : bouton Partager → « Sur l'écran d'accueil ». Sur iPhone, les notifications ne fonctionnent que depuis l'application ouverte depuis l'écran d'accueil.
3. Choisir son prénom en haut de l'écran.
4. Onglet « Foyer » → « Activer les notifications sur ce téléphone ».

## Limites

- Les rappels sont vérifiés toutes les 15 minutes environ ; GitHub peut retarder ces vérifications de quelques minutes en cas de forte charge.
- GitHub suspend les tâches planifiées d'un dépôt public sans activité depuis 60 jours : il suffit de les réactiver dans l'onglet **Actions**.
- Pas de mot de passe : toute personne qui connaît l'adresse peut modifier les tâches.
