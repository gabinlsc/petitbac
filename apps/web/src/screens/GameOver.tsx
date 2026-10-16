import type { RoomView } from '@petitbac/shared';
import { useClient } from '../net/context';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';

const MEDALS = ['🥇', '🥈', '🥉'];

export function GameOver({ view }: { view: RoomView }) {
  const client = useClient();
  const isHost = view.hostId === view.me;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const order = (view.ranking ?? [])
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  let rank = 0;
  let previous = Number.NaN;
  const rows = order.map((p, i) => {
    if (p.score !== previous) rank = i + 1;
    previous = p.score;
    return { p, rank };
  });
  const winners = rows.filter((r) => r.rank === 1).map((r) => r.p.name);

  return (
    <main className={styles.page}>
      <header className={styles.center}>
        <h1 className={styles.title}>
          Fin de <span className={styles.hl}>partie</span>
        </h1>
        <p className={styles.subtitle}>
          {winners.length > 1
            ? `Égalité entre ${winners.join(' et ')} !`
            : `${winners[0] ?? ''} remporte la partie 🎉`}
        </p>
      </header>

      <section className={styles.podium}>
        {rows.map(({ p, rank: r }) => (
          <div key={p.id} className={`${styles.rank} ${r === 1 ? styles.first : ''}`}>
            <span className={styles.medal}>{MEDALS[r - 1] ?? r}</span>
            <span className={styles.pname}>
              {p.name}
              {p.id === view.me ? ' (toi)' : ''}
            </span>
            <span className={styles.score}>{p.score} pts</span>
          </div>
        ))}
      </section>

      <div className={styles.stack}>
        {isHost ? (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => void client.again()}
          >
            Rejouer avec les mêmes joueurs
          </button>
        ) : (
          <p className={`${ui.muted} ${styles.center}`}>L’hôte peut relancer une partie.</p>
        )}
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={() => void client.leave()}
        >
          Quitter le salon
        </button>
      </div>
    </main>
  );
}
