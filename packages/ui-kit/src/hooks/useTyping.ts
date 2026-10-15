import { useEffect, useRef, useState } from 'react';
import { useChatClient } from '../context/ChatProvider';

const TYPING_IDLE_MS = 3000;

export function useTyping(channelId: string): { typingUserIds: string[]; notifyTyping: () => void } {
  const client = useChatClient();
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    return client.on('typing', (cid, userId, isTyping) => {
      if (cid !== channelId) return;
      setTypingUserIds((prev) => {
        if (isTyping) return prev.includes(userId) ? prev : [...prev, userId];
        return prev.filter((id) => id !== userId);
      });
    });
  }, [client, channelId]);

  function notifyTyping(): void {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      client.setTyping(channelId, true);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      client.setTyping(channelId, false);
    }, TYPING_IDLE_MS);
  }

  return { typingUserIds, notifyTyping };
}
