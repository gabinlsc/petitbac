import { LIMITS, LETTERS, POINTS_SHARED, POINTS_UNIQUE } from './constants';

/** What a player typed, cleaned up: no control characters, single spaces, bounded length. */
export function cleanAnswer(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, LIMITS.answerMaxLength);
}

/** Lower case, no accents, only letters / digits / spaces / hyphens / apostrophes. */
function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9 '-]/g, '')
    .trim();
}

const ARTICLE = /^(?:le|la|les|l|un|une|des|du|de la|de l|de|d|au|aux)(?:'|\s+|-)(?=\S)/;

/** The answer without a leading article ("l'éléphant" → "elephant"). */
function withoutArticle(folded: string): string {
  return folded.replace(ARTICLE, '');
}

export type AnswerStatus = 'ok' | 'empty' | 'wrong_letter';

/** An answer counts when it starts with the round's letter (an article in front is fine). */
export function answerStatus(raw: string, letter: string): AnswerStatus {
  const folded = fold(cleanAnswer(raw));
  if (!/[a-z0-9]/.test(folded)) return 'empty';
  const wanted = fold(letter);
  const first = (s: string) => s.replace(/^[^a-z0-9]+/, '')[0] ?? '';
  return first(folded) === wanted || first(withoutArticle(folded)) === wanted
    ? 'ok'
    : 'wrong_letter';
}

/** Two answers with the same key are "the same answer" (plural, article, accents, spacing ignored). */
export function dedupeKey(raw: string): string {
  const base = withoutArticle(fold(cleanAnswer(raw))).replace(/[\s'-]+/g, '');
  return base.length > 3 ? base.replace(/[sx]$/, '') : base;
}

/** A reviewed answer is refused when more than half of the other players refuse it. */
export function isRejected(rejects: number, eligibleVoters: number): boolean {
  return eligibleVoters > 0 && rejects * 2 > eligibleVoters;
}

export function pickLetter(used: readonly string[], random: () => number): string {
  const fresh = LETTERS.filter((l) => !used.includes(l));
  const pool = fresh.length > 0 ? fresh : LETTERS;
  return pool[Math.floor(random() * pool.length)] ?? 'A';
}

export type EntryStatus = 'valid' | 'rejected' | 'empty' | 'wrong_letter';

export interface ScoredEntry {
  readonly status: EntryStatus;
  readonly points: number;
  /** Another player gave the same (valid) answer. */
  readonly shared: boolean;
}

export interface RoundInput {
  readonly letter: string;
  readonly categories: readonly string[];
  readonly players: readonly string[];
  /** answers[playerId][categoryId] */
  readonly answers: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Players who refused (categoryId, author), and how many other players could vote on it. */
  readonly rejectedBy: (categoryId: string, authorId: string) => number;
  readonly eligibleFor: (authorId: string) => number;
}

export interface RoundScores {
  /** byPlayer[playerId][categoryId] */
  readonly byPlayer: Record<string, Record<string, ScoredEntry>>;
  readonly totals: Record<string, number>;
}

export function scoreRound(input: RoundInput): RoundScores {
  const byPlayer: Record<string, Record<string, ScoredEntry>> = {};
  const totals: Record<string, number> = {};
  for (const p of input.players) {
    byPlayer[p] = {};
    totals[p] = 0;
  }
  for (const cat of input.categories) {
    const valid = new Map<string, string[]>(); // dedupe key → players
    const statuses = new Map<string, EntryStatus>();
    for (const p of input.players) {
      const raw = input.answers[p]?.[cat] ?? '';
      const base = answerStatus(raw, input.letter);
      let status: EntryStatus = base === 'ok' ? 'valid' : base;
      if (status === 'valid' && isRejected(input.rejectedBy(cat, p), input.eligibleFor(p))) {
        status = 'rejected';
      }
      statuses.set(p, status);
      if (status === 'valid') {
        const key = dedupeKey(raw);
        valid.set(key, [...(valid.get(key) ?? []), p]);
      }
    }
    for (const p of input.players) {
      const status = statuses.get(p) ?? 'empty';
      let points = 0;
      let shared = false;
      if (status === 'valid') {
        const group = valid.get(dedupeKey(input.answers[p]?.[cat] ?? '')) ?? [];
        shared = group.length > 1;
        points = shared ? POINTS_SHARED : POINTS_UNIQUE;
      }
      (byPlayer[p] ??= {})[cat] = { status, points, shared };
      totals[p] = (totals[p] ?? 0) + points;
    }
  }
  return { byPlayer, totals };
}
