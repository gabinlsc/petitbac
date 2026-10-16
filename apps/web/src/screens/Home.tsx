import { useEffect, useState } from 'react';
import { LIMITS, normalizeRoomCode, roomCodeSchema } from '@petitbac/shared';
import { InstallButton } from '../components/InstallButton';
import { fetchProfile, PROFILE_PAGE, type Profile } from '../lib/profile';
import { useClient } from '../net/context';
import { useApp } from '../store/store';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';

function initialCode(): string {
  const param = new URLSearchParams(window.location.search).get('room');
  return param ? normalizeRoomCode(param) : '';
}

export function Home() {
  const client = useClient();
  const saved = useApp((s) => s.name);
  const [name, setName] = useState(saved);
  const [code, setCode] = useState(initialCode());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchProfile().then((p) => {
      if (cancelled || !p) return;
      setProfile(p);
      setName(p.name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = name.trim();
  const validCode = roomCodeSchema.safeParse(normalizeRoomCode(code)).success;

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <nav className={styles.topbar} aria-label="Navigation">
        <a className={`${ui.button} ${ui.ghost}`} href="https://games.glsc.fr">
          ← Salle de jeux
        </a>
      </nav>

      <header>
        <h1 className={styles.title}>
          Petit <span className={styles.hl}>Bac</span>
        </h1>
        <p className={styles.subtitle}>
          Une lettre, des catégories, un chrono. Entre amis, en ligne, de 2 à {LIMITS.maxPlayers}{' '}
          joueurs.
        </p>
      </header>

      <section className={`${ui.panel} ${styles.stack}`}>
        <label>
          <span className={ui.label}>Ton pseudo</span>
          <input
            className={ui.input}
            value={name}
            maxLength={LIMITS.playerNameMaxLength}
            placeholder="Ex : Gabin"
            autoComplete="nickname"
            readOnly={profile !== null}
            onChange={(e) => setName(e.target.value)}
          />
          <span className={ui.muted}>
            {profile ? (
              <>
                Profil connecté ✓ · <a href={PROFILE_PAGE}>Mon profil</a>
              </>
            ) : (
              <>
                Pseudo libre · <a href={PROFILE_PAGE}>Réserver mon pseudo</a>
              </>
            )}
          </span>
        </label>

        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy || !trimmed}
          onClick={() => void run(() => client.create(trimmed))}
        >
          Créer une partie
        </button>
      </section>

      <section className={`${ui.panel} ${styles.stack}`}>
        <h2 className={styles.h2}>Rejoindre des amis</h2>
        <label>
          <span className={ui.label}>Code du salon</span>
          <input
            className={ui.input}
            value={code}
            placeholder="PB-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={ui.button}
          disabled={busy || !trimmed || !validCode}
          onClick={() => void run(() => client.join(normalizeRoomCode(code), trimmed))}
        >
          Rejoindre
        </button>
      </section>

      <footer className={`${styles.row} ${styles.between}`}>
        <InstallButton />
        <span className={ui.muted}>
          Un jeu de <a href="https://glsc.fr">glsc.fr</a>
        </span>
      </footer>
    </main>
  );
}
