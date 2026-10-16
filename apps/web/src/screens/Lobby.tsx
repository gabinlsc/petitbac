import { useState } from 'react';
import {
  CATEGORIES,
  DEFAULT_CATEGORY_IDS,
  LIMITS,
  ROUND_SECONDS_CHOICES,
  type RoomView,
} from '@petitbac/shared';
import { Players } from '../components/Players';
import { useClient } from '../net/context';
import { toast } from '../store/store';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';

const ROUNDS = [3, 5, 7, 10];

export function Lobby({ view }: { view: RoomView }) {
  const client = useClient();
  const isHost = view.hostId === view.me;
  const { settings } = view;
  const connected = view.players.filter((p) => p.connected).length;
  const link = `${window.location.origin}/?room=${view.code}`;
  const [shared, setShared] = useState(false);

  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({
          title: 'Petit Bac',
          text: `Rejoins ma partie de Petit Bac : ${view.code}`,
          url: link,
        });
      else {
        await navigator.clipboard.writeText(link);
        setShared(true);
        setTimeout(() => setShared(false), 1500);
      }
    } catch {
      toast('Copie impossible : donne le code à voix haute.', 'error');
    }
  };

  const toggle = (id: string) => {
    const has = settings.categories.includes(id);
    const next = has ? settings.categories.filter((c) => c !== id) : [...settings.categories, id];
    if (next.length < LIMITS.minCategories)
      return toast(`Garde au moins ${LIMITS.minCategories} catégories.`, 'error');
    if (next.length > LIMITS.maxCategories)
      return toast(`${LIMITS.maxCategories} catégories au maximum.`, 'error');
    void client.updateSettings({ categories: next });
  };

  const shuffle = () => {
    const pool = CATEGORIES.map((c) => c.id).sort(() => Math.random() - 0.5);
    void client.updateSettings({ categories: pool.slice(0, settings.categories.length) });
  };

  return (
    <main className={styles.page}>
      <nav className={styles.topbar}>
        <button
          type="button"
          className={`${ui.button} ${ui.ghost}`}
          onClick={() => void client.leave()}
        >
          ← Quitter
        </button>
        <span className={ui.chip}>
          {connected} / {LIMITS.maxPlayers} joueurs
        </span>
      </nav>

      <section className={`${ui.panel} ${styles.stack} ${styles.center}`}>
        <span className={ui.label}>Code du salon</span>
        <div className={styles.row} style={{ justifyContent: 'center' }}>
          <span className={styles.code}>{view.code}</span>
        </div>
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={() => void share()}>
          {shared ? 'Lien copié ✓' : 'Inviter des amis'}
        </button>
      </section>

      <section className={`${ui.panel} ${styles.stack}`}>
        <h2 className={styles.h2}>Joueurs</h2>
        <Players
          players={view.players}
          me={view.me}
          onKick={isHost ? (id) => void client.kick(id) : undefined}
        />
      </section>

      <section className={`${ui.panel} ${styles.stack}`}>
        <h2 className={styles.h2}>Réglages {isHost ? '' : '(choisis par l’hôte)'}</h2>
        <div>
          <span className={ui.label}>Manches</span>
          <div className={ui.segmented} role="group" aria-label="Nombre de manches">
            {ROUNDS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={!isHost}
                className={`${ui.segment} ${settings.rounds === n ? ui.segmentActive : ''}`}
                aria-pressed={settings.rounds === n}
                onClick={() => void client.updateSettings({ rounds: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={ui.label}>Temps par manche</span>
          <div className={ui.segmented} role="group" aria-label="Temps par manche">
            {ROUND_SECONDS_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!isHost}
                className={`${ui.segment} ${settings.roundSeconds === s ? ui.segmentActive : ''}`}
                aria-pressed={settings.roundSeconds === s}
                onClick={() => void client.updateSettings({ roundSeconds: s })}
              >
                {s} s
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={ui.label}>Catégories ({settings.categories.length})</span>
          <div className={styles.chips}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!isHost}
                className={styles.chipBtn}
                aria-pressed={settings.categories.includes(c.id)}
                onClick={() => toggle(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {isHost ? (
            <div className={styles.row} style={{ marginTop: 10 }}>
              <button type="button" className={`${ui.button} ${ui.ghost}`} onClick={shuffle}>
                🎲 Au hasard
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.ghost}`}
                onClick={() =>
                  void client.updateSettings({ categories: [...DEFAULT_CATEGORY_IDS] })
                }
              >
                Par défaut
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {isHost ? (
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={connected < LIMITS.minPlayers}
          onClick={() => void client.start()}
        >
          {connected < LIMITS.minPlayers ? 'Il faut 2 joueurs' : 'Lancer la partie'}
        </button>
      ) : (
        <p className={`${ui.muted} ${styles.center}`} role="status">
          En attente de l’hôte…
        </p>
      )}
    </main>
  );
}
