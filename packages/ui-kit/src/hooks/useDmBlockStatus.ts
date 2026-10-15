import { useCallback, useEffect, useState } from 'react';
import { DmBlockStatusDto } from '@qennect/shared-types';
import { useChatClient } from '../context/ChatProvider';

/** Block state for a DM (`null` while loading, or when `enabled` is false — e.g. a group
 *  channel, where blocking doesn't apply). `toggle()` blocks if neither side currently has a
 *  block placed, otherwise unblocks (a no-op server-side if the other participant placed it). */
export function useDmBlockStatus(
  channelId: string,
  enabled: boolean,
): { status: DmBlockStatusDto | null; toggle: () => Promise<void>; busy: boolean } {
  const client = useChatClient();
  const [status, setStatus] = useState<DmBlockStatusDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    client.getDmBlockStatus(channelId).then(setStatus).catch(() => undefined);
  }, [client, channelId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(): Promise<void> {
    if (!status) return;
    setBusy(true);
    try {
      if (status.blockedByMe) {
        await client.unblockInDm(channelId);
      } else {
        await client.blockInDm(channelId);
      }
      load();
    } finally {
      setBusy(false);
    }
  }

  return { status, toggle, busy };
}
