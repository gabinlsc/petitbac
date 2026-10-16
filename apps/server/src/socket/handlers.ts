import type { Server, Socket } from 'socket.io';
import {
  answersPayloadSchema,
  createRoomPayloadSchema,
  joinRoomPayloadSchema,
  kickPayloadSchema,
  readyPayloadSchema,
  resumePayloadSchema,
  settingsPatchSchema,
  votePayloadSchema,
  type AckResult,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@petitbac/shared';
import { guestsOnly, type Identify } from '../profiles';
import type { Room } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import { RateLimiter } from './rateLimiter';

export interface SocketData {
  sessionToken?: string;
}

export type PetitBacServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type PetitBacSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export const roomChannel = (code: string) => `room:${code}`;
export const playerChannel = (code: string, playerId: string) => `player:${code}:${playerId}`;

type AnyAck = (result: AckResult<unknown>) => void;
type Outcome = AckResult<unknown> | undefined;

/** Wires every client event to the room manager. All payloads are validated here. */
export function registerHandlers(
  io: PetitBacServer,
  manager: RoomManager,
  identify: Identify = guestsOnly,
): void {
  /** Live sockets per player: a player may briefly have two (reload, second tab). */
  const socketsByPlayer = new Map<string, Set<string>>();

  io.on('connection', (socket: PetitBacSocket) => {
    // Typing sends one event per keystroke batch: generous burst, steady refill.
    const limiter = new RateLimiter(60, 20);

    const reply = (ack: unknown, result: AckResult<unknown>) => {
      if (typeof ack === 'function') (ack as AnyAck)(result);
    };

    const on = <A extends unknown[]>(
      event: keyof ClientToServerEvents,
      handler: (args: A) => Outcome | Promise<Outcome>,
    ) => {
      socket.on(event, ((...raw: unknown[]) => {
        const ack = typeof raw[raw.length - 1] === 'function' ? raw.pop() : undefined;
        if (!limiter.take()) return reply(ack, { ok: false, reason: 'RATE_LIMITED' });
        const failed = (error: unknown) => {
          console.error(`[socket] ${event} failed`, error);
          reply(ack, { ok: false, reason: 'INVALID_PAYLOAD' });
        };
        try {
          const result = handler(raw as A);
          if (result instanceof Promise) result.then((v) => v && reply(ack, v), failed);
          else if (result) reply(ack, result);
        } catch (error) {
          failed(error);
        }
      }) as never);
    };

    /** Signed-in players play under their profile pseudo; guests cannot take a pseudo reserved by a profile. */
    const who = async (typed: string) => {
      const id = await identify(socket.handshake.headers.cookie, typed);
      if (id.pid && id.name) return { ok: true as const, name: id.name, pid: id.pid };
      if (!id.guestNameOk) return { ok: false as const, reason: 'NAME_RESERVED' as const };
      return { ok: true as const, name: typed, pid: undefined };
    };

    const current = () => manager.resolve(socket.data.sessionToken);

    const attach = (room: Room, playerId: string, token: string) => {
      detach();
      socket.data.sessionToken = token;
      void socket.join([roomChannel(room.code), playerChannel(room.code, playerId)]);
      const set = socketsByPlayer.get(playerId) ?? new Set<string>();
      set.add(socket.id);
      socketsByPlayer.set(playerId, set);
      room.connect(playerId);
    };

    /** Unbinds this socket from its room; returns the player if it was their last socket. */
    const detach = (): { room: Room; playerId: string; last: boolean } | undefined => {
      const ctx = current();
      const token = socket.data.sessionToken;
      delete socket.data.sessionToken;
      if (!ctx || !token) return undefined;
      void socket.leave(roomChannel(ctx.room.code));
      void socket.leave(playerChannel(ctx.room.code, ctx.playerId));
      const set = socketsByPlayer.get(ctx.playerId);
      set?.delete(socket.id);
      const last = !set || set.size === 0;
      if (last) socketsByPlayer.delete(ctx.playerId);
      return { ...ctx, last };
    };

    const withRoom =
      <A extends unknown[]>(fn: (room: Room, playerId: string, ...args: A) => AckResult<unknown>) =>
      (args: A): AckResult<unknown> => {
        const ctx = current();
        if (!ctx) return { ok: false, reason: 'NOT_IN_ROOM' };
        return fn(ctx.room, ctx.playerId, ...args);
      };

    on<[unknown]>('room:create', async ([payload]) => {
      const parsed = createRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
      const player = await who(parsed.data.playerName);
      if (!player.ok) return player;
      const session = manager.create(player.name, player.pid);
      const room = manager.getRoom(session.code);
      if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
      attach(room, session.playerId, session.sessionToken);
      return { ok: true, value: session };
    });

    on<[unknown]>('room:join', async ([payload]) => {
      const parsed = joinRoomPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
      const player = await who(parsed.data.playerName);
      if (!player.ok) return player;
      const joined = manager.join(parsed.data.code, player.name, player.pid);
      if (!joined.ok) return joined;
      const room = manager.getRoom(joined.value.code);
      if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
      attach(room, joined.value.playerId, joined.value.sessionToken);
      return joined;
    });

    on<[unknown]>('room:resume', ([payload]) => {
      const parsed = resumePayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
      const ctx = manager.resolve(parsed.data.sessionToken);
      if (!ctx) return { ok: false, reason: 'SESSION_EXPIRED' };
      attach(ctx.room, ctx.playerId, parsed.data.sessionToken);
      return {
        ok: true,
        value: {
          playerId: ctx.playerId,
          sessionToken: parsed.data.sessionToken,
          code: ctx.room.code,
        },
      };
    });

    on('room:leave', () => {
      const ctx = detach();
      if (!ctx) return { ok: true, value: null };
      // Leaving is explicit: other tabs of the same player leave too.
      io.in(playerChannel(ctx.room.code, ctx.playerId)).socketsLeave([
        roomChannel(ctx.room.code),
        playerChannel(ctx.room.code, ctx.playerId),
      ]);
      socketsByPlayer.delete(ctx.playerId);
      ctx.room.leave(ctx.playerId);
      return { ok: true, value: null };
    });

    on<[unknown]>(
      'settings:update',
      withRoom((room, playerId, patch: unknown) => {
        const parsed = settingsPatchSchema.safeParse(patch);
        if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
        return room.updateSettings(playerId, parsed.data);
      }),
    );

    on(
      'game:start',
      withRoom((room, playerId) => room.start(playerId)),
    );

    on<[unknown]>(
      'answers:set',
      withRoom((room, playerId, payload: unknown) => {
        const parsed = answersPayloadSchema.safeParse(payload);
        return parsed.success
          ? room.setAnswers(playerId, parsed.data.answers)
          : { ok: false, reason: 'INVALID_PAYLOAD' };
      }),
    );

    on(
      'round:bac',
      withRoom((room, playerId) => room.callBac(playerId)),
    );

    on<[unknown]>(
      'vote:set',
      withRoom((room, playerId, payload: unknown) => {
        const parsed = votePayloadSchema.safeParse(payload);
        return parsed.success
          ? room.vote(playerId, parsed.data.categoryId, parsed.data.playerId, parsed.data.reject)
          : { ok: false, reason: 'INVALID_PAYLOAD' };
      }),
    );

    on<[unknown]>(
      'ready:set',
      withRoom((room, playerId, payload: unknown) => {
        const parsed = readyPayloadSchema.safeParse(payload);
        return parsed.success
          ? room.setReady(playerId, parsed.data.ready)
          : { ok: false, reason: 'INVALID_PAYLOAD' };
      }),
    );

    on(
      'game:again',
      withRoom((room, playerId) => room.again(playerId)),
    );

    on<[unknown]>(
      'room:kick',
      withRoom((room, playerId, payload: unknown) => {
        const parsed = kickPayloadSchema.safeParse(payload);
        if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
        const result = room.kick(playerId, parsed.data.playerId);
        if (result.ok) {
          io.in(playerChannel(room.code, parsed.data.playerId)).socketsLeave([
            roomChannel(room.code),
            playerChannel(room.code, parsed.data.playerId),
          ]);
          socketsByPlayer.delete(parsed.data.playerId);
        }
        return result;
      }),
    );

    socket.on('disconnect', () => {
      const ctx = detach();
      if (ctx?.last) ctx.room.disconnect(ctx.playerId);
    });
  });
}
