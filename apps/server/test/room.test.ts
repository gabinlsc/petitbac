import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '@petitbac/shared';
import { Room } from '../src/rooms/Room';
import type { GameRecord } from '../src/results';

class FakeTransport {
  readonly views = new Map<string, RoomView>();
  closedFor: string[] = [];
  state(id: string, view: RoomView) {
    this.views.set(id, view);
  }
  closed(ids: readonly string[]) {
    this.closedFor.push(...ids);
  }
  view(id: string): RoomView {
    const v = this.views.get(id);
    if (!v) throw new Error('no view');
    return v;
  }
}

const TIMINGS = { idleTimeoutMs: 60_000, voteMs: 30_000, resultsMs: 10_000, stopMs: 5_000 };

function makeRoom(opts: { records?: GameRecord[]; hostPid?: string } = {}) {
  const transport = new FakeTransport();
  const room = new Room({
    code: 'PB-TEST',
    hostName: 'Alice',
    ...(opts.hostPid ? { hostPid: opts.hostPid } : {}),
    transport,
    random: () => 0, // letter A, then B…
    timings: TIMINGS,
    hooks: opts.records ? { onGameFinished: (r) => opts.records?.push(r) } : {},
  });
  const alice = room.hostPlayerId;
  const bobRes = room.join('Bob');
  if (!bobRes.ok) throw new Error('join failed');
  const bob = bobRes.value;
  room.connect(alice);
  room.connect(bob);
  return { room, transport, alice, bob };
}

/** Answers every field of a round with the given words (all starting with the letter). */
const fill = (
  room: Room,
  id: string,
  words: string[],
  cats = ['prenom', 'pays', 'animal', 'fruit-legume', 'metier', 'objet'],
) => room.setAnswers(id, Object.fromEntries(cats.map((c, i) => [c, words[i] ?? ''])));

