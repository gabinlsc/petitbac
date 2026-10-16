import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  AckResult,
  ClientToServerEvents,
  RoomView,
  ServerToClientEvents,
  SessionInfo,
} from '@petitbac/shared';
import { createPetitBacServer, type PetitBacServerInstance } from '../src/app';
import { createIdentify } from '../src/profiles';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const PID = '0123456789abcdef';

/** Stand-in for the profiles service: cookie "glsc_sid=GOOD…" is Gabin; the pseudo "gabin" is reserved. */
function fakeProfiles(): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw) as { cookie: string; name: string };
      const out = body.cookie.includes('glsc_sid=GOOD')
        ? { pid: PID, name: 'Gabin' }
        : { pid: null, guestNameOk: body.name.toLowerCase() !== 'gabin' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => server.close(),
      }),
    ),
  );
}

let server: PetitBacServerInstance;
let profiles: Awaited<ReturnType<typeof fakeProfiles>>;
let url: string;
const clients: Client[] = [];
const results: unknown[] = [];

beforeEach(async () => {
  profiles = await fakeProfiles();
  server = createPetitBacServer({
    corsOrigins: ['http://localhost'],
    identify: createIdentify(profiles.url),
    results: (r) => results.push(r),
    random: () => 0,
    timings: { voteMs: 200, resultsMs: 100, stopMs: 50, idleTimeoutMs: 5000 },
  });
  url = `http://localhost:${await server.listen(0)}`;
  results.length = 0;
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await server.close();
  profiles.close();
});

async function client(cookie?: string): Promise<Client> {
  const c: Client = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
  });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.once('connect', () => resolve());
    c.once('connect_error', reject);
  });
  return c;
}
const call = <T>(c: Client, event: string, ...args: unknown[]) =>
  new Promise<AckResult<T>>((resolve) => {
    (c.emit as (e: string, ...a: unknown[]) => void)(event, ...args, resolve);
  });
const next = (c: Client, predicate: (v: RoomView) => boolean = () => true) =>
  new Promise<RoomView>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for room:state')), 3000);
    const handler = (v: RoomView) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      c.off('room:state', handler);
      resolve(v);
    };
    c.on('room:state', handler);
  });
const unwrap = <T>(r: AckResult<T>): T => {
  if (!r.ok) throw new Error(`unexpected failure: ${r.reason}`);
  return r.value;
};

describe('HTTP', () => {
  it('exposes a health endpoint', async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ status: 'ok', rooms: 0 });
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});

describe('Petit Bac over Socket.IO', () => {
  it('create → join with a sloppy code → play → Bac → review → scores → podium, results recorded with the profile id', async () => {
    const alice = await client('glsc_sid=GOOD1');
    const bob = await client();
    const lobby = next(alice, (v) => v.players.length === 1);
    const host = unwrap(await call<SessionInfo>(alice, 'room:create', { playerName: 'Mallory' }));
    expect((await lobby).players[0]?.name).toBe('Gabin'); // the profile pseudo wins over what was typed

    const joined = next(alice, (v) => v.players.length === 2);
    unwrap(
      await call<SessionInfo>(bob, 'room:join', {
        code: host.code.toLowerCase().replace('-', ' '),
        playerName: 'Bob',
      }),
    );
    await joined;
    expect(await call(bob, 'settings:update', { rounds: 3 })).toEqual({
      ok: false,
      reason: 'NOT_HOST',
    });
    unwrap(
      await call(alice, 'settings:update', {
        rounds: 3,
        roundSeconds: 60,
        categories: ['prenom', 'pays', 'animal'],
      }),
    );
    const playing = next(bob, (v) => v.phase === 'PLAY');
    unwrap(await call(alice, 'game:start'));
    const view = await playing;
    let letter = view.letter ?? '';
    for (let round = 1; round <= 3; round++) {
      const words = Object.fromEntries(
        ['prenom', 'pays', 'animal'].map((c) => [c, `${letter}${c}`]),
      );
      await call(alice, 'answers:set', { answers: words });
      await call(bob, 'answers:set', { answers: { ...words, animal: '' } });
      expect(await call(bob, 'round:bac')).toEqual({ ok: false, reason: 'INCOMPLETE' });
      const voting = next(bob, (v) => v.phase === 'VOTE');
      unwrap(await call(alice, 'round:bac'));
      await voting;
      const results$ = next(bob, (v) => v.phase === 'RESULTS' || v.phase === 'GAME_OVER');
      await call(alice, 'ready:set', { ready: true });
      await call(bob, 'ready:set', { ready: true });
      await results$;
      if (round < 3) {
        const nextRound = next(bob, (v) => v.phase === 'PLAY' && v.round === round + 1);
        await call(alice, 'ready:set', { ready: true });
        await call(bob, 'ready:set', { ready: true });
        letter = (await nextRound).letter ?? '';
      }
    }
    const over = next(bob, (v) => v.phase === 'GAME_OVER');
    await call(alice, 'ready:set', { ready: true });
    await call(bob, 'ready:set', { ready: true });
    expect((await over).ranking?.[0]).toBe(host.playerId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      game: 'petitbac',
      players: [
        { name: 'Gabin', pid: PID, rank: 1, won: true },
        { name: 'Bob', rank: 2, won: false },
      ],
    });
  });

  it('a guest cannot take a pseudo reserved by a profile, to create or to join', async () => {
    const host = unwrap(
      await call<SessionInfo>(await client('glsc_sid=GOOD1'), 'room:create', { playerName: 'x' }),
    );
    const guest = await client();
    expect(await call(guest, 'room:create', { playerName: 'GABIN' })).toEqual({
      ok: false,
      reason: 'NAME_RESERVED',
    });
    expect(await call(guest, 'room:join', { code: host.code, playerName: 'gabin' })).toEqual({
      ok: false,
      reason: 'NAME_RESERVED',
    });
    expect((await call(guest, 'room:join', { code: host.code, playerName: 'Léa' })).ok).toBe(true);
  });

  it('rejects malformed payloads and unknown rooms; a reconnecting player gets their room back', async () => {
    const a = await client();
    expect(await call(a, 'room:create', { playerName: '' })).toEqual({
      ok: false,
      reason: 'INVALID_PAYLOAD',
    });
    expect(await call(a, 'room:create', { playerName: 'A', extra: 1 })).toEqual({
      ok: false,
      reason: 'INVALID_PAYLOAD',
    });
    expect(await call(a, 'room:join', { code: 'PB-ZZZZ', playerName: 'A' })).toEqual({
      ok: false,
      reason: 'ROOM_NOT_FOUND',
    });
    expect(await call(a, 'game:start')).toEqual({ ok: false, reason: 'NOT_IN_ROOM' });
    const session = unwrap(await call<SessionInfo>(a, 'room:create', { playerName: 'A' }));
    a.disconnect();
    const b = await client();
    const back = next(b, (v) => v.players.length === 1);
    expect(
      unwrap(await call<SessionInfo>(b, 'room:resume', { sessionToken: session.sessionToken }))
        .code,
    ).toBe(session.code);
    expect((await back).me).toBe(session.playerId);
    expect(
      await call(await client(), 'room:resume', {
        sessionToken: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual({
      ok: false,
      reason: 'SESSION_EXPIRED',
    });
  });
});
