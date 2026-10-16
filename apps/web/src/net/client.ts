import type { AckResult, GameSettings, RoomView, SessionInfo } from '@petitbac/shared';
import { errorMessage } from '../lib/messages';
import { setName, setSession, store, toast } from '../store/store';
import { createSocket, request, type ClientAck, type PetitBacSocket } from './socket';

export interface GameClient {
  readonly socket: PetitBacSocket;
  connect(): void;
  create(name: string): Promise<boolean>;
  join(code: string, name: string): Promise<boolean>;
  leave(): Promise<void>;
  updateSettings(
    patch: Partial<Pick<GameSettings, 'rounds' | 'categories' | 'roundSeconds'>>,
  ): Promise<void>;
  start(): Promise<void>;
  setAnswers(answers: Record<string, string>): void;
  bac(): Promise<boolean>;
  vote(categoryId: string, playerId: string, reject: boolean): Promise<void>;
  ready(ready: boolean): Promise<void>;
  again(): Promise<void>;
  kick(playerId: string): Promise<void>;
}

/** Connects the socket to the store and exposes the player's actions. */
export function createGameClient(socket: PetitBacSocket = createSocket()): GameClient {
  const fail = (result: ClientAck<unknown>): false => {
    if (!result.ok) toast(errorMessage(result.reason), 'error');
    return false;
  };

  const resume = async () => {
    const session = store.getState().session;
    if (!session) return;
    store.setState({ resuming: true });
    const result = await request<SessionInfo>(socket, 'room:resume', {
      sessionToken: session.sessionToken,
    });
    store.setState({ resuming: false });
    if (!result.ok && (result.reason === 'SESSION_EXPIRED' || result.reason === 'INVALID_PAYLOAD'))
      setSession(null);
  };

  socket.on('connect', () => {
    store.setState({ connection: 'online' });
    void resume();
  });
  socket.on('disconnect', () => store.setState({ connection: 'offline' }));
  socket.on('connect_error', () => store.setState({ connection: 'offline' }));
  socket.on('room:state', (view: RoomView) => {
    store.setState({ view, clockOffset: view.now - Date.now(), closed: null });
  });
  socket.on('room:closed', (reason) => {
    setSession(null);
    store.setState({ closed: reason });
  });

  const enter = async (result: ClientAck<SessionInfo>, name: string): Promise<boolean> => {
    if (!result.ok) return fail(result);
    setName(name);
    setSession(result.value);
    return true;
  };
  const simple = async (
    event: Parameters<typeof request>[1],
    ...args: unknown[]
  ): Promise<boolean> => {
    const result = await request<null>(socket, event, ...args);
    return result.ok ? true : fail(result);
  };

  return {
    socket,
    connect: () => {
      store.setState({ connection: 'connecting' });
      socket.connect();
    },
    create: async (name) =>
      enter(await request<SessionInfo>(socket, 'room:create', { playerName: name }), name),
    join: async (code, name) =>
      enter(await request<SessionInfo>(socket, 'room:join', { code, playerName: name }), name),
    leave: async () => {
      await request<null>(socket, 'room:leave');
      setSession(null);
    },
    updateSettings: async (patch) => void (await simple('settings:update', patch)),
    start: async () => void (await simple('game:start')),
    setAnswers: (answers) => {
      if (socket.connected)
        (socket as unknown as { emit(e: string, p: unknown): void }).emit('answers:set', {
          answers,
        });
    },
    bac: () => simple('round:bac'),
    vote: async (categoryId, playerId, reject) =>
      void (await simple('vote:set', { categoryId, playerId, reject })),
    ready: async (ready) => void (await simple('ready:set', { ready })),
    again: async () => void (await simple('game:again')),
    kick: async (playerId) => void (await simple('room:kick', { playerId })),
  };
}

export type { AckResult };
