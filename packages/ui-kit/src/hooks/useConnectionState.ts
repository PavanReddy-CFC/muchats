import { useEffect, useState } from 'react';
import { useChatClient } from '../context/ChatProvider';
import { ConnectionState } from '../client/types';

export function useConnectionState(): ConnectionState {
  const client = useChatClient();
  const [state, setState] = useState<ConnectionState>(client.getConnectionState());

  useEffect(() => client.on('connectionState', setState), [client]);

  return state;
}
