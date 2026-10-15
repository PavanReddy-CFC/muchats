import { useEffect, useState } from 'react';
import { useChatClient } from '../context/ChatProvider';

/** Resolves an attachment id to a viewable (presigned) URL. `ChatClient.getAttachmentViewUrl`
 *  already memoizes per attachment id, so re-mounting the same image elsewhere is cheap. */
export function useAttachmentUrl(attachmentId: string): string | null {
  const client = useChatClient();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    client
      .getAttachmentViewUrl(attachmentId)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, attachmentId]);

  return url;
}
