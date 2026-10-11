'use client';

/**
 * Sky Rocket — crash-point sequence configuration (admin only).
 *
 * Backed by the audited /admin/crash endpoints (ADMIN / SUPER_ADMIN enforced
 * server-side by JwtAuthGuard + RolesGuard). The page:
 *  - shows the persisted sequence runtime (mode, position, repeat end);
 *  - lets an admin configure the ORIGINAL crash-point list (future points
 *    only — consumed points are frozen server-side);
 *  - queues NEW admin points that start after the current repeat ends;
 *  - extends the CURRENT repeat WITHOUT resetting its position
 *    (e.g. #31 + extension 10 → new repeat end #41).
 *
 * A running round is NEVER affected: its crash multiplier is frozen on the
 * round row at creation; changes apply only to the next eligible round.
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { ApiClientError } from '@/lib/api/client';
import {
  getCrashSequence,
  setCrashSequenceNextPoints,
  setCrashSequencePoints,
  setCrashRepeatExtension,
  type AdminCrashSequenceState,
} from '@/lib/api/admin';
import { AdminPageHeader } from '@/components/admin/ui';
import { useAdminPermission } from '@/components/admin/admin-guard';

/** Parses and validates one multiplier per line (client-side pre-check only —
 * the backend re-validates every rule before persisting anything). */
function parsePoints(raw: string): { points: number[] | null; error: string | null } {
  const lines = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return { points: null, error: 'Enter at least one multiplier (e.g. 1.20).' };
  const points: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const value = Number(lines[i]);
    if (!Number.isFinite(value)) {
      return { points: null, error: `Line ${i + 1}: "${lines[i]}" is not a valid number.` };
    }
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-9) {
      return { points: null, error: `Line ${i + 1}: use at most 2 decimal places (e.g. 1.20).` };
    }
    if (value <= 1.0) {
      return { points: null, error: `Line ${i + 1}: multiplier must be greater than 1.00x.` };
    }
    if (value > 10000) {
      return { points: null, error: `Line ${i + 1}: multiplier must not exceed 10000.00x.` };
    }
    points.push(Math.round(value * 100) / 100);
  }
  return { points, error: null };
}

const MODE_LABELS: Record<AdminCrashSequenceState['mode'], string> = {
  PROVABLY_FAIR: 'PROVABLY_FAIR (random provably-fair rounds)',
  ORIGINAL: 'ORIGINAL — consuming the configured list',
  REPEAT: 'REPEAT — replaying the original list',
  REPEAT_EXTENDED: 'REPEAT_EXTENDED — repeat extended by admin',
  NEW_SEQUENCE: 'NEW_SEQUENCE — consuming new admin points',
};

