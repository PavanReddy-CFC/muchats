'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChannelMemberDto, ChannelMemberRole } from '@qennect/shared-types';
import { apiFetch, ApiError } from '@/lib/api-client';

const ASSIGNABLE_ROLES = [ChannelMemberRole.MEMBER, ChannelMemberRole.ADMIN];

export default function ChannelDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const channelId = params.id;

  const [members, setMembers] = useState<ChannelMemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ChannelMemberDto[]>(`/channels/${channelId}/members`);
      setMembers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(userId: string, role: ChannelMemberRole): Promise<void> {
    setBusyUserId(userId);
    try {
      const updated = await apiFetch<ChannelMemberDto>(`/channels/${channelId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev.map((m) => (m.userId === userId ? updated : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role');
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(userId: string): Promise<void> {
    setBusyUserId(userId);
    try {
      await apiFetch<void>(`/channels/${channelId}/members/${userId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove member');
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteChannel(): Promise<void> {
    if (!confirm('Delete this channel? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await apiFetch<void>(`/channels/${channelId}`, { method: 'DELETE' });
      router.push('/channels');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete channel');
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Channel members</h1>
        <button
          onClick={deleteChannel}
          disabled={deleting}
          className="text-sm text-red-600 hover:underline disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete channel'}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t border-slate-100">
                  <td className="px-4 py-2">{m.displayName}</td>
                  <td className="px-4 py-2 text-slate-500">{m.email}</td>
                  <td className="px-4 py-2">
                    {m.role !== ChannelMemberRole.OWNER ? (
                      <select
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                        value={m.role}
                        disabled={busyUserId === m.userId}
                        onChange={(e) => changeRole(m.userId, e.target.value as ChannelMemberRole)}
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{m.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{new Date(m.joinedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    {m.role !== ChannelMemberRole.OWNER && (
                      <button
                        onClick={() => removeMember(m.userId)}
                        disabled={busyUserId === m.userId}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
