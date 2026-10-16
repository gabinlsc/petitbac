import { describe, expect, it } from 'vitest';
import {
  answerStatus,
  cleanAnswer,
  dedupeKey,
  isRejected,
  normalizeRoomCode,
  pickLetter,
  scoreRound,
} from '../src';

describe('answerStatus', () => {
  it('accepts the letter, any case, any accent, with or without an article', () => {
    expect(answerStatus('Éléphant', 'E')).toBe('ok');
    expect(answerStatus("l'éléphant", 'E')).toBe('ok');
    expect(answerStatus('Le Mans', 'L')).toBe('ok');
    expect(answerStatus('la Rochelle', 'R')).toBe('ok');
    expect(answerStatus('œuf', 'O')).toBe('ok');
  });
  it('refuses another letter, and empty or symbol-only answers', () => {
    expect(answerStatus('Chat', 'D')).toBe('wrong_letter');
    expect(answerStatus('', 'A')).toBe('empty');
    expect(answerStatus('  ', 'A')).toBe('empty');
    expect(answerStatus('---', 'A')).toBe('empty');
  });
});

describe('dedupeKey', () => {
  it('treats plurals, articles, accents and spacing as the same answer', () => {
    const keys = ['Éléphant', 'elephants', "l'éléphant", 'ÉLÉPHANT '].map(dedupeKey);
    expect(new Set(keys).size).toBe(1);
    expect(dedupeKey('Saint-Étienne')).toBe(dedupeKey('saint etienne'));
    expect(dedupeKey('Chat')).not.toBe(dedupeKey('Chien'));
  });
});

describe('cleanAnswer', () => {
  it('drops control and bidi characters, collapses spaces, bounds the length', () => {
    expect(cleanAnswer('  a‮b ​ c ')).toBe('ab c');
    expect(cleanAnswer('x'.repeat(100))).toHaveLength(30);
  });
});

describe('isRejected', () => {
  it('needs a strict majority of the other players', () => {
    expect(isRejected(1, 1)).toBe(true);
    expect(isRejected(1, 2)).toBe(false);
    expect(isRejected(2, 2)).toBe(true);
    expect(isRejected(2, 4)).toBe(false);
    expect(isRejected(3, 4)).toBe(true);
    expect(isRejected(0, 0)).toBe(false);
  });
});

describe('scoreRound', () => {
  const base = {
    letter: 'C',
    categories: ['animal', 'pays'],
    players: ['a', 'b', 'c'],
    rejectedBy: () => 0,
    eligibleFor: () => 2,
  };
  it('10 points for a unique answer, 5 for a shared one, 0 for empty or wrong letter', () => {
    const r = scoreRound({
      ...base,
      answers: {
        a: { animal: 'Chat', pays: 'Chine' },
        b: { animal: 'chats', pays: '' },
        c: { animal: 'Cheval', pays: 'Brésil' },
      },
    });
    expect(r.byPlayer.a?.animal).toMatchObject({ status: 'valid', points: 5, shared: true });
    expect(r.byPlayer.b?.animal).toMatchObject({ points: 5, shared: true });
    expect(r.byPlayer.c?.animal).toMatchObject({ points: 10, shared: false });
    expect(r.byPlayer.a?.pays).toMatchObject({ points: 10 });
    expect(r.byPlayer.b?.pays).toMatchObject({ status: 'empty', points: 0 });
    expect(r.byPlayer.c?.pays).toMatchObject({ status: 'wrong_letter', points: 0 });
    expect(r.totals).toEqual({ a: 15, b: 5, c: 10 });
  });
  it('a refused answer scores nothing and no longer makes the other one "shared"', () => {
    const r = scoreRound({
      ...base,
      answers: { a: { animal: 'Chat' }, b: { animal: 'Chat' }, c: {} },
      rejectedBy: (_cat, author) => (author === 'a' ? 2 : 0),
    });
    expect(r.byPlayer.a?.animal).toMatchObject({ status: 'rejected', points: 0 });
    expect(r.byPlayer.b?.animal).toMatchObject({ status: 'valid', points: 10, shared: false });
  });
});

describe('helpers', () => {
  it('pickLetter avoids used letters until the pool is empty', () => {
    const seen: string[] = [];
    for (let i = 0; i < 19; i++) seen.push(pickLetter(seen, Math.random));
    expect(new Set(seen).size).toBe(19);
    expect(pickLetter(seen, () => 0)).toBeTruthy();
  });
  it('normalizeRoomCode forgives how codes are typed', () => {
    expect(normalizeRoomCode('pb-abcd')).toBe('PB-ABCD');
    expect(normalizeRoomCode(' pbabcd ')).toBe('PB-ABCD');
    expect(normalizeRoomCode('abcd')).toBe('PB-ABCD');
  });
});
