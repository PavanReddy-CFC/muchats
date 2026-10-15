'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChannelDto } from '@qennect/shared-types';
import { apiFetch, ApiError } from '@/lib/api-client';

export default function ChannelsPage(): JSX.Element {
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ChannelDto[]>('/channels/admin');
      setChannels(data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? 'Your role does not have access to the full channel list.'
            : err.message
          : 'Failed to load channels',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Channels</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {c.type === 'DM' ? (
                      <span className="text-slate-400">(DM)</span>
                    ) : (
                      <Link href={`/channels/${c.id}`} className="text-slate-900 hover:underline">
                        {c.name}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{c.type}</td>
                  <td className="px-4 py-2 text-slate-500">{c.memberCount ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
