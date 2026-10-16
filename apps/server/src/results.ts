import { appendFile } from 'node:fs/promises';

/** One player at the end of a game, best rank first. Humans who left before the end are not listed. */
export interface ResultPlayer {
  readonly name: string;
  /** Profile id of a signed-in player (the leaderboard groups results by profile). */
  readonly pid?: string;
  readonly bot: false;
  /** 1 = winner (ties share the rank). */
  readonly rank: number;
  readonly won: boolean;
  readonly score: number;
}

/**
 * A finished game, as written to RESULTS_FILE (one JSON object per line).
 * Read by the glsc.fr probe to build the public leaderboard of games.glsc.fr.
 */
export interface GameRecord {
  readonly v: 1;
  /** Unix time, seconds. */
  readonly t: number;
  readonly game: 'petitbac';
  readonly mode: 'online';
  readonly rounds: number;
  readonly players: readonly ResultPlayer[];
}

export type ResultSink = (record: GameRecord) => void;

/** Appends each record to `file`, in order. A write error is logged and never reaches the game. */
export function fileResultSink(
  file: string,
  log: (message: string) => void = console.error,
): ResultSink {
  let queue: Promise<void> = Promise.resolve();
  return (record) => {
    const line = `${JSON.stringify(record)}\n`;
    queue = queue
      .then(() => appendFile(file, line, { mode: 0o640 }))
      .catch((e: unknown) =>
        log(`[petitbac] result not saved: ${e instanceof Error ? e.message : String(e)}`),
      );
  };
}
