import type { RoomView } from '@petitbac/shared';
import { useCountdown } from '../lib/useCountdown';
import styles from '../screens/game.module.css';

/** Letter, round counter and countdown (with a bar when a total duration is known). */
export function RoundHeader({
  view,
  label,
  total,
}: {
  view: RoomView;
  label: string;
  total?: number;
}) {
  const left = useCountdown(view.deadline);
  const urgent = left > 0 && left <= 10;
  return (
    <header className={styles.stack}>
      <div className={styles.roundHead}>
        <div className={styles.letter} aria-label={`Lettre ${view.letter ?? ''}`}>
          {view.letter}
        </div>
        <div>
          <div className={styles.who}>
            Manche {view.round} / {view.settings.rounds}
          </div>
          <div className={styles.answer}>{label}</div>
        </div>
        <div
          className={`${styles.timer} ${urgent ? styles.urgent : ''}`}
          role="timer"
          aria-live="off"
        >
          {left}
        </div>
      </div>
      {total ? (
        <div className={styles.bar} aria-hidden="true">
          <div
            className={`${styles.barFill} ${urgent ? styles.urgent : ''}`}
            style={{ width: `${Math.min(100, (left / total) * 100)}%` }}
          />
        </div>
      ) : null}
    </header>
  );
}
