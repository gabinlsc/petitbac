import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { RoomView, SessionInfo } from '@petitbac/shared';

export type Connection = 'connecting' | 'online' | 'offline';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'error';
}

export interface AppState {
  readonly connection: Connection;
  readonly session: SessionInfo | null;
  /** True while a stored session is being resumed after (re)connection. */
  readonly resuming: boolean;
  readonly view: RoomView | null;
  /** Server clock minus local clock (ms), refreshed with every view. */
  readonly clockOffset: number;
  readonly toasts: readonly Toast[];
  readonly closed: 'kicked' | 'idle' | null;
  readonly name: string;
}

const SESSION_KEY = 'petitbac.session';
const NAME_KEY = 'petitbac.name';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the game still works, just without memory */
  }
}

export function storedSession(): SessionInfo | null {
  try {
    const raw = read(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export const store = createStore<AppState>(() => ({
  connection: 'connecting',
  session: storedSession(),
  resuming: false,
  view: null,
  clockOffset: 0,
  toasts: [],
  closed: null,
  name: read(NAME_KEY) ?? '',
}));

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(store, selector);
}

export function setSession(session: SessionInfo | null): void {
  write(SESSION_KEY, session ? JSON.stringify(session) : null);
  store.setState(session ? { session } : { session: null, view: null });
}

export function setName(name: string): void {
  write(NAME_KEY, name);
  store.setState({ name });
}

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info'): void {
  const id = ++toastId;
  store.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  setTimeout(() => store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
}

export function dismissToast(id: number): void {
  store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** Server time "now", corrected for the gap between the two clocks. */
export const serverNow = (): number => Date.now() + store.getState().clockOffset;
