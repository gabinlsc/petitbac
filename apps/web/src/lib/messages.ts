import type { LobbyError } from '@petitbac/shared';
import type { ClientError } from '../net/socket';

export type ErrorReason = LobbyError | ClientError;

const MESSAGES: Record<ErrorReason, string> = {
  ROOM_NOT_FOUND: 'Salon introuvable. Vérifie le code.',
  ROOM_FULL: 'Ce salon est complet (8 joueurs).',
  GAME_IN_PROGRESS: 'La partie a déjà commencé.',
  NOT_HOST: 'Seul l’hôte peut faire ça.',
  INVALID_PAYLOAD: 'Données invalides.',
  NOT_ENOUGH_PLAYERS: 'Il faut au moins 2 joueurs connectés.',
  NOT_IN_ROOM: 'Tu n’es dans aucun salon.',
  WRONG_PHASE: 'Pas possible à ce moment-là.',
  INCOMPLETE: 'Remplis toutes les cases avec la bonne lettre avant de crier Bac !',
  RATE_LIMITED: 'Doucement !',
  SESSION_EXPIRED: 'Ta session a expiré.',
  NAME_RESERVED:
    'Ce pseudo appartient à un profil : connecte-toi (Mon profil) ou choisis-en un autre.',
  TIMEOUT: 'Le serveur ne répond pas.',
  OFFLINE: 'Connexion perdue, reconnexion en cours…',
};

export const errorMessage = (reason: ErrorReason): string => MESSAGES[reason];
