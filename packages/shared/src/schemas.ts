import { z } from 'zod';
import {
  CATEGORIES,
  LIMITS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_PREFIX,
  ROUND_SECONDS_CHOICES,
} from './constants';

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.playerNameMaxLength)
  .regex(/^[\p{L}\p{N} _.'-]+$/u, 'Caractères non autorisés');

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^${ROOM_CODE_PREFIX}[${ROOM_CODE_ALPHABET}]{4}$`));

/** Codes are typed by hand: accept "pb-abcd", "PBABCD", " abcd ". */
export function normalizeRoomCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const suffix = letters.startsWith('PB') ? letters.slice(2) : letters;
  return `${ROOM_CODE_PREFIX}${suffix}`;
}

export const createRoomPayloadSchema = z.object({ playerName: playerNameSchema }).strict();
export const joinRoomPayloadSchema = z
  .object({
    code: z.string().transform(normalizeRoomCode).pipe(roomCodeSchema),
    playerName: playerNameSchema,
  })
  .strict();
export const resumePayloadSchema = z.object({ sessionToken: z.string().uuid() }).strict();

export const settingsPatchSchema = z
  .object({
    rounds: z.number().int().min(LIMITS.minRounds).max(LIMITS.maxRounds),
    categories: z
      .array(z.string().refine((id) => CATEGORY_IDS.has(id)))
      .min(LIMITS.minCategories)
      .max(LIMITS.maxCategories)
      .refine((ids) => new Set(ids).size === ids.length),
    roundSeconds: z.union(
      ROUND_SECONDS_CHOICES.map((s) => z.literal(s)) as [
        z.ZodLiteral<60>,
        z.ZodLiteral<90>,
        z.ZodLiteral<120>,
      ],
    ),
  })
  .partial()
  .strict();

/** categoryId → text; unknown categories are ignored by the server. */
export const answersPayloadSchema = z
  .object({ answers: z.record(z.string().max(80), z.string().max(200)) })
  .strict();

export const votePayloadSchema = z
  .object({ categoryId: z.string().max(40), playerId: z.string().max(80), reject: z.boolean() })
  .strict();

export const readyPayloadSchema = z.object({ ready: z.boolean() }).strict();
export const kickPayloadSchema = z.object({ playerId: z.string().max(80) }).strict();
