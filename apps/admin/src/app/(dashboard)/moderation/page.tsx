'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChannelDto, MessageDto } from '@qennect/shared-types';
import { apiFetch, ApiError } from '@/lib/api-client';

export default function ModerationPage(): JSX.Element {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ChannelDto[]>('/channels/admin')
      .then((data) => {
        setChannels(data);
        if (data[0]) setSelectedChannelId(data[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load channels'));
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    if (!channelId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<MessageDto[]>(`/messages?channelId=${channelId}&limit=100`);
      setMessages(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages(selectedChannelId);
  }, [selectedChannelId, loadMessages]);

  async function deleteMessage(messageId: string): Promise<void> {
    setDeletingId(messageId);
    try {
      const updated = await apiFetch<MessageDto>(`/moderation/messages/${messageId}`, { method: 'DELETE' });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete message');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Moderation</h1>

      <div className="mb-4">
        <select
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          value={selectedChannelId}
          onChange={(e) => setSelectedChannelId(e.target.value)}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? `(DM ${c.id.slice(0, 8)})`}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <p className={`text-sm ${m.deletedAt ? 'italic text-slate-400' : 'text-slate-900'}`}>
                  {m.deletedAt ? 'Message deleted' : m.body}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  seq {m.seq} · {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
              {!m.deletedAt && (
                <button
                  onClick={() => deleteMessage(m.id)}
                  disabled={deletingId === m.id}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
          {messages.length === 0 && <p className="text-sm text-slate-400">No messages in this channel.</p>}
        </ul>
      )}
    </div>
  );
}
