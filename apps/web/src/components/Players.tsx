import type { PlayerView } from '@petitbac/shared';
import styles from '../screens/game.module.css';

const COLORS = [
  'var(--banana)',
  'var(--mint)',
  'var(--sky)',
  'var(--lilac)',
  'var(--coral)',
  'var(--peach)',
];
export const colorOf = (index: number): string => COLORS[index % COLORS.length] ?? 'var(--banana)';

interface Props {
  readonly players: readonly PlayerView[];
  readonly me: string;
  readonly showScores?: boolean;
  readonly showReady?: boolean;
  /** Host-only: kick buttons. */
  readonly onKick?: ((playerId: string) => void) | undefined;
}

export function Players({ players, me, showScores = false, showReady = false, onKick }: Props) {
  return (
    <ul className={styles.players}>
      {players.map((p, i) => (
        <li
          key={p.id}
          className={`${styles.player} ${p.connected ? '' : styles.offline} ${p.id === me ? styles.me : ''}`}
        >
          <span className={styles.dot} style={{ background: colorOf(i) }} aria-hidden="true">
            {p.name.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.pname}>
            {p.name}
            {p.profile ? ' ✓' : ''}
            {p.id === me ? ' (toi)' : ''}
          </span>
          {p.isHost ? <span title="Hôte">👑</span> : null}
          {!p.connected ? <span title="Déconnecté">💤</span> : null}
          {showReady && p.ready ? <span title="Prêt">✅</span> : null}
          {showScores ? <span className={styles.score}>{p.score}</span> : null}
          {onKick && p.id !== me ? (
            <button
              type="button"
              className={styles.refuse}
              onClick={() => onKick(p.id)}
              aria-label={`Retirer ${p.name}`}
            >
              ✕
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
