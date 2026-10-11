'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@tanvion-royale/ui';
import type { HealthStatus } from '@tanvion-royale/types';
import { apiFetch } from '@/lib/api/client';

export default function HealthPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<HealthStatus>('/health');
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach the API');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Service health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading && <p className="text-sm text-slate-500">Checking…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {health && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <StatusDot ok={health.status !== 'down'} />
                <dt className="font-medium">Service</dt>
                <dd>{health.service}</dd>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok /> <dt className="font-medium">Status</dt>
                <dd className="uppercase">{health.status}</dd>
              </div>
              {Object.entries(health.checks).map(([name, state]) => (
                <div key={name} className="flex items-center gap-2">
                  <StatusDot ok={state === 'up'} />
                  <dt className="font-medium">{name}</dt>
                  <dd className="capitalize">{state}</dd>
                </div>
              ))}
            </dl>
          )}
          <div>
            <Button onClick={() => void load()} variant="outline" size="sm">
              Re-check
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`}
      aria-hidden
    />
  );
}