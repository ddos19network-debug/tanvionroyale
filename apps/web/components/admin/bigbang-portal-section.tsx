'use client';

/**
 * ADMIN — BigBang portal configuration.
 *
 * Reads `GET /admin/partner-providers/bigbang/webhook`, which returns the three
 * URLs to register in the BigBang Dashboard plus a BOOLEAN saying whether a
 * webhook secret exists. The stored secret is NEVER returned by that route.
 *
 * "Generate / Rotate" calls the POST route, whose response is the ONLY place
 * the plaintext secret is ever visible. It is shown once in a dismissible
 * panel with a copy button and is then DISCARDED from component state — never
 * stored in localStorage, never logged, never sent anywhere else.
 *
 * Every URL is rendered from the server's canonical API origin. Nothing on this
 * page hard-codes a production domain.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { describeApiError } from '@/lib/api/client';
import { useToast } from '@/components/admin/toast';
import {
  getBigBangWebhookConfig,
  rotateBigBangWebhookSecret,
  type BigBangWebhookConfigView,
} from '@/lib/api/affiliate';

function CopyableUrl({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-xs text-slate-200">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast(`${label} copied`);
            } catch {
              toast('Copy failed — select the text manually');
            }
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

export default function AdminBigBangPortalSection() {
  const { toast } = useToast();
  const [config, setConfig] = useState<BigBangWebhookConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  // Held in memory ONLY, for the single render that shows it. Cleared when the
  // panel is dismissed and never persisted.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await getBigBangWebhookConfig());
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRotate = useCallback(async () => {
    setWorking(true);
    setError(null);
    try {
      const res = await rotateBigBangWebhookSecret();
      setConfig(res);
      // Shown exactly once. The admin must copy it now; it cannot be read again.
      setRevealedSecret(res.webhookSecret ?? null);
      toast('Webhook secret generated — copy it now, it will not be shown again');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setWorking(false);
    }
  }, [toast]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>BigBang</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading configuration…</p>
        </CardContent>
      </Card>
    );
  }

  if (error && !config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>BigBang</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!config) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>BigBang</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <CopyableUrl label="Balance Lookup" value={config.urls.userData} />
          <CopyableUrl label="Balance Change" value={config.urls.balanceChange} />
          <CopyableUrl label="Webhook" value={config.urls.webhook} />
        </div>

        <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
          <p className="text-sm text-slate-300">
            Webhook Secret:{' '}
            <span
              className={
                config.webhookSecretConfigured ? 'text-emerald-300' : 'text-amber-300'
              }
            >
              {config.webhookSecretConfigured ? 'Configured' : 'Not configured'}
            </span>
          </p>
          <p className="text-xs text-slate-500">
            The webhook secret is separate from the BigBang API key. It signs
            <code className="mx-1">/bigbang/webhooks</code> only, and is never used by the two
            seamless-wallet callbacks above.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={onRotate} disabled={working}>
              {working
                ? 'Working…'
                : config.webhookSecretConfigured
                  ? 'Rotate Secret'
                  : 'Generate Secret'}
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>

        {revealedSecret ? (
          <div className="rounded-md border border-teal-500/30 bg-teal-500/10 p-3">
            <p className="text-sm font-semibold text-teal-200">
              Copy this secret now — it will not be shown again.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-xs text-slate-100">
                {revealedSecret}
              </code>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(revealedSecret);
                    toast('Secret copied');
                  } catch {
                    toast('Copy failed — select the text manually');
                  }
                }}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setRevealedSecret(null)}
              >
                I have copied it
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
