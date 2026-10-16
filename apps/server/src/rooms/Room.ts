import { randomUUID } from 'node:crypto';
import {
  CATEGORIES,
  DEFAULT_CATEGORY_IDS,
  LIMITS,
  RESULTS_SECONDS,
  STOP_COUNTDOWN_SECONDS,
  VOTE_SECONDS,
  answerStatus,
  cleanAnswer,
  pickLetter,
  scoreRound,
  type AckResult,
  type GameSettings,
  type LobbyError,
  type PlayerView,
  type RevealCategory,
  type RevealEntry,
  type RoomView,
  type RoundScores,
  type Phase,
} from '@petitbac/shared';
import type { GameRecord } from '../results';
import { uniqueName } from './codes';

export interface RoomTransport {
  /** Pushes this player's view of the room. */
  state(playerId: string, view: RoomView): void;
  /** The room is gone: tell everybody still attached. */
  closed(playerIds: readonly string[], reason: 'kicked' | 'idle'): void;
}

export interface RoomHooks {
  /** A seat is gone for good (left, kicked): its session must stop working. */
  onSeatRemoved?(playerId: string): void;
  onDisposed?(): void;
  onGameFinished?(record: GameRecord): void;
}

export interface RoomTimings {
  /** A room with nobody connected is closed after this long. */
  readonly idleTimeoutMs: number;
  readonly voteMs: number;
  readonly resultsMs: number;
  readonly stopMs: number;
}

const DEFAULT_TIMINGS: RoomTimings = {
  idleTimeoutMs: 5 * 60_000,
  voteMs: VOTE_SECONDS * 1000,
  resultsMs: RESULTS_SECONDS * 1000,
  stopMs: STOP_COUNTDOWN_SECONDS * 1000,
};

export interface RoomOptions {
  readonly code: string;
  readonly hostName: string;
  /** Profile id of the host, when signed in. */
  readonly hostPid?: string;
  readonly transport: RoomTransport;
  readonly hooks?: RoomHooks;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly timings?: Partial<RoomTimings>;
}

interface Member {
  readonly id: string;
  readonly name: string;
  readonly pid?: string;
  connected: boolean;
  /** Left for good during a game: kept for the standings, never in the results. */
  left: boolean;
  score: number;
  answers: Record<string, string>;
  ready: boolean;
}

type Result<T = null> = AckResult<T>;
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: LobbyError): Result<never> => ({ ok: false, reason });
const NONE: Result = ok(null);

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));
const voteKey = (categoryId: string, authorId: string) => `${categoryId}|${authorId}`;

/**
 * One lobby + one game: the authoritative state, the phase timers and a per-player projection pushed after every
 * change. Everything a player types stays on the server until the round is over (no copying from a neighbour).
 */
export class Room {
  readonly code: string;
  private readonly members: Member[] = [];
  private settings: GameSettings = {
    rounds: 5,
    categories: [...DEFAULT_CATEGORY_IDS],
    roundSeconds: 90,
  };
  private phase: Phase = 'LOBBY';
  private hostId: string;
  private round = 0;
  private letter: string | null = null;
  private readonly usedLetters: string[] = [];
  private deadline: number | null = null;
  private stopBy: string | null = null;
  /** Players who can review this round (connected when the review began). */
  private voters = new Set<string>();
  /** voteKey → players who refuse that answer. */
  private votes = new Map<string, Set<string>>();
  private scores: RoundScores | null = null;
  private ranking: string[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly transport: RoomTransport;
  private readonly hooks: RoomHooks;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly timings: RoomTimings;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.transport = options.transport;
    this.hooks = options.hooks ?? {};
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.hostId = this.addMember(options.hostName, options.hostPid).id;
  }

  // ── Queries ───────────────────────────────────────────────────────────
  get hostPlayerId(): string {
    return this.hostId;
  }
  get isEmpty(): boolean {
    return !this.members.some((m) => m.connected);
  }
  hasPlayer(id: string): boolean {
    return this.members.some((m) => m.id === id && !m.left);
  }
  currentPhase(): Phase {
    return this.phase;
  }

  // ── Seats ─────────────────────────────────────────────────────────────
  private addMember(name: string, pid?: string): Member {
    const taken = new Set(this.members.map((m) => m.name));
    const member: Member = {
      id: randomUUID(),
      name: uniqueName(name, taken),
      ...(pid ? { pid } : {}),
      connected: false,
      left: false,
      score: 0,
      answers: {},
      ready: false,
    };
    this.members.push(member);
    return member;
  }

