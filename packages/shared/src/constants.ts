export const ROOM_CODE_PREFIX = 'PB-';
/** No look-alikes (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 8,
  playerNameMaxLength: 16,
  answerMaxLength: 30,
  minRounds: 3,
  maxRounds: 10,
  minCategories: 3,
  maxCategories: 10,
} as const;

/** Letters that are fair game in French (no K, Q, U, W, X, Y, Z). */
export const LETTERS = 'ABCDEFGHIJLMNOPRSTV'.split('');

export const ROUND_SECONDS_CHOICES = [60, 90, 120] as const;
/** Time left for everybody once someone calls "Bac !". */
export const STOP_COUNTDOWN_SECONDS = 10;
/** Time to review the answers (everybody can end it early). */
export const VOTE_SECONDS = 60;
/** Pause on the round results (everybody can end it early). */
export const RESULTS_SECONDS = 20;

export const POINTS_UNIQUE = 10;
export const POINTS_SHARED = 5;

export interface Category {
  readonly id: string;
  readonly label: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'prenom', label: 'Prénom' },
  { id: 'pays', label: 'Pays' },
  { id: 'ville', label: 'Ville' },
  { id: 'animal', label: 'Animal' },
  { id: 'fruit-legume', label: 'Fruit ou légume' },
  { id: 'metier', label: 'Métier' },
  { id: 'objet', label: 'Objet du quotidien' },
  { id: 'marque', label: 'Marque' },
  { id: 'film-serie', label: 'Film ou série' },
  { id: 'sport', label: 'Sport' },
  { id: 'couleur', label: 'Couleur' },
  { id: 'vetement', label: 'Vêtement' },
  { id: 'instrument', label: 'Instrument de musique' },
  { id: 'plat-boisson', label: 'Plat ou boisson' },
  { id: 'celebrite', label: 'Célébrité' },
  { id: 'corps', label: 'Partie du corps' },
  { id: 'cuisine', label: 'Dans une cuisine' },
  { id: 'chanteur', label: 'Chanteur ou groupe' },
  { id: 'jeu-video', label: 'Jeu vidéo' },
  { id: 'transport', label: 'Moyen de transport' },
  { id: 'plante', label: 'Fleur ou plante' },
  { id: 'metal-pierre', label: 'Matière ou pierre' },
  { id: 'dessin-anime', label: 'Personnage de dessin animé' },
  { id: 'mot-chanson', label: 'Mot dans une chanson' },
];

export const DEFAULT_CATEGORY_IDS = [
  'prenom',
  'pays',
  'animal',
  'fruit-legume',
  'metier',
  'objet',
] as const;
