'use client';

/**
 * Admin — Payment gateway management (secrets masked; encrypted at rest).
 * Endpoints: GET/POST /admin/payment-gateways, PATCH/DELETE/:id,
 * POST /:id/enable | /:id/disable | /:id/test
 */
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminPaymentGateways,
  createAdminPaymentGateway,
  updateAdminPaymentGateway,
  archiveAdminPaymentGateway,
  enableAdminPaymentGateway,
  disableAdminPaymentGateway,
  testAdminPaymentGateway,
  type AdminPaymentGateway,
  type CreateAdminPaymentGatewayInput,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import {
  AdminPageHeader,
  AdminStatusBadge,
  formatDateTime,
} from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  type AdminColumn,
} from '@/components/admin/data-table';
import { ConfirmDialog } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const CURRENCIES = ['BDT', 'USD', 'EUR'];
const AUTH_MODES = ['api-key', 'basic', 'bearer', 'none'];

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

interface GatewayFormState {
  name: string;
  code: string;
  baseUrl: string;
  providerType: string;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  authMode: string;
  apiVersion: string;
  timeoutMs: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
}

const EMPTY_FORM: GatewayFormState = {
  name: '',
  code: '',
  baseUrl: 'https://',
  providerType: 'generic-http',
  supportedCurrencies: ['BDT'],
  depositEnabled: true,
  withdrawalEnabled: true,
  authMode: 'api-key',
  apiVersion: '',
  timeoutMs: '15000',
  apiKey: '',
  apiSecret: '',
  webhookSecret: '',
};

