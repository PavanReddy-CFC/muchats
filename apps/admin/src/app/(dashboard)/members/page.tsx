'use client';

import { useCallback, useEffect, useState } from 'react';
import { TenantMemberDto, TenantRole } from '@qennect/shared-types';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const ASSIGNABLE_ROLES = [TenantRole.MEMBER, TenantRole.ADMIN];

export default function MembersPage(): JSX.Element {
  const { user } = useAuth();
  const canManage = user?.role === TenantRole.OWNER || user?.role === TenantRole.ADMIN;

  const [members, setMembers] = useState<TenantMemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TenantMemberDto[]>('/tenancy/members');
      setMembers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(userId: string, role: TenantRole): Promise<void> {
    setSavingUserId(userId);
    try {
      const updated = await apiFetch<TenantMemberDto>(`/tenancy/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev.map((m) => (m.userId === userId ? updated : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update role');
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Members</h1>
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
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t border-slate-100">
                  <td className="px-4 py-2">{m.displayName}</td>
                  <td className="px-4 py-2 text-slate-500">{m.email}</td>
                  <td className="px-4 py-2">
                    {canManage && m.role !== TenantRole.OWNER ? (
                      <select
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                        value={m.role}
                        disabled={savingUserId === m.userId}
                        onChange={(e) => changeRole(m.userId, e.target.value as TenantRole)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
