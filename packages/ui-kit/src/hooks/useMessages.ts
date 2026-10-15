import { useEffect, useState } from 'react';
import { useChatClient } from '../context/ChatProvider';
import { LocalMessage } from '../client/types';

export function useMessages(channelId: string): {
  messages: LocalMessage[];
  sendMessage: (body: string, parentId?: string, attachmentIds?: string[]) => Promise<void>;
  retryMessage: (clientMsgId: string) => Promise<void>;
  markRead: (seq: number) => Promise<void>;
} {
  const client = useChatClient();
  const [messages, setMessages] = useState<LocalMessage[]>(client.getCachedMessages(channelId));

  useEffect(() => {
    setMessages(client.getCachedMessages(channelId));
    const unsubscribe = client.on('messagesUpdated', (cid, msgs) => {
      if (cid === channelId) setMessages(msgs);
    });
    client.loadMessages(channelId).catch(() => undefined);
    return unsubscribe;
  }, [client, channelId]);

  return {
    messages,
    sendMessage: (body, parentId, attachmentIds) => client.sendMessage(channelId, body, parentId, attachmentIds),
    retryMessage: (clientMsgId) => client.retryMessage(channelId, clientMsgId),
    markRead: (seq) => client.markRead(channelId, seq),
  };
}