export default function PaymentGatewaysPage() {
  const { toast } = useToast();
  const canCreate = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_CREATE);
  const canUpdate = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE);
  const canDelete = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_DELETE);
  const canTest = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_TEST);
  const [gateways, setGateways] = useState<AdminPaymentGateway[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminPaymentGateway | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPaymentGateway | null>(null);
  const [testTarget, setTestTarget] = useState<AdminPaymentGateway | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState<GatewayFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listAdminPaymentGateways();
      setGateways(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load payment gateways.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(gw: AdminPaymentGateway) {
    setEditTarget(gw);
    setForm({
      name: gw.name,
      code: gw.code,
      baseUrl: gw.baseUrl,
      providerType: gw.providerType || 'generic-http',
      supportedCurrencies: [...gw.supportedCurrencies],
      depositEnabled: gw.depositEnabled,
      withdrawalEnabled: gw.withdrawalEnabled,
      authMode: gw.authMode || 'api-key',
      apiVersion: gw.apiVersion || '',
      timeoutMs: String(gw.timeoutMs || 15000),
      apiKey: '',
      apiSecret: '',
      webhookSecret: '',
    });
    setCreateOpen(true);
  }

  function toggleCurrency(code: string) {
    setForm((p) => ({
      ...p,
      supportedCurrencies: p.supportedCurrencies.includes(code)
        ? p.supportedCurrencies.filter((c) => c !== code)
        : [...p.supportedCurrencies, code],
    }));
  }

  function validateForm(): string | null {
    if (!form.name.trim()) return 'Gateway name is required.';
    if (!form.code.trim()) return 'Gateway code is required.';
    if (!/^[a-z0-9_-]{2,40}$/.test(form.code.trim())) {
      return 'Code must be 2-40 lowercase letters, numbers, underscores or hyphens.';
    }
    if (!form.baseUrl.trim().startsWith('https://') && !form.baseUrl.trim().startsWith('http://')) {
      return 'Base URL must be a valid http(s) URL.';
    }
    if (form.supportedCurrencies.length === 0) return 'Select at least one supported currency.';
    return null;
  }
  async function handleSave() {
    // Double-submit guard (Part 35).
    if (saving) return;
    const invalid = validateForm();
    if (invalid) {
      toast(invalid, 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: CreateAdminPaymentGatewayInput = {
        name: form.name.trim(),
        code: form.code.trim().toLowerCase(),
        providerType: form.providerType,
        baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
        supportedCurrencies: form.supportedCurrencies,
        depositEnabled: form.depositEnabled,
        withdrawalEnabled: form.withdrawalEnabled,
        authMode: form.authMode,
        apiVersion: form.apiVersion.trim() || undefined,
        timeoutMs: Math.min(Math.max(Number.parseInt(form.timeoutMs, 10) || 15000, 1000), 60000),
        apiKey: form.apiKey?.trim() || undefined,
        apiSecret: form.apiSecret?.trim() || undefined,
        webhookSecret: form.webhookSecret?.trim() || undefined,
      };
      const wasEdit = Boolean(editTarget);
      if (editTarget) {
        await updateAdminPaymentGateway(editTarget.id, payload);
      } else {
        await createAdminPaymentGateway(payload);
      }
      // Part 37: close → refresh → THEN show the result.
      setCreateOpen(false);
      setEditTarget(null);
      await load();
      toast(wasEdit ? 'Gateway updated.' : 'Gateway created.', 'success');
    } catch (err) {
      // FAILURE: modal stays open, error toast, values intact, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Failed to save the gateway.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(gw: AdminPaymentGateway, next: 'ACTIVE' | 'INACTIVE') {
    // Double-submit guard (Part 35) for this row.
    if (busyId === gw.id) return;
    setBusyId(gw.id);
    try {
      if (next === 'ACTIVE') await enableAdminPaymentGateway(gw.id);
      else await disableAdminPaymentGateway(gw.id);
      // Part 37: refresh → THEN show the result.
      await load();
      toast(next === 'ACTIVE' ? 'Gateway enabled.' : 'Gateway disabled.', 'success');
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Operation failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(gw: AdminPaymentGateway) {
    setTestTarget(gw);
    setTestResult(null);
    setTesting(true);
    try {
      const result = await testAdminPaymentGateway(gw.id);
      setTestResult(result.ok ? 'Gateway connection successful' : result.message);
    } catch (err) {
      setTestResult(err instanceof ApiClientError ? err.message : 'Gateway unavailable');
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    // Double-submit guard (Part 35).
    if (busyId === deleteTarget.id) return;
    setBusyId(deleteTarget.id);
    try {
      await archiveAdminPaymentGateway(deleteTarget.id);
      // Part 37: close → refresh → THEN show the result.
      setDeleteTarget(null);
      await load();
      toast('Gateway archived.', 'success');
    } catch (err) {
      // FAILURE: confirm dialog stays open, error toast, retry possible.
      toast(err instanceof ApiClientError ? err.message : 'Archive failed.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const columns: Array<AdminColumn<AdminPaymentGateway>> = [
    {
      key: 'name',
      header: 'Gateway',
      render: (gw) => (
        <div>
          <p className="font-medium text-slate-100">{gw.name}</p>
          <p className="text-xs text-slate-500">{gw.code}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (gw) => <AdminStatusBadge value={gw.status} />,
    },
    {
      key: 'credentials',
      header: 'Credentials',
      render: (gw) => (
        <div className="space-y-0.5 text-xs text-slate-400">
          <span className={gw.apiKeySet ? 'text-emerald-300' : 'text-slate-500'}>
            {gw.apiKeySet ? 'API key ✓' : 'API key —'}
          </span>{' '}
          <span className={gw.apiSecretSet ? 'text-emerald-300' : 'text-slate-500'}>
            {gw.apiSecretSet ? 'API secret ✓' : 'API secret —'}
          </span>{' '}
          <span className={gw.webhookSecretSet ? 'text-emerald-300' : 'text-slate-500'}>
            {gw.webhookSecretSet ? 'Webhook ✓' : 'Webhook —'}
          </span>
        </div>
      ),
    },
    {
      key: 'caps',
      header: 'Capabilities',
      render: (gw) => (
        <div className="text-xs text-slate-400">
          <span>{gw.depositEnabled ? 'Deposit ✓' : 'Deposit —'}</span>{' '}
          <span>{gw.withdrawalEnabled ? 'Withdrawal ✓' : 'Withdrawal —'}</span>
        </div>
      ),
    },
    {
      key: 'currencies',
      header: 'Currencies',
      render: (gw) => <span className="text-xs text-slate-300">{gw.supportedCurrencies.join(', ') || '—'}</span>,
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (gw) => <span className="text-xs text-slate-400">{formatDateTime(gw.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (gw) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {canUpdate ? (
            gw.status === 'ACTIVE' ? (
              <Button variant="outline" size="sm" disabled={busyId === gw.id} onClick={() => handleToggle(gw, 'INACTIVE')}>Disable</Button>
            ) : gw.status !== 'ARCHIVED' ? (
              <Button variant="outline" size="sm" disabled={busyId === gw.id} onClick={() => handleToggle(gw, 'ACTIVE')}>Enable</Button>
            ) : null
          ) : null}
          {canTest ? (
            <Button variant="outline" size="sm" disabled={busyId === gw.id || gw.status === 'ARCHIVED'} onClick={() => handleTest(gw)}>Test</Button>
          ) : null}
          {gw.status !== 'ARCHIVED' && (canUpdate || canDelete) && (
            <>
              {canUpdate ? <Button variant="outline" size="sm" disabled={busyId === gw.id} onClick={() => openEdit(gw)}>Edit</Button> : null}
              {canDelete ? <Button variant="danger" size="sm" disabled={busyId === gw.id} onClick={() => setDeleteTarget(gw)}>Archive</Button> : null}
            </>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <AdminPageHeader
        title="Payment gateways"
        description="Configure gateway providers. Credentials are encrypted at rest and never shown again after saving."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Payment gateways' }]}
        actions={canCreate ? <Button onClick={openCreate}>Add gateway</Button> : undefined}
      />

      {error && <AdminErrorState message={error} onRetry={load} />}
      {!gateways && !error && <AdminTableSkeleton rows={4} />}
      {gateways && (
        <AdminTable
          columns={columns}
          rows={gateways}
          rowKey={(gw) => gw.id}
          emptyState={<AdminEmptyState title="No gateways configured" hint="Add a gateway to start processing payments." />}
        />
      )}

      {/* Create / edit modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editTarget ? 'Edit gateway' : 'Add gateway'}
            className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-ink-600 bg-ink-900 p-5 shadow-2xl"
          >
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-200">
              {editTarget ? 'Edit gateway' : 'Add gateway'}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Gateway name</span>
                <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="bKash Gateway" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Gateway code</span>
                <input
                  className={inputClass}
                  value={form.code}
                  disabled={Boolean(editTarget)}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="bkash-gateway"
                  pattern="[a-z0-9_\-]{2,40}"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-xs text-slate-400">Base URL</span>
                <input className={inputClass} value={form.baseUrl} onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))} placeholder="https://gateway.example.com/api" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Provider type</span>
                <select className={inputClass} value={form.providerType} onChange={(e) => setForm((p) => ({ ...p, providerType: e.target.value }))}>
                  <option value="generic-http">generic-http</option>
                  <option value="gateway">gateway</option>
                  <option value="rest">rest</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Auth mode</span>
                <select className={inputClass} value={form.authMode} onChange={(e) => setForm((p) => ({ ...p, authMode: e.target.value }))}>
                  {AUTH_MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">API version</span>
                <input className={inputClass} value={form.apiVersion} onChange={(e) => setForm((p) => ({ ...p, apiVersion: e.target.value }))} placeholder="v1" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Timeout (ms)</span>
                <input className={inputClass} type="number" min={1000} max={60000} value={form.timeoutMs} onChange={(e) => setForm((p) => ({ ...p, timeoutMs: e.target.value }))} />
              </label>
            </div>

            <div className="mt-4">
              <span className="text-xs text-slate-400">Supported currencies</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {CURRENCIES.map((code) => {
                  const active = form.supportedCurrencies.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleCurrency(code)}
                      className={`rounded-md border px-3 py-1 text-sm transition ${
                        active ? 'border-teal-500/60 bg-teal-950/30 text-teal-300' : 'border-ink-600 bg-ink-800 text-slate-300 hover:border-ink-500'
                      }`}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={form.depositEnabled} onChange={(e) => setForm((p) => ({ ...p, depositEnabled: e.target.checked }))} />
                Deposit enabled
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={form.withdrawalEnabled} onChange={(e) => setForm((p) => ({ ...p, withdrawalEnabled: e.target.checked }))} />
                Withdrawal enabled
              </label>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">
                  API key{editTarget?.apiKeySet ? ' (leave empty to keep current · Configured ✓)' : ''}
                </span>
                <input className={inputClass} type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">
                  API secret{editTarget?.apiSecretSet ? ' (leave empty to keep current · Configured ✓)' : ''}
                </span>
                <input className={inputClass} type="password" autoComplete="new-password" value={form.apiSecret} onChange={(e) => setForm((p) => ({ ...p, apiSecret: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">
                  Webhook secret{editTarget?.webhookSecretSet ? ' (leave empty to keep current · Configured ✓)' : ''}
                </span>
                <input className={inputClass} type="password" autoComplete="new-password" value={form.webhookSecret} onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))} />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setCreateOpen(false); setEditTarget(null); }} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} loading={saving}>
                {editTarget ? 'Save changes' : 'Create gateway'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Test connection modal */}
      {testTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-label="Test gateway" className="max-h-[85vh] w-full max-w-md rounded-lg border border-ink-600 bg-ink-900 p-5 shadow-2xl">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-200">Test connection</h2>
            <p className="text-sm text-slate-300">Testing <span className="font-medium text-slate-100">{testTarget.name}</span>…</p>
            {testing ? (
              <p className="mt-3 text-sm text-amber-300">Contacting gateway…</p>
            ) : testResult ? (
              <p className={`mt-3 text-sm ${testResult === 'Gateway connection successful' ? 'text-emerald-300' : testResult === 'Gateway authentication failed' || testResult === 'Gateway unavailable' ? 'text-red-300' : 'text-amber-300'}`}>
                {testResult}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button variant="outline" onClick={() => setTestTarget(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Archive gateway"
        message={`Archive ${deleteTarget?.name}? Existing payment methods stay untouched but can no longer use this gateway.`}
        confirmLabel="Archive"
        danger
        loading={busyId === deleteTarget?.id}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}