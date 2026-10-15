import { useEffect, useRef, useState } from 'react';
import { useChatClient } from '../context/ChatProvider';

/** Highest message `seq` that any *other* member of the channel has read, for driving
 *  WhatsApp-style checkmarks on your own messages. Seeded from the persisted receipts on
 *  mount (via GET /messages/receipts) so a message read before you opened the app still
 *  shows as read immediately, then kept current by live 'readReceipt' events. */
export function useReadReceipts(channelId: string): number {
  const client = useChatClient();
  const [maxOtherSeq, setMaxOtherSeq] = useState(0);
  const seqByUser = useRef(new Map<string, number>());

  function applySeq(userId: string, seq: number): void {
    const current = seqByUser.current.get(userId) ?? 0;
    if (seq <= current) return;
    seqByUser.current.set(userId, seq);
    setMaxOtherSeq(Math.max(...seqByUser.current.values()));
  }

  useEffect(() => {
    seqByUser.current = new Map();
    setMaxOtherSeq(0);

    client
      .listReadReceipts(channelId)
      .then((receipts) => {
        for (const r of receipts) {
          if (r.userId === client.userId) continue;
          applySeq(r.userId, r.seq);
        }
      })
      .catch(() => undefined);

    return client.on('readReceipt', (cid, userId, seq) => {
      if (cid !== channelId || userId === client.userId) return;
      applySeq(userId, seq);
    });
  }, [client, channelId]);

  return maxOtherSeq;
}
