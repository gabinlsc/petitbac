import type { EntryStatus } from './engine';

export type Phase = 'LOBBY' | 'PLAY' | 'VOTE' | 'RESULTS' | 'GAME_OVER';

export interface GameSettings {
  readonly rounds: number;
  /** Category ids, in play order. */
  readonly categories: readonly string[];
  readonly roundSeconds: 60 | 90 | 120;
}

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly score: number;
  /** Has finished reviewing (VOTE) or is ready to go on (RESULTS). */
  readonly ready: boolean;
  /** Signed in with a profile (games.glsc.fr/profil). */
  readonly profile: boolean;
}

export interface RevealEntry {
  readonly playerId: string;
  readonly answer: string;
  /** What the server decided on its own: empty or wrong letter. Everything else can be reviewed. */
  readonly status: EntryStatus | 'review';
  /** How many players refuse it / how many could. */
  readonly rejects: number;
  readonly eligible: number;
  /** I refuse it. */
  readonly mine: boolean;
  /** Round result (RESULTS only). */
  readonly points?: number;
  readonly shared?: boolean;
}

export interface RevealCategory {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly RevealEntry[];
}

export interface RoomView {
  readonly code: string;
  readonly phase: Phase;
  readonly me: string;
  /** Server clock (epoch ms) when this view was built: lets clients correct their own clock for countdowns. */
  readonly now: number;
  readonly hostId: string;
  readonly players: readonly PlayerView[];
  readonly settings: GameSettings;
  /** 1-based, 0 in the lobby. */
  readonly round: number;
  readonly letter: string | null;
  /** Epoch ms when the current phase ends (round time, stop countdown, review, pause). */
  readonly deadline: number | null;
  /** Someone called "Bac !": the countdown is the stop countdown. */
  readonly stopBy: string | null;
  /** My own answers while playing (categoryId → text). */
  readonly myAnswers: Readonly<Record<string, string>>;
  /** Answers of everybody, once the round is over. */
  readonly reveal: readonly RevealCategory[] | null;
  /** Final standing (GAME_OVER): player ids, best first. */
  readonly ranking: readonly string[] | null;
}

export type LobbyError =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'NOT_HOST'
  | 'INVALID_PAYLOAD'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_IN_ROOM'
  | 'WRONG_PHASE'
  | 'INCOMPLETE'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'NAME_RESERVED';

export type AckResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: LobbyError };

export interface SessionInfo {
  readonly code: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: unknown, ack: (r: AckResult<SessionInfo>) => void) => void;
  'room:join': (payload: unknown, ack: (r: AckResult<SessionInfo>) => void) => void;
  'room:resume': (payload: unknown, ack: (r: AckResult<SessionInfo>) => void) => void;
  'room:leave': (ack?: (r: AckResult<null>) => void) => void;
  'settings:update': (payload: unknown, ack: (r: AckResult<null>) => void) => void;
  'game:start': (ack: (r: AckResult<null>) => void) => void;
  'answers:set': (payload: unknown, ack?: (r: AckResult<null>) => void) => void;
  'round:bac': (ack: (r: AckResult<null>) => void) => void;
  'vote:set': (payload: unknown, ack?: (r: AckResult<null>) => void) => void;
  'ready:set': (payload: unknown, ack?: (r: AckResult<null>) => void) => void;
  'game:again': (ack: (r: AckResult<null>) => void) => void;
  'room:kick': (payload: unknown, ack: (r: AckResult<null>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (view: RoomView) => void;
  'room:closed': (reason: 'kicked' | 'idle') => void;
}