  private active(): Member[] {
    return this.members.filter((m) => !m.left);
  }
  private find(id: string): Member | undefined {
    return this.members.find((m) => m.id === id && !m.left);
  }

  join(name: string, pid?: string): Result<string> {
    if (this.phase !== 'LOBBY') return fail('GAME_IN_PROGRESS');
    if (this.active().length >= LIMITS.maxPlayers) return fail('ROOM_FULL');
    const member = this.addMember(name, pid);
    this.broadcast();
    return ok(member.id);
  }

  connect(id: string): void {
    const m = this.find(id);
    if (!m) return;
    m.connected = true;
    this.clearIdle();
    this.reassignHost();
    this.broadcast();
  }

  disconnect(id: string): void {
    const m = this.find(id);
    if (!m) return;
    m.connected = false;
    this.reassignHost();
    this.afterPresenceChange();
    this.broadcast();
  }

  /** Explicit departure. */
  leave(id: string): void {
    const m = this.find(id);
    if (!m) return;
    if (this.phase === 'LOBBY') this.members.splice(this.members.indexOf(m), 1);
    else {
      m.left = true;
      m.connected = false;
    }
    this.hooks.onSeatRemoved?.(id);
    this.reassignHost();
    this.afterPresenceChange();
    this.broadcast();
  }

  kick(by: string, target: string): Result {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (this.phase !== 'LOBBY') return fail('WRONG_PHASE');
    const m = this.find(target);
    if (!m || m.id === by) return fail('INVALID_PAYLOAD');
    this.members.splice(this.members.indexOf(m), 1);
    this.hooks.onSeatRemoved?.(m.id);
    this.transport.closed([m.id], 'kicked');
    this.broadcast();
    return NONE;
  }

  private reassignHost(): void {
    const host = this.find(this.hostId);
    if (host?.connected) return;
    const next = this.active().find((m) => m.connected) ?? this.active()[0];
    if (next) this.hostId = next.id;
  }

  /** Somebody left or dropped: nobody waits for them, and an empty room is closed after a while. */
  private afterPresenceChange(): void {
    if (this.isEmpty) this.startIdle();
    if (this.phase === 'VOTE' || this.phase === 'RESULTS') this.advanceIfEveryoneReady();
  }

  // ── Lobby ─────────────────────────────────────────────────────────────
  updateSettings(
    by: string,
    patch: {
      readonly rounds?: number | undefined;
      readonly categories?: readonly string[] | undefined;
      readonly roundSeconds?: GameSettings['roundSeconds'] | undefined;
    },
  ): Result {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (this.phase !== 'LOBBY') return fail('WRONG_PHASE');
    this.settings = {
      rounds: patch.rounds ?? this.settings.rounds,
      categories: patch.categories ?? this.settings.categories,
      roundSeconds: patch.roundSeconds ?? this.settings.roundSeconds,
    };
    this.broadcast();
    return NONE;
  }

  start(by: string): Result {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (this.phase !== 'LOBBY') return fail('WRONG_PHASE');
    if (this.active().filter((m) => m.connected).length < LIMITS.minPlayers)
      return fail('NOT_ENOUGH_PLAYERS');
    this.usedLetters.length = 0;
    for (const m of this.members) m.score = 0;
    this.ranking = null;
    this.startRound(1);
    return NONE;
  }

  // ── Round: play ───────────────────────────────────────────────────────
  private startRound(n: number): void {
    this.round = n;
    this.letter = pickLetter(this.usedLetters, this.random);
    this.usedLetters.push(this.letter);
    this.stopBy = null;
    this.scores = null;
    this.votes = new Map();
    for (const m of this.members) {
      m.answers = {};
      m.ready = false;
    }
    this.phase = 'PLAY';
    this.setDeadline(this.now() + this.settings.roundSeconds * 1000, () => this.endPlay());
    this.broadcast();
  }

  /** The latest text of every field; categories of this round only. */
  setAnswers(id: string, answers: Readonly<Record<string, string>>): Result {
    const m = this.find(id);
    if (!m) return fail('NOT_IN_ROOM');
    if (this.phase !== 'PLAY') return fail('WRONG_PHASE');
    const clean: Record<string, string> = {};
    for (const cat of this.settings.categories) {
      const raw = answers[cat];
      if (typeof raw === 'string') clean[cat] = cleanAnswer(raw);
    }
    m.answers = clean;
    return NONE;
  }