describe('lobby', () => {
  it('only the host edits settings and starts, and needs two connected players', () => {
    const { room, alice, bob } = makeRoom();
    expect(room.updateSettings(bob, { rounds: 3 })).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(room.updateSettings(alice, { rounds: 3, roundSeconds: 60 }).ok).toBe(true);
    expect(room.start(bob)).toEqual({ ok: false, reason: 'NOT_HOST' });
    room.disconnect(bob);
    expect(room.start(alice)).toEqual({ ok: false, reason: 'NOT_ENOUGH_PLAYERS' });
  });
  it('makes pseudos unique, caps the table at 8 and refuses late comers', () => {
    const { room, alice } = makeRoom();
    expect(room.join('Alice')).toMatchObject({ ok: true });
    expect(room.viewFor(alice).players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Alice 2']);
    for (let i = 0; i < 5; i++) room.join(`P${i}`);
    expect(room.join('Nine')).toEqual({ ok: false, reason: 'ROOM_FULL' });
    room.start(alice);
    expect(room.join('Late')).toEqual({ ok: false, reason: 'GAME_IN_PROGRESS' });
  });
});

describe('a game', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays: letter, answers hidden from others, Bac, countdown, review, scores, next round', () => {
    const { room, transport, alice, bob } = makeRoom();
    room.updateSettings(alice, { rounds: 3, roundSeconds: 60 });
    expect(room.start(alice).ok).toBe(true);
    const v = transport.view(alice);
    expect(v).toMatchObject({ phase: 'PLAY', round: 1, letter: 'A', reveal: null });
    expect(v.deadline).toBeGreaterThan(Date.now());

    fill(room, alice, ['Alice', 'Algérie', 'Âne', 'Ail', 'Avocat', 'Assiette']);
    fill(room, bob, ['Alain', 'Algérie', 'Autruche', 'Ananas', 'Astronaute', 'Armoire']);
    // each player only ever sees their own words while playing
    expect(JSON.stringify(room.viewFor(alice))).not.toContain('Autruche');
    expect(room.viewFor(alice).myAnswers.animal).toBe('Âne');

    expect(room.callBac(bob).ok).toBe(true);
    expect(transport.view(alice).stopBy).toBe(bob);
    expect(room.callBac(alice)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    vi.advanceTimersByTime(5_000); // the stop countdown ends the round
    expect(transport.view(alice).phase).toBe('VOTE');
    const animal = transport.view(alice).reveal?.find((c) => c.id === 'animal');
    expect(animal?.entries.map((e) => e.answer)).toEqual(['Âne', 'Autruche']);

    // Alice refuses Bob's "Autruche" (the only other voter → majority)
    expect(room.vote(alice, 'animal', bob, true).ok).toBe(true);
    expect(room.vote(alice, 'animal', alice, true)).toEqual({
      ok: false,
      reason: 'INVALID_PAYLOAD',
    }); // not your own
    room.setReady(alice, true);
    room.setReady(bob, true); // everyone ready → scores
    const results = transport.view(alice);
    expect(results.phase).toBe('RESULTS');
    const byCat = Object.fromEntries((results.reveal ?? []).map((c) => [c.id, c.entries]));
    expect(byCat.pays?.map((e) => [e.points, e.shared])).toEqual([
      [5, true],
      [5, true],
    ]);
    expect(byCat.animal?.map((e) => [e.status, e.points])).toEqual([
      ['valid', 10],
      ['rejected', 0],
    ]);
    expect(results.players.find((p) => p.id === alice)?.score).toBe(55); // 5 shared + 5 × 10
    expect(results.players.find((p) => p.id === bob)?.score).toBe(45); // same, minus the refused animal
  });

  it('refuses Bac until every field has an answer starting with the letter', () => {
    const { room, alice } = makeRoom();
    room.start(alice);
    fill(room, alice, ['Alice', 'Algérie', 'Âne', 'Ail', 'Avocat']);
    expect(room.callBac(alice)).toEqual({ ok: false, reason: 'INCOMPLETE' });
    fill(room, alice, ['Alice', 'Algérie', 'Âne', 'Ail', 'Avocat', 'Bureau']); // wrong letter
    expect(room.callBac(alice)).toEqual({ ok: false, reason: 'INCOMPLETE' });
  });

  it('ends the round on time, and skips the review when there is nothing to review', () => {
    const { room, transport, alice } = makeRoom();
    room.updateSettings(alice, { roundSeconds: 60, rounds: 3 });
    room.start(alice);
    vi.advanceTimersByTime(60_000);
    expect(transport.view(alice).phase).toBe('RESULTS'); // all empty: straight to the scores
    vi.advanceTimersByTime(10_000);
    expect(transport.view(alice)).toMatchObject({ phase: 'PLAY', round: 2, letter: 'B' });
  });

  it('review ends after its time even if nobody is ready; a refusal needs a strict majority', () => {
    const { room, transport, alice, bob } = makeRoom();
    const carol = room.join('Carol');
    if (!carol.ok) throw new Error('x');
    room.connect(carol.value);
    room.updateSettings(alice, {
      rounds: 3,
      categories: ['prenom', 'pays', 'animal'],
      roundSeconds: 60,
    });
    room.start(alice);
    const cats = ['prenom', 'pays', 'animal'];
    fill(room, alice, ['Alice', 'Autriche', 'Ane'], cats);
    fill(room, bob, ['Albert', 'Autriche', 'Alpaga'], cats);
    fill(room, carol.value, ['Alex', 'Angola', 'Anaconda'], cats);
    vi.advanceTimersByTime(60_000);
    expect(transport.view(alice).phase).toBe('VOTE');
    room.vote(bob, 'animal', alice, true); // 1 of 2 voters: not a majority
    vi.advanceTimersByTime(30_000);
    const res = transport.view(alice);
    expect(res.phase).toBe('RESULTS');
    const animal = res.reveal
      ?.find((c) => c.id === 'animal')
      ?.entries.find((e) => e.playerId === alice);
    expect(animal).toMatchObject({ status: 'valid', points: 10 });
  });

  it('a player who drops mid-review does not block anybody', () => {
    const { room, transport, alice, bob } = makeRoom();
    room.updateSettings(alice, { rounds: 3, roundSeconds: 60 });
    room.start(alice);
    fill(room, alice, ['Alice', 'Algérie', 'Âne', 'Ail', 'Avocat', 'Assiette']);
    fill(room, bob, ['Alain', 'Andorre', 'Aigle', 'Aubergine', 'Avocat', 'Aspirateur']);
    vi.advanceTimersByTime(60_000);
    room.setReady(alice, true);
    room.disconnect(bob);
    expect(transport.view(alice).phase).toBe('RESULTS');
  });

  it('plays all rounds, ranks the players, records the game once with profile ids, then goes again', () => {
    const records: GameRecord[] = [];
    const { room, transport, alice, bob } = makeRoom({ records, hostPid: '0123456789abcdef' });
    room.updateSettings(alice, { rounds: 3, roundSeconds: 60 });
    room.start(alice);
    for (let round = 1; round <= 3; round++) {
      const letter = transport.view(alice).letter ?? '';
      const w = (s: string) => `${letter}${s}`;
      fill(room, alice, [w('a'), w('b'), w('c'), w('d'), w('e'), w('f')]);
      fill(room, bob, round === 1 ? [] : [w('a'), w('x'), w('y'), w('z'), w('u'), w('v')]);
      vi.advanceTimersByTime(60_000); // end of play
      room.setReady(alice, true);
      room.setReady(bob, true); // end of review
      room.setReady(alice, true);
      room.setReady(bob, true); // end of results
    }
    const end = transport.view(alice);
    expect(end.phase).toBe('GAME_OVER');
    expect(end.ranking).toEqual([alice, bob]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ game: 'petitbac', mode: 'online', rounds: 3 });
    expect(records[0]?.players[0]).toMatchObject({
      name: 'Alice',
      pid: '0123456789abcdef',
      rank: 1,
      won: true,
    });
    expect(records[0]?.players[1]).not.toHaveProperty('pid');
    expect(room.again(bob)).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(room.again(alice).ok).toBe(true);
    expect(transport.view(alice)).toMatchObject({ phase: 'LOBBY', round: 0 });
    expect(transport.view(alice).players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('closes an abandoned room after the idle time', () => {
    const { room, transport, alice, bob } = makeRoom();
    const disposed = vi.fn();
    (room as unknown as { hooks: { onDisposed: () => void } }).hooks.onDisposed = disposed;
    room.disconnect(alice);
    room.disconnect(bob);
    vi.advanceTimersByTime(60_000);
    expect(transport.closedFor.sort()).toEqual([alice, bob].sort());
    expect(disposed).toHaveBeenCalled();
  });
});
