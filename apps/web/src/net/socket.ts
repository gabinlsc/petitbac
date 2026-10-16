import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents } from '@petitbac/shared';

export type PetitBacSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ClientError = 'TIMEOUT' | 'OFFLINE';
export type ClientAck<T> = AckResult<T> | { readonly ok: false; readonly reason: ClientError };

export function createSocket(
  url: string | undefined = import.meta.env.VITE_SERVER_URL,
): PetitBacSocket {
  const options = { autoConnect: false, transports: ['websocket'] };
  return url ? io(url, options) : io(options);
}

/** Emits an event and resolves with the server ack (or a client-side error). */
export function request<T>(
  socket: PetitBacSocket,
  event: keyof ClientToServerEvents,
  ...args: unknown[]
): Promise<ClientAck<T>> {
  if (!socket.connected) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
  const timed = socket.timeout(5000) as unknown as {
    emit(event: string, ...rest: unknown[]): void;
  };
  return new Promise((resolve) => {
    timed.emit(event, ...args, (err: unknown, result: AckResult<T>) => {
      resolve(err ? { ok: false, reason: 'TIMEOUT' } : result);
    });
  });
}
