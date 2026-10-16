import { RESULTS_SECONDS, type RoomView } from '@petitbac/shared';
import { Players } from '../components/Players';
import { RoundHeader } from '../components/RoundHeader';
import { useClient } from '../net/context';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';

export function Results({ view }: { view: RoomView }) {
  const client = useClient();
  const me = view.players.find((p) => p.id === view.me);
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const last = view.round >= view.settings.rounds;
  const gained = new Map<string, number>();
  for (const c of view.reveal ?? []) {
    for (const e of c.entries)
      gained.set(e.playerId, (gained.get(e.playerId) ?? 0) + (e.points ?? 0));
  }

  return (
    <main className={styles.page}>
      <RoundHeader
        view={view}
        label={last ? 'Dernière manche : résultats' : 'Résultats de la manche'}
        total={RESULTS_SECONDS}
      />

      <section className={`${ui.panel} ${styles.stack}`}>
        <h2 className={styles.h2}>Classement</h2>
        <ul className={styles.players}>
          {[...view.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <li key={p.id} className={`${styles.player} ${p.id === view.me ? styles.me : ''}`}>
                <span className={styles.pname}>{p.name}</span>
                <span className={ui.chip}>+{gained.get(p.id) ?? 0}</span>
                <span className={styles.score}>{p.score}</span>
              </li>
            ))}
        </ul>
      </section>

      {(view.reveal ?? []).map((c) => (
        <section key={c.id} className={`${ui.panel} ${styles.cat}`}>
          <h2 className={styles.h2}>{c.label}</h2>
          <ul className={styles.players}>
            {c.entries.map((e) => (
              <li
                key={e.playerId}
                className={`${styles.entry} ${e.status === 'rejected' ? styles.refused : ''}`}
              >
                <div>
                  <div className={styles.who}>
                    {e.playerId === view.me ? 'Toi' : (names.get(e.playerId) ?? '?')}
                  </div>
                  <div className={`${styles.answer} ${e.status === 'valid' ? '' : styles.struck}`}>
                    {e.status === 'empty' ? '—' : e.answer}
                  </div>
                  <span className={styles.tag}>
                    {e.status === 'rejected'
                      ? 'Refusée par les joueurs'
                      : e.status === 'wrong_letter'
                        ? 'Mauvaise lettre'
                        : e.status === 'valid' && e.shared
                          ? 'Même réponse qu’un autre joueur'
                          : e.status === 'valid'
                            ? 'Réponse unique !'
                            : ''}
                  </span>
                </div>
                <span className={`${styles.pts} ${(e.points ?? 0) === 0 ? styles.zero : ''}`}>
                  +{e.points ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className={`${ui.panel} ${styles.stack}`}>
        <Players players={view.players} me={view.me} showReady />
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          onClick={() => void client.ready(!me?.ready)}
        >
          {me?.ready ? 'J’attends les autres…' : last ? 'Voir le podium' : 'Manche suivante'}
        </button>
      </section>
    </main>
  );
}
