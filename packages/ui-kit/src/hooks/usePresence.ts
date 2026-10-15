import { useEffect, useState } from 'react';
import { PresenceStatus } from '@qennect/shared-types';
import { useChatClient } from '../context/ChatProvider';

export function usePresence(userId: string): PresenceStatus {
  const client = useChatClient();
  const [status, setStatus] = useState<PresenceStatus>(PresenceStatus.OFFLINE);

  useEffect(() => {
    return client.on('presence', (uid, s) => {
      if (uid === userId) setStatus(s);
    });
  }, [client, userId]);

  return status;
}