  /** "Bac !": allowed once every field holds an answer that starts with the letter. */
  callBac(id: string): Result {
    const m = this.find(id);
    if (!m) return fail('NOT_IN_ROOM');
    if (this.phase !== 'PLAY' || this.stopBy) return fail('WRONG_PHASE');
    const letter = this.letter ?? '';
    const complete = this.settings.categories.every(
      (c) => answerStatus(m.answers[c] ?? '', letter) === 'ok',
    );
    if (!complete) return fail('INCOMPLETE');
    this.stopBy = id;
    const stopAt = this.now() + this.timings.stopMs;
    if (this.deadline === null || stopAt < this.deadline)
      this.setDeadline(stopAt, () => this.endPlay());
    this.broadcast();
    return NONE;
  }

  private endPlay(): void {
    if (this.phase !== 'PLAY') return;
    this.phase = 'VOTE';
    this.voters = new Set(
      this.active()
        .filter((m) => m.connected)
        .map((m) => m.id),
    );
    for (const m of this.members) m.ready = false;
    const nothingToReview = this.settings.categories.every((c) =>
      this.active().every((m) => answerStatus(m.answers[c] ?? '', this.letter ?? '') !== 'ok'),
    );
    if (nothingToReview) return this.finishVote();
    this.setDeadline(this.now() + this.timings.voteMs, () => this.finishVote());
    this.broadcast();
  }

  // ── Round: review ─────────────────────────────────────────────────────
  vote(id: string, categoryId: string, authorId: string, reject: boolean): Result {
    if (!this.find(id)) return fail('NOT_IN_ROOM');
    if (this.phase !== 'VOTE') return fail('WRONG_PHASE');
    const author = this.find(authorId);
    if (
      !author ||
      authorId === id ||
      !this.voters.has(id) ||
      !this.settings.categories.includes(categoryId)
    ) {
      return fail('INVALID_PAYLOAD');
    }
    if (answerStatus(author.answers[categoryId] ?? '', this.letter ?? '') !== 'ok')
      return fail('INVALID_PAYLOAD');
    const key = voteKey(categoryId, authorId);
    const set = this.votes.get(key) ?? new Set<string>();
    if (reject) set.add(id);
    else set.delete(id);
    this.votes.set(key, set);
    this.broadcast();
    return NONE;
  }

  setReady(id: string, ready: boolean): Result {
    const m = this.find(id);
    if (!m) return fail('NOT_IN_ROOM');
    if (this.phase !== 'VOTE' && this.phase !== 'RESULTS') return fail('WRONG_PHASE');
    m.ready = ready;
    this.broadcast();
    this.advanceIfEveryoneReady();
    return NONE;
  }

  private advanceIfEveryoneReady(): void {
    const present = this.active().filter((m) => m.connected);
    if (present.length === 0 || !present.every((m) => m.ready)) return;
    if (this.phase === 'VOTE') this.finishVote();
    else if (this.phase === 'RESULTS') this.nextRoundOrEnd();
  }

  private finishVote(): void {
    if (this.phase !== 'VOTE') return;
    const players = this.active().map((m) => m.id);
    const letter = this.letter ?? '';
    this.scores = scoreRound({
      letter,
      categories: this.settings.categories,
      players,
      answers: Object.fromEntries(this.active().map((m) => [m.id, m.answers])),
      rejectedBy: (cat, author) => {
        const refusers = this.votes.get(voteKey(cat, author));
        return refusers
          ? [...refusers].filter((v) => this.voters.has(v) && v !== author).length
          : 0;
      },
      eligibleFor: (author) => [...this.voters].filter((v) => v !== author).length,
    });
    for (const m of this.active()) m.score += this.scores.totals[m.id] ?? 0;
    for (const m of this.members) m.ready = false;
    this.phase = 'RESULTS';
    this.setDeadline(this.now() + this.timings.resultsMs, () => this.nextRoundOrEnd());
    this.broadcast();
  }

  private nextRoundOrEnd(): void {
    if (this.phase !== 'RESULTS') return;
    if (this.round >= this.settings.rounds) this.endGame();
    else this.startRound(this.round + 1);
  }

  // ── End ───────────────────────────────────────────────────────────────
  private endGame(): void {
    this.phase = 'GAME_OVER';
    this.clearTimer();
    this.deadline = null;
    this.letter = null;
    this.stopBy = null;
    const ordered = [...this.active()].sort((a, b) => b.score - a.score);
    this.ranking = ordered.map((m) => m.id);
    this.record(ordered);
    this.broadcast();
  }

