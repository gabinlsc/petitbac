# Petit Bac

Petit Bac multijoueur en temps réel, jouable dans le navigateur : [petitbac.glsc.fr](https://petitbac.glsc.fr).
Un jeu de [glsc.fr](https://glsc.fr), dans la [salle de jeux](https://games.glsc.fr).

## Règles

- 2 à 8 joueurs, un salon par partie (code `PB-XXXX`, lien d'invitation).
- À chaque manche : une **lettre** tirée au hasard (jamais deux fois la même dans une partie) et des **catégories** (6 par défaut, 3 à 10, choisies par l'hôte parmi 24).
- Chacun remplit ses cases avec des mots qui commencent par la lettre (un article devant est accepté : « l'éléphant » pour E). Les réponses restent **secrètes** tant que la manche dure.
- Le premier qui a rempli toutes ses cases crie **Bac !** : les autres ont 10 secondes pour finir. Sinon, la manche se termine au chrono (60, 90 ou 120 s).
- **Relecture** : tout le monde voit toutes les réponses et peut refuser les douteuses. Une réponse est refusée si **plus de la moitié des autres joueurs** la refusent. Mauvaise lettre ou case vide : zéro point, sans vote.
- **Points** : 10 pour une réponse valide unique, 5 si un autre joueur a donné la même (pluriel, accents, article et majuscules ignorés), 0 sinon.
- 3 à 10 manches, puis podium et possibilité de rejouer avec les mêmes joueurs.

## Développement

Prérequis : Node 22, pnpm.

```bash
pnpm install
pnpm dev        # serveur (3001) + client Vite (5173, /socket.io relayé vers le serveur)
pnpm check      # typecheck + lint + format + tests
pnpm build && pnpm start   # serveur de production sur le client compilé
```

| Dossier           | Contenu                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | constantes, catégories, schémas zod, protocole et **règles pures** (validation des réponses, doublons, scores) |
| `apps/server`     | Socket.IO : salons, phases et chronos côté serveur (rien n'est décidé par le client), résultats, profils       |
| `apps/web`        | client React (mobile d'abord), installable (PWA)                                                               |

Variables d'environnement du serveur : `PORT` (3001), `CORS_ORIGIN`, `STATIC_DIR` (client compilé), `RESULTS_FILE` (une partie terminée par ligne, JSON, lue par la sonde de glsc.fr pour les classements), `PROFILES_URL` (service de profils de games.glsc.fr ; absent = tout le monde est invité).

## Profils

Un joueur connecté à son profil ([games.glsc.fr/profil](https://games.glsc.fr/profil/)) joue sous le pseudo réservé de ce profil, et ses parties lui sont rattachées. Un invité ne peut pas prendre un pseudo réservé. Le serveur ne fait confiance qu'au service de profils (appel interne avec le cookie de la poignée de main WebSocket) ; sans lui, le jeu fonctionne normalement.

## Déploiement

Un conteneur Docker (`Dockerfile`) construit depuis ce dépôt par le script de déploiement de [portfolio](https://github.com/gabinlsc/portfolio) ; chaque push sur `main` met le serveur à jour.
