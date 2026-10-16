import { createContext, useContext, type ReactNode } from 'react';
import type { GameClient } from './client';

const ClientContext = createContext<GameClient | null>(null);

export function ClientProvider({ client, children }: { client: GameClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): GameClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('ClientProvider missing');
  return client;
}
