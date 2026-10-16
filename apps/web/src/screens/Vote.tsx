import type { RevealEntry, RoomView } from '@petitbac/shared';
import { Players } from '../components/Players';
import { RoundHeader } from '../components/RoundHeader';
import { useClient } from '../net/context';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';
import { VOTE_SECONDS } from '@petitbac/shared';

export function Vote({ view }: { view: RoomView }) {
  const client = useClient();
  const me = view.players.find((p) => p.id === view.me);
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const reveal = view.reveal ?? [];

  const entryRow = (categoryId: string, e: RevealEntry) => {
    const own = e.playerId === view.me;
    const reviewable = e.status === 'review';
    const refused = reviewable && e.eligible > 0 && e.rejects * 2 > e.eligible;
    return (
      <li
        key={e.playerId}
        className={`${styles.entry} ${refused ? styles.refused : ''} ${own ? styles.ownEntry : ''}`}
      >
        <div>
          <div className={styles.who}>{own ? 'Toi' : (names.get(e.playerId) ?? '?')}</div>
          <div className={`${styles.answer} ${e.status === 'wrong_letter' ? styles.struck : ''}`}>
            {e.status === 'empty' ? '—' : e.answer}
          </div>
          {e.status === 'wrong_letter' ? <span className={styles.tag}>Mauvaise lettre</span> : null}
          {reviewable && e.rejects > 0 ? (
            <span className={styles.tag}>
              {e.rejects} refus sur {e.eligible}
            </span>
          ) : null}
        </div>
        {reviewable && !own ? (
          <button
            type="button"
            className={styles.refuse}
            aria-pressed={e.mine}
            onClick={() => void client.vote(categoryId, e.playerId, !e.mine)}
          >
            {e.mine ? 'Refusée ✕' : 'Refuser'}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <main className={styles.page}>
      <RoundHeader
        view={view}
        label="Relecture : refuse les réponses douteuses"
        total={VOTE_SECONDS}
      />
      {reveal.map((c) => (
        <section key={c.id} className={`${ui.panel} ${styles.cat}`}>
          <h2 className={styles.h2}>{c.label}</h2>
          <ul className={styles.players}>{c.entries.map((e) => entryRow(c.id, e))}</ul>
        </section>
      ))}
      <section className={`${ui.panel} ${styles.stack}`}>
        <Players players={view.players} me={view.me} showReady />
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          onClick={() => void client.ready(!me?.ready)}
        >
          {me?.ready ? 'J’attends les autres…' : 'J’ai fini la relecture'}
        </button>
      </section>
    </main>
  );
}
