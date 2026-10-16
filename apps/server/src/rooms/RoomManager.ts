import { randomUUID } from 'node:crypto';
import type { AckResult, SessionInfo } from '@petitbac/shared';
import { generateRoomCode } from './codes';
import type { ResultSink } from '../results';
import { Room, type RoomTimings, type RoomTransport } from './Room';

interface Session {
  readonly code: string;
  readonly playerId: string;
}

export interface RoomManagerOptions {
  readonly transportFor: (code: string) => RoomTransport;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly timings?: Partial<RoomTimings>;
  /** Receives every finished game (leaderboard). */
  readonly results?: ResultSink;
}

/** Registry of rooms and reconnection sessions. Payloads must be validated by the caller. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Session>();
  private readonly tokenByPlayer = new Map<string, string>();

  constructor(private readonly options: RoomManagerOptions) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Room and player behind a session token, if both are still alive. */
  resolve(token: string | undefined): { room: Room; playerId: string } | undefined {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    const room = this.rooms.get(session.code);
    if (!room || !room.hasPlayer(session.playerId)) return undefined;
    return { room, playerId: session.playerId };
  }

  create(playerName: string, pid?: string): SessionInfo {
    const code = generateRoomCode((c) => this.rooms.has(c));
    const room: Room = new Room({
      code,
      hostName: playerName,
      ...(pid ? { hostPid: pid } : {}),
      transport: this.options.transportFor(code),
      hooks: {
        onSeatRemoved: (playerId) => this.revoke(playerId),
        onDisposed: () => this.forget(room),
        ...(this.options.results ? { onGameFinished: this.options.results } : {}),
      },
      ...(this.options.random ? { random: this.options.random } : {}),
      ...(this.options.now ? { now: this.options.now } : {}),
      ...(this.options.timings ? { timings: this.options.timings } : {}),
    });
    this.rooms.set(code, room);
    return this.issue(code, room.hostPlayerId);
  }

  join(code: string, playerName: string, pid?: string): AckResult<SessionInfo> {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
    const joined = room.join(playerName, pid);
    if (!joined.ok) return joined;
    return { ok: true, value: this.issue(room.code, joined.value) };
  }

  dispose(): void {
    for (const room of [...this.rooms.values()]) room.dispose('idle');
  }

  private issue(code: string, playerId: string): SessionInfo {
    const sessionToken = randomUUID();
    this.sessions.set(sessionToken, { code, playerId });
    this.tokenByPlayer.set(playerId, sessionToken);
    return { playerId, sessionToken, code };
  }

  private revoke(playerId: string): void {
    const token = this.tokenByPlayer.get(playerId);
    if (token) this.sessions.delete(token);
    this.tokenByPlayer.delete(playerId);
  }

  private forget(room: Room): void {
    this.rooms.delete(room.code);
    for (const [token, session] of this.sessions) {
      if (session.code === room.code) {
        this.sessions.delete(token);
        this.tokenByPlayer.delete(session.playerId);
      }
    }
  }
}
