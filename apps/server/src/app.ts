import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import type { Identify } from './profiles';
import type { ResultSink } from './results';
import { RoomManager } from './rooms/RoomManager';
import type { RoomTimings } from './rooms/Room';
import { playerChannel, registerHandlers, type PetitBacServer } from './socket/handlers';
import { createStaticHandler } from './static';

export interface PetitBacServerOptions {
  readonly corsOrigins: readonly string[];
  readonly random?: () => number;
  readonly now?: () => number;
  readonly timings?: Partial<RoomTimings>;
  /** Directory of the built web client to serve (production). */
  readonly staticDir?: string;
  /** Receives every finished game (leaderboard of games.glsc.fr). */
  readonly results?: ResultSink;
  /** Who is behind a connection (games.glsc.fr profiles). Default: everyone is a guest. */
  readonly identify?: Identify;
}

export interface PetitBacServerInstance {
  readonly httpServer: HttpServer;
  readonly io: PetitBacServer;
  readonly manager: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export function createPetitBacServer(options: PetitBacServerOptions): PetitBacServerInstance {
  // Transports resolve `io` lazily: rooms are only created once the server is up.
  const manager = new RoomManager({
    transportFor: (code) => ({
      state: (playerId, view) => io.to(playerChannel(code, playerId)).emit('room:state', view),
      closed: (playerIds, reason) => {
        for (const playerId of playerIds) {
          io.to(playerChannel(code, playerId)).emit('room:closed', reason);
          io.in(playerChannel(code, playerId)).socketsLeave([playerChannel(code, playerId)]);
        }
      },
    }),
    ...(options.random ? { random: options.random } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.timings ? { timings: options.timings } : {}),
    ...(options.results ? { results: options.results } : {}),
  });

  const serveStatic = options.staticDir ? createStaticHandler(options.staticDir) : null;

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', rooms: manager.roomCount }));
      return;
    }
    const notFound = () => {
      if (res.headersSent) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    };
    if (!serveStatic) return notFound();
    serveStatic(req, res).then(
      (served) => {
        if (!served) notFound();
      },
      () => notFound(),
    );
  });

  const io: PetitBacServer = new Server(httpServer, {
    cors: { origin: [...options.corsOrigins] },
    maxHttpBufferSize: 16 * 1024,
  });
  registerHandlers(io, manager, options.identify);

  return {
    httpServer,
    io,
    manager,
    listen: (port) =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => resolve((httpServer.address() as AddressInfo).port));
      }),
    close: async () => {
      manager.dispose();
      await io.close();
    },
  };
}
