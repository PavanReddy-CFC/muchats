'use client';

import { useEffect, useState } from 'react';
import { PlatformStatsDto } from '@qennect/shared-types';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const STAT_LABELS: { key: keyof PlatformStatsDto; label: string }[] = [
  { key: 'totalTenants', label: 'Communities' },
  { key: 'totalUsers', label: 'Users' },
  { key: 'totalChannels', label: 'Channels & groups' },
  { key: 'totalMessages', label: 'Messages sent' },
];

export default function PlatformPage(): JSX.Element {
  const { user } = useAuth();
  const [stats, setStats] = useState<PlatformStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    apiFetch<PlatformStatsDto>('/platform/stats')
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load platform stats'));
  }, [user]);

  if (!user?.isSuperAdmin) {
    return <p className="text-sm text-slate-500">Platform superadmin access required.</p>;
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Platform</h1>
      <p className="mb-4 text-sm text-slate-500">
        Totals across every community on this deployment — visible only to platform superadmins.
      </p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!stats && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STAT_LABELS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-2xl font-semibold text-slate-900">{stats[key].toLocaleString()}</p>
              <p className="text-sm text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
