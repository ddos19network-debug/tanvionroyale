'use client';

/**
 * Royale Ace — admin operations (admin only).
 *
 * Backed by the audited /admin/royale-ace endpoints (ADMIN / SUPER_ADMIN
 * enforced server-side by JwtAuthGuard + RolesGuard + ROYALE_READ/ROYALE_MANAGE).
 * The page:
 *  - lists config versions (newest first) with sim status;
 *  - lets an admin create a DRAFT from JSON + reason, run a sim, activate;
 *  - flips the game on/off (each action needs a mandatory reason);
 *  - views recent rounds, replays one, voids an unpaid round, reconciles.
 *
 * Responses NEVER include a server seed; the viewer exposes only the stored,
 * hash-committed outcome for replay/verification.
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { ApiClientError } from '@/lib/api/client';
import {
  activateAceConfigVersion,
  createAceConfigVersion,
  getAceConfigVersion,
  getAceDefaultConfig,
  getAceRoundForReplay,
  listAceConfigVersions,
  listAceRounds,
  listAceSimulationReports,
  reconcileAceRounds,
  runAceSimulation,
  setAceEnabled,
  voidAceRound,
  type AdminAceConfigVersion,
  type AdminAceRound,
  type AdminAceSimulationReport,
} from '@/lib/api/admin';
import { AdminPageHeader, AdminStatusBadge, formatDateTime } from '@/components/admin/ui';
import { useAdminPermission } from '@/components/admin/admin-guard';

export default function AdminRoyaleAcePage() {
  const canManage = useAdminPermission(ADMIN_PERMISSIONS.ROYALE_MANAGE);
  const [versions, setVersions] = useState<AdminAceConfigVersion[]>([]);
  const [selected, setSelected] = useState<AdminAceConfigVersion | null>(null);
  const [reports, setReports] = useState<AdminAceSimulationReport[]>([]);
  const [rounds, setRounds] = useState<AdminAceRound[]>([]);
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ versions: v }, r] = await Promise.all([
        listAceConfigVersions(),
        listAceRounds({ limit: 25 }),
      ]);
      setVersions(v ?? []);
      if (v?.length) {
        const first = v[0];
        setSelected(first);
        const { reports: rep } = await listAceSimulationReports(first.version);
        setReports(rep ?? []);
      }
      setRounds(Array.isArray(r) ? r : []);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.status === 403
            ? '403 — only ADMIN / SUPER_ADMIN accounts can manage Royale Ace.'
            : err.message
          : 'Failed to load Royale Ace state.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fail(err: unknown): void {
    setNotice(null);
    setError(
      err instanceof ApiClientError ? `${err.message}${err.code ? ` (${err.code})` : ''}` : 'Request failed. Please try again.',
    );
  }

  async function selectVersion(v: number): Promise<void> {
    try {
      const full = await getAceConfigVersion(v);
      setSelected(full);
      const { reports: rep } = await listAceSimulationReports(v);
      setReports(rep ?? []);
      setReplay(null);
    } catch (err) {
      fail(err);
    }
  }

  function needReason(): string | null {
    if (!reason.trim()) {
      setError('A reason is required for every mutating action (governance / audit).');
      return null;
    }
    return reason.trim();
  }

  async function doSimulate(): Promise<void> {
    if (!selected) return;
    const r = needReason();
    void r;
    setBusy('sim');
    setError(null);
    setNotice(null);
    try {
      const report = await runAceSimulation(selected.version, {});
      setReports((prev) => [report, ...prev]);
      setNotice(`Simulation stored for v${selected.version}: RTP ${report.rtpBp / 100}% (passed=${report.passed}).`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doActivate(): Promise<void> {
    if (!selected) return;
    const r = needReason();
    if (!r) return;
    setBusy('activate');
    setError(null);
    setNotice(null);
    try {
      const updated = await activateAceConfigVersion(selected.version, r);
      setSelected(updated);
      setNotice(`Config v${selected.version} activated.`);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doToggle(enabled: boolean): Promise<void> {
    const r = needReason();
    if (!r) return;
    setBusy('toggle');
    setError(null);
    setNotice(null);
    try {
      const updated = await setAceEnabled(enabled, r);
      setSelected(updated);
      setNotice(enabled ? 'Royale Ace enabled.' : 'Royale Ace disabled.');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }

  async function doReplay(roundId: string): Promise<void> {
    setBusy(`replay-${roundId}`);
    setError(null);
    try {
      setReplay(await getAceRoundForReplay(roundId));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doVoid(roundId: string): Promise<void> {
    const r = needReason();
    if (!r) return;
    setBusy(`void-${roundId}`);
    setError(null);
    setNotice(null);
    try {
      await voidAceRound(roundId, r);
      setNotice(`Round ${roundId.slice(0, 8)}… voided.`);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doCreateDraft(): Promise<void> {
    const r = needReason();
    if (!r) return;
    setBusy('draft');
    setError(null);
    setNotice(null);
    try {
      const { config } = await getAceDefaultConfig();
      const created = await createAceConfigVersion(config, r);
      setNotice(`Draft v${created.version} created (math changes still need a passing simulation).`);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doReconcile(): Promise<void> {
    setBusy('reconcile');
    setError(null);
    setNotice(null);
    try {
      const out = await reconcileAceRounds();
      setNotice(`Reconciler finished: ${out.completed} completed, ${out.voided} voided.`);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div>
        <AdminPageHeader title="Royale Ace" description="5×4 / 1024-ways cascading card slot (royale-ace)." />
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const active = versions.find((v) => v.status === 'ACTIVE') ?? selected;

  return (
    <div>
      <AdminPageHeader
        title="Royale Ace"
        description="Versioned config, simulation gate, round viewer and operations. Every mutating action needs a mandatory reason and is audited."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Royale Ace' }]}
      />
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-md bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Config versions</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-sm text-slate-500">No versions yet.</p>
            ) : (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => void selectVersion(v.version)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                        selected?.version === v.version ? 'border-amber-300/50 bg-amber-400/5' : 'border-white/10'
                      }`}
                    >
                      <span>
                        <span className="font-bold">v{v.version}</span>{' '}
                        <span className="text-slate-400">{v.configName}</span>{' '}
                        <span className="text-xs text-slate-500">({(v.targetRtpBp / 100).toFixed(2)}% RTP)</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {v.simulationPassed === null ? null : (
                          <span className={v.simulationPassed ? 'text-emerald-300' : 'text-red-300'}>
                            {v.simulationPassed ? 'sim ok' : 'sim fail'}
                          </span>
                        )}
                        <AdminStatusBadge status={v.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Selected version {selected ? `(v${selected.version})` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-slate-500">Select a version.</p>
            ) : (
              <SelectedVersionPanel

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent rounds</CardTitle>
          </CardHeader>
          <CardContent>
            {rounds.length === 0 ? (
              <p className="text-sm text-slate-500">No rounds yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-1 pr-2">Round</th>
                      <th className="py-1 pr-2">Mode</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Stake</th>
                      <th className="py-1 pr-2">Payout</th>
                      <th className="py-1 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rounds.map((r) => (
                      <tr key={r.id} className="border-t border-white/5">
                        <td className="py-1 pr-2 font-mono text-[11px]">{r.id.slice(0, 8)}…</td>
                        <td className="py-1 pr-2">{r.mode}</td>
                        <td className="py-1 pr-2">{r.status}</td>
                        <td className="py-1 pr-2">
                          {r.stake} {r.currency}
                        </td>
                        <td className="py-1 pr-2">{r.payout ?? '—'}</td>
                        <td className="flex gap-1 py-1 pr-2">
                          <button
                            type="button"
                            onClick={() => void doReplay(r.id)}
                            disabled={busy !== null}
                            className="rounded border border-white/10 px-2 py-0.5 hover:bg-white/10 disabled:opacity-50"
                          >
                            Replay
                          </button>
                          <button
                            type="button"
                            onClick={() => void doVoid(r.id)}
                            disabled={!canManage || busy !== null}
                            className="rounded border border-white/10 px-2 py-0.5 hover:bg-white/10 disabled:opacity-50"

        <Card>
          <CardHeader>
            <CardTitle>Simulation reports (selected version)</CardTitle>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              onClick={() => void doReconcile()}
              disabled={!canManage || busy !== null}
              className="mb-3 rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
            >
              {busy === 'reconcile' ? 'Reconciling…' : 'Run reconciler'}
            </button>
            {reports.length === 0 ? (
              <p className="text-sm text-slate-500">No reports yet — run a simulation first.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {reports.map((rep) => (
                  <li key={rep.id} className="rounded-lg border border-white/10 p-2">
                    <span className={rep.passed ? 'text-emerald-300' : 'text-red-300'}>
                      {rep.passed ? 'PASSED' : 'FAILED'}
                    </span>{' '}
                    <span className="text-slate-300">
                      RTP {(rep.rtpBp / 100).toFixed(2)}% (target {(rep.targetRtpBp / 100).toFixed(2)}%) ·{' '}
                      {rep.spins.toLocaleString()} spins · max x{(rep.maxWinObservedBp / 10_000).toFixed(1)}
                    </span>
                    <br />
                    <span className="text-slate-500">{formatDateTime(rep.createdAt)}</span>
                    {rep.notes && <span className="text-slate-400"> — {rep.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SelectedVersionPanel(props: {
  selected: AdminAceConfigVersion;
  reason: string;
  setReason: (v: string) => void;
  busy: string | null;
  canManage: boolean;
  onSimulate: () => void;
  onActivate: () => void;
  onToggle: () => void;
  onCreateDraft: () => void;
}) {
  const { selected, reason, setReason, busy, canManage, onSimulate, onActivate, onToggle, onCreateDraft } = props;
  const enabled = Boolean((selected.config as Record<string, unknown> | undefined)?.enabled);
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-slate-500">Status:</span> {selected.status}
      </p>
      <p>
        <span className="text-slate-500">Reason:</span> {selected.changeReason}
      </p>
      <p>
        <span className="text-slate-500">Game:</span> {enabled ? 'enabled' : 'disabled'}{' '}
        <span className="text-slate-500">Created:</span> {formatDateTime(selected.createdAt)}{' '}
        <span className="text-slate-500">Activated:</span>{' '}
        {selected.activatedAt ? formatDateTime(selected.activatedAt) : '—'}
      </p>
      {selected.validationErrors.length > 0 && (
        <ul className="rounded-md bg-red-950/40 p-2 text-xs text-red-300">
          {selected.validationErrors.map((e) => (
            <li key={e.path}>
              {e.path}: {e.message}
            </li>
          ))}
        </ul>
      )}
      <label className="block text-xs text-slate-400">
        Reason (mandatory for every action)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Q3 tune after sim report"
          className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-100"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canManage || busy !== null}
          onClick={onCreateDraft}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          {busy === 'draft' ? 'Creating…' : 'New draft from default'}
        </button>
        <button
          type="button"
          disabled={!canManage || busy !== null}
          onClick={onSimulate}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          {busy === 'sim' ? 'Running…' : 'Run simulation'}
        </button>
        <button
          type="button"
          disabled={!canManage || busy !== null || selected.status === 'ACTIVE'}
          onClick={onActivate}
          className="rounded-md bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-400/30 disabled:opacity-50"
        >
          {busy === 'activate' ? 'Activating…' : 'Activate'}
        </button>
        <button
          type="button"
          disabled={!canManage || busy !== null}
          onClick={onToggle}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          {busy === 'toggle' ? 'Saving…' : enabled ? 'Disable game' : 'Enable game'}
        </button>
      </div>
      {!canManage && <p className="text-xs text-slate-500">Read-only: ROYALE_MANAGE is required to mutate.</p>}
    </div>
  );
}

                          >
                            Void
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {replay && (
              <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-black/40 p-2 text-[10px] text-emerald-200">
                {JSON.stringify(replay, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

                selected={selected}
                reason={reason}
                setReason={setReason}
                busy={busy}
                canManage={canManage}
                onSimulate={() => void doSimulate()}
                onActivate={() => void doActivate()}
                onToggle={() => void doToggle(!(active?.config as Record<string, unknown> | undefined)?.enabled)}
                onCreateDraft={() => void doCreateDraft()}
              />
            )}
          </CardContent>
        </Card>
      </div>


  }

