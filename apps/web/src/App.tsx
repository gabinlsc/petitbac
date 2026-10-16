import { useEffect } from 'react';
import { Decor } from './components/Decor';
import { ReportButton } from './components/ReportButton';
import { useClient } from './net/context';
import { GameOver } from './screens/GameOver';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Play } from './screens/Play';
import { Results } from './screens/Results';
import { Vote } from './screens/Vote';
import styles from './screens/game.module.css';
import { dismissToast, useApp } from './store/store';

export function App() {
  const client = useClient();
  const view = useApp((s) => s.view);
  const session = useApp((s) => s.session);
  const connection = useApp((s) => s.connection);
  const resuming = useApp((s) => s.resuming);
  const toasts = useApp((s) => s.toasts);
  const closed = useApp((s) => s.closed);

  useEffect(() => {
    client.connect();
    return () => {
      client.socket.disconnect();
    };
  }, [client]);

  let screen;
  if (session && !view) {
    screen = (
      <main className={styles.page}>
        <p role="status" className={styles.center}>
          {connection === 'online' && !resuming ? 'Chargement du salon…' : 'Reconnexion…'}
        </p>
      </main>
    );
  } else if (!session || !view) {
    screen = <Home />;
  } else if (view.phase === 'LOBBY') screen = <Lobby view={view} />;
  else if (view.phase === 'PLAY') screen = <Play key={view.round} view={view} />;
  else if (view.phase === 'VOTE') screen = <Vote view={view} />;
  else if (view.phase === 'RESULTS') screen = <Results view={view} />;
  else screen = <GameOver view={view} />;

  return (
    <>
      <Decor />
      {screen}
      <ReportButton game="petitbac" context={{ room: view?.code, phase: view?.phase ?? 'HOME' }} />
      <div className={styles.toasts} aria-live="polite">
        {closed ? (
          <div className={`${styles.toast} ${styles.error}`} role="alert">
            {closed === 'kicked'
              ? 'L’hôte t’a retiré du salon.'
              : 'Le salon a été fermé (inactif).'}
          </div>
        ) : null}
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.toast} ${t.tone === 'error' ? styles.error : ''}`}
            onClick={() => dismissToast(t.id)}
          >
            {t.text}
          </button>
        ))}
      </div>
      {connection === 'offline' ? (
        <div className={styles.offline} role="status">
          Connexion perdue, reconnexion en cours…
        </div>
      ) : null}
    </>
  );
}