export default function AdminCrashPage() {
  const canManage = useAdminPermission(ADMIN_PERMISSIONS.CRASH_MANAGE);
  const [state, setState] = useState<AdminCrashSequenceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pointsText, setPointsText] = useState('');
  const [nextPointsText, setNextPointsText] = useState('');
  const [extension, setExtension] = useState('10');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'points' | 'next' | 'extension' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getCrashSequence();
      setState(s);
      setPointsText((current) => (current ? current : s.originalPoints.map((p) => p.toFixed(2)).join('\n')));
      setNextPointsText((current) => (current ? current : (s.nextPoints ?? []).map((p) => p.toFixed(2)).join('\n')));
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.status === 403
            ? '403 — only ADMIN / SUPER_ADMIN accounts can manage the Sky Rocket sequence.'
            : err.message
          : 'Failed to load the sequence configuration.',
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

  const savePoints = async () => {
    // Double-submit guard (Part 35).
    if (busy) return;
    const { points, error: parseError } = parsePoints(pointsText);
    if (points == null) {
      setError(parseError);
      return;
    }
    setBusy('points');
    setError(null);
    setNotice(null);
    try {
      const res = await setCrashSequencePoints(points, reason || undefined);
      setState(res.state);
      setPointsText(res.state.originalPoints.map((p) => p.toFixed(2)).join('\n'));
      setNotice(res.message);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const saveNextPoints = async () => {
    // Double-submit guard (Part 35).
    if (busy) return;
    const { points, error: parseError } = parsePoints(nextPointsText);
    if (points == null) {
      setError(parseError);
      return;
    }
    setBusy('next');
    setError(null);
    setNotice(null);
    try {
      const res = await setCrashSequenceNextPoints(points, reason || undefined);
      setState(res.state);
      setNextPointsText(res.state.nextPoints?.map((p) => p.toFixed(2)).join('\n') ?? '');
      setNotice(res.message);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const saveExtension = async () => {
    // Double-submit guard (Part 35).
    if (busy) return;
    const value = Number(extension);
    if (!Number.isInteger(value) || value < 1) {
      setError('Extension must be a positive whole number (e.g. 10 or 20).');
      return;
    }
    setBusy('extension');
    setError(null);
    setNotice(null);
    try {
      const res = await setCrashRepeatExtension(value, reason || undefined);
      setState(res.state);
      setNotice(res.message); // e.g. "Repeat extended from #31 to #41."
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const repeatPhase = state?.mode === 'REPEAT' || state?.mode === 'REPEAT_EXTENDED';
  const canEditOriginal =
    !state?.active || state.mode === 'ORIGINAL';
  const extensionPreview =
    state && repeatPhase ? (state.repeatPosition || 0) + (Number(extension) || 0) : null;

  if (loading) {
    return (
      <div>
        <AdminPageHeader
          title="Sky Rocket"
          description="Crash-point sequence configuration."
          crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Sky Rocket' }]}
        />
        <p className="text-sm text-slate-400">Loading sequence runtime…</p>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Sky Rocket"
        description="Operator crash-point sequence. Backend remains the ONLY source of truth — each round consumes exactly one configured multiplier; admin changes never affect a running round."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Sky Rocket' }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" role="status">
          {notice}
        </p>
      ) : null}

      {/* Current runtime */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-white">Current runtime</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Mode</p>
              <p className="font-bold text-white">{state ? MODE_LABELS[state.mode] : '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Current position</p>
              <p className="font-bold tabular-nums text-white">{state?.label ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Repeat end</p>
              <p className="font-bold tabular-nums text-white">
                {state?.repeatEnd != null ? `#${state.repeatEnd}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Remaining originals</p>
              <p className="font-bold tabular-nums text-white">{state?.remainingOriginal ?? 0}</p>
            </div>
          </div>
          {state && !state.active ? (
            <p className="mt-3 text-xs text-slate-400">
              No sequence configured — rounds use the provably-fair HMAC commit/reveal engine.
            </p>
          ) : null}
        </CardContent>
      </Card>


      {/* Original crash points */}
      {canManage ? (
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-white">Original crash points ({state?.originalPoints.length ?? 0})</CardTitle>
          <p className="text-xs text-slate-400">
            One multiplier per line, in play order. Consumed points (P1..P{state?.originalConsumed ?? 0}) are
            frozen — only future points may be edited.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="h-48 w-full rounded-lg border border-white/10 bg-ink-900/60 p-3 font-mono text-sm text-white outline-none focus:border-teal-400/50"
            value={pointsText}
            onChange={(e) => setPointsText(e.target.value)}
            placeholder={'1.20\n1.45\n2.10\n3.50\n1.08\n5.20'}
            aria-label="Original crash points"
            disabled={!canEditOriginal}
          />
          {canEditOriginal ? (
            <Button loading={busy === 'points'} onClick={() => void savePoints()}>
              Save original points
            </Button>
          ) : (
            <p className="text-xs text-amber-300">
              The original list is locked while REPEAT / NEW_SEQUENCE is running — queue new points below instead.
            </p>
          )}
        </CardContent>
      </Card>
      ) : (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-white">Sequence configuration</CardTitle>
            <p className="text-xs text-slate-400">
              You have read-only access. A Master Admin with crash.manage can edit original points, repeat extensions and queued points.
            </p>
          </CardHeader>
        </Card>
      )}

      {canManage ? (
      <>
      {/* Repeat extension — THE key control */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-white">Repeat extension</CardTitle>
          <p className="text-xs text-slate-400">
            Extends the CURRENT repeat without resetting its position. Example: position #31 + extension 10 →
            repeat continues R32…R41, then the queued new points start. Never resets to R1.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="crash-extension" className="block text-xs uppercase tracking-wide text-slate-400">
                Extension (points)
              </label>
              <input
                id="crash-extension"
                inputMode="numeric"
                className="w-28 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-lg font-bold tabular-nums text-white outline-none focus:border-teal-400/50"
                value={extension}
                onChange={(e) => setExtension(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={!repeatPhase}
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Current position</p>
              <p className="text-lg font-bold tabular-nums text-white">
                {repeatPhase ? `#${state?.repeatPosition ?? 0}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">New repeat end</p>
              <p className="text-lg font-bold tabular-nums text-teal-300">
                {extensionPreview != null ? `#${extensionPreview}` : '—'}
              </p>
            </div>
            <Button
              loading={busy === 'extension'}
              onClick={() => void saveExtension()}
              disabled={!repeatPhase}
            >
              Save extension
            </Button>
          </div>
          {!repeatPhase ? (
            <p className="text-xs text-slate-400">
              Extensions become available once the repeat phase starts (after the original list finishes).
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* New admin points */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-white">
            New points after the repeat {state?.nextPoints ? `(${state.nextPoints.length} queued)` : '(none queued)'}
          </CardTitle>
          <p className="text-xs text-slate-400">
            These points (N1, N2, …) become active ONLY after the current repeat — including any extension —
            finishes. They are never silently discarded: when they finish they become the new repeat source.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="h-40 w-full rounded-lg border border-white/10 bg-ink-900/60 p-3 font-mono text-sm text-white outline-none focus:border-teal-400/50"
            value={nextPointsText}
            onChange={(e) => setNextPointsText(e.target.value)}
            placeholder={'1.30\n2.40\n1.70'}
            aria-label="New crash points"
            disabled={!state?.active || !repeatPhase}
          />
          <Button
            loading={busy === 'next'}
            onClick={() => void saveNextPoints()}
            disabled={!state?.active || !repeatPhase}
          >
            Save new points
          </Button>
        </CardContent>
      </Card>

      {/* Audit reason + notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-white">Audit reason (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            className="w-full rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-teal-400/50"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason recorded in the immutable audit log with every change"
            maxLength={280}
            aria-label="Audit reason"
          />
          <p className="mt-3 text-xs text-slate-500">
            Every change is logged with your admin id, the previous configuration, the new configuration and a
            timestamp. Ordinary users can never read or modify this configuration (403 server-side).
          </p>
        </CardContent>
      </Card>
      </>
      ) : null}
    </div>
  );
}

