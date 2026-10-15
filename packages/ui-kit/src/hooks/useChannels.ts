import { useEffect, useState } from 'react';
import { ChannelDto } from '@qennect/shared-types';
import { useChatClient } from '../context/ChatProvider';

export function useChannels(): { channels: ChannelDto[]; refresh: () => Promise<void> } {
  const client = useChatClient();
  const [channels, setChannels] = useState<ChannelDto[]>(client.getCachedChannels());

  useEffect(() => {
    const unsubscribe = client.on('channelsUpdated', setChannels);
    client.listChannels().catch(() => undefined);
    return unsubscribe;
  }, [client]);

  return { channels, refresh: () => client.listChannels().then(() => undefined) };
}