  private record(ordered: readonly Member[]): void {
    if (!this.hooks.onGameFinished || ordered.length === 0) return;
    let rank = 0;
    let previous = Number.NaN;
    const players = ordered.map((m, i) => {
      if (m.score !== previous) rank = i + 1;
      previous = m.score;
      return {
        name: m.name,
        ...(m.pid ? { pid: m.pid } : {}),
        bot: false as const,
        rank,
        won: rank === 1,
        score: m.score,
      };
    });
    try {
      this.hooks.onGameFinished({
        v: 1,
        t: Math.floor(this.now() / 1000),
        game: 'petitbac',
        mode: 'online',
        rounds: this.settings.rounds,
        players,
      });
    } catch (e) {
      console.error('[petitbac] onGameFinished failed', e);
    }
  }

  /** Back to the lobby with the same people (those who dropped are dropped). */
  again(by: string): Result {
    if (by !== this.hostId) return fail('NOT_HOST');
    if (this.phase !== 'GAME_OVER') return fail('WRONG_PHASE');
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i];
      if (m && (m.left || !m.connected)) {
        this.members.splice(i, 1);
        this.hooks.onSeatRemoved?.(m.id);
      }
    }
    for (const m of this.members) {
      m.score = 0;
      m.answers = {};
      m.ready = false;
    }
    this.phase = 'LOBBY';
    this.round = 0;
    this.letter = null;
    this.ranking = null;
    this.scores = null;
    this.reassignHost();
    this.broadcast();
    return NONE;
  }

  // ── Timers ────────────────────────────────────────────────────────────
  private setDeadline(at: number, then: () => void): void {
    this.clearTimer();
    this.deadline = at;
    this.timer = setTimeout(then, Math.max(0, at - this.now()));
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private startIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.dispose('idle'), this.timings.idleTimeoutMs);
  }
  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  dispose(reason: 'kicked' | 'idle' = 'idle'): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.clearIdle();
    this.transport.closed(
      this.active().map((m) => m.id),
      reason,
    );
    this.hooks.onDisposed?.();
  }

  // ── Views ─────────────────────────────────────────────────────────────
  private broadcast(): void {
    if (this.disposed) return;
    for (const m of this.active()) if (m.connected) this.transport.state(m.id, this.viewFor(m.id));
  }

  viewFor(playerId: string): RoomView {
    const me = this.find(playerId);
    const players: PlayerView[] = this.active().map((m) => ({
      id: m.id,
      name: m.name,
      connected: m.connected,
      isHost: m.id === this.hostId,
      score: m.score,
      ready: m.ready,
      profile: m.pid !== undefined,
    }));
    return {
      code: this.code,
      phase: this.phase,
      me: playerId,
      now: this.now(),
      hostId: this.hostId,
      players,
      settings: this.settings,
      round: this.round,
      letter: this.letter,
      deadline: this.deadline,
      stopBy: this.stopBy,
      myAnswers: this.phase === 'PLAY' || this.phase === 'VOTE' ? { ...(me?.answers ?? {}) } : {},
      reveal: this.phase === 'VOTE' || this.phase === 'RESULTS' ? this.reveal(playerId) : null,
      ranking: this.ranking,
    };
  }

  private reveal(viewer: string): RevealCategory[] {
    const letter = this.letter ?? '';
    return this.settings.categories.map((categoryId) => ({
      id: categoryId,
      label: CATEGORY_LABEL.get(categoryId) ?? categoryId,
      entries: this.active().map((m): RevealEntry => {
        const answer = m.answers[categoryId] ?? '';
        const auto = answerStatus(answer, letter);
        const refusers = this.votes.get(voteKey(categoryId, m.id));
        const eligible = [...this.voters].filter((v) => v !== m.id).length;
        const scored = this.scores?.byPlayer[m.id]?.[categoryId];
        return {
          playerId: m.id,
          answer,
          status: scored
            ? scored.status
            : auto === 'ok'
              ? 'review'
              : auto === 'empty'
                ? 'empty'
                : 'wrong_letter',
          rejects: refusers
            ? [...refusers].filter((v) => this.voters.has(v) && v !== m.id).length
            : 0,
          eligible,
          mine: refusers?.has(viewer) ?? false,
          ...(scored ? { points: scored.points, shared: scored.shared } : {}),
        };
      }),
    }));
  }
}
