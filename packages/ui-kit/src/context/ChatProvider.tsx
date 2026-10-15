import React, { createContext, ReactNode, useContext, useEffect, useMemo } from 'react';
import { ChatClient } from '../client/ChatClient';
import { ChatClientConfig } from '../client/types';

const ChatContext = createContext<ChatClient | null>(null);

export interface ChatProviderProps {
  config: ChatClientConfig;
  children: ReactNode;
}

/** Owns one ChatClient instance for its subtree, connecting on mount and disconnecting on
 *  unmount. Re-creates the client if `config.tenantId` or `config.userId` changes (e.g. the
 *  host app switches accounts), which is the only case that should force a fresh connection. */
export function ChatProvider({ config, children }: ChatProviderProps): JSX.Element {
  const client = useMemo(() => new ChatClient(config), [config.tenantId, config.userId]);

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  return <ChatContext.Provider value={client}>{children}</ChatContext.Provider>;
}

export function useChatClient(): ChatClient {
  const client = useContext(ChatContext);
  if (!client) throw new Error('useChatClient must be used within ChatProvider');
  return client;
}
