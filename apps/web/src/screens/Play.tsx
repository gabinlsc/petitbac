import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, LIMITS, answerStatus, type RoomView } from '@petitbac/shared';
import { RoundHeader } from '../components/RoundHeader';
import { useClient } from '../net/context';
import ui from '../styles/ui.module.css';
import styles from './game.module.css';

const LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label]));

export function Play({ view }: { view: RoomView }) {
  const client = useClient();
  const letter = view.letter ?? '';
  const cats = view.settings.categories;
  // Local copy: typing never waits for the network. The server copy only matters after a reload.
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...view.myAnswers }));
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answers);
  latest.current = answers;

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    client.setAnswers(latest.current);
  };
  const change = (id: string, text: string) => {
    setAnswers((a) => ({ ...a, [id]: text }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  useEffect(() => {
    inputs.current[cats[0] ?? '']?.focus();
    return () => {
      // leaving the screen (end of the round) must never lose the last keystrokes
      if (timer.current) client.setAnswers(latest.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const states = useMemo(
    () => Object.fromEntries(cats.map((c) => [c, answerStatus(answers[c] ?? '', letter)])),
    [answers, cats, letter],
  );
  const complete = cats.every((c) => states[c] === 'ok');
  const stopper = view.players.find((p) => p.id === view.stopBy);
  const bacByMe = view.stopBy === view.me;

  return (
    <main className={styles.page}>
      <RoundHeader view={view} label="Remplis vite !" total={view.settings.roundSeconds} />

      {stopper ? (
        <p className={styles.banner} role="alert">
          {bacByMe ? 'Tu as crié Bac !' : `${stopper.name} a crié Bac !`} Termine vite.
        </p>
      ) : null}

      <form
        className={`${ui.panel} ${styles.fields}`}
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        {cats.map((id, i) => {
          const status = states[id];
          const text = answers[id] ?? '';
          return (
            <div key={id} className={styles.field}>
              <label htmlFor={`f-${id}`}>
                <span>{LABELS.get(id) ?? id}</span>
                <span
                  className={`${styles.fieldState} ${status === 'ok' ? styles.good : status === 'wrong_letter' ? styles.bad : ''}`}
                >
                  {status === 'ok'
                    ? '✓'
                    : status === 'wrong_letter'
                      ? `Doit commencer par ${letter}`
                      : ''}
                </span>
              </label>
              <input
                id={`f-${id}`}
                ref={(el) => {
                  inputs.current[id] = el;
                }}
                className={`${ui.input} ${status === 'wrong_letter' ? styles.wrong : ''}`}
                value={text}
                maxLength={LIMITS.answerMaxLength}
                placeholder={`${letter}…`}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint={i === cats.length - 1 ? 'done' : 'next'}
                onChange={(e) => change(id, e.target.value)}
                onBlur={flush}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const next = cats[i + 1];
                  if (next) inputs.current[next]?.focus();
                  else (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          );
        })}
      </form>

      <button
        type="button"
        className={`${ui.button} ${ui.primary}`}
        disabled={!complete || view.stopBy !== null}
        onClick={() => {
          flush();
          void client.bac();
        }}
      >
        {view.stopBy ? 'Bac déjà crié' : complete ? 'BAC !' : 'Remplis toutes les cases'}
      </button>
    </main>
  );
}
