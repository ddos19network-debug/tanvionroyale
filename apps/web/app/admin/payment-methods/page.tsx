'use client';

/**
 * Admin — Payment Methods management.
 *
 * Full CRUD against the REAL admin endpoints:
 *   GET  /admin/payment-methods
 *   POST /admin/payment-methods
 *   PATCH /admin/payment-methods/:id
 *   POST /admin/payment-methods/:id/archive
 *
 * Supports:
 *   MANUAL  -> account/payment instructions shown to users
 *   GATEWAY -> payment is handled by a configured gateway/provider
 *
 * No provider secrets are stored in this frontend form.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';

import {
  listAdminPaymentMethods,
  createAdminPaymentMethod,
  updateAdminPaymentMethod,
  archiveAdminPaymentMethod,
  type AdminPaymentMethod,
  type CreateAdminPaymentMethodInput,
} from '@/lib/api/admin';

import { describeApiError } from '@/lib/api/client';

import {
  AdminPageHeader,
  AdminStatusBadge,
} from '@/components/admin/ui';

import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  type AdminColumn,
} from '@/components/admin/data-table';

import { Modal, ConfirmDialog } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

const PAYMENT_TYPES = ['MANUAL', 'GATEWAY'] as const;

type PaymentType = (typeof PAYMENT_TYPES)[number];

/**
 * Form field state.
 *
 * Numeric limits are kept as strings so admins can clear them.
 * They are converted to backend integer values on save.
 */
interface FormState {
  code: string;
  displayName: string;
  type: PaymentType;
  supportedCurrencies: string[];

  depositEnabled: boolean;
  withdrawalEnabled: boolean;

  accountNumber: string;
  accountName: string;
  bankName: string;
  branch: string;
  routingNumber: string;

  instructions: string;

  minDeposit: string;
  maxDeposit: string;
  minWithdrawal: string;
  maxWithdrawal: string;

  requireTransactionId: boolean;
  requireProof: boolean;

  sortOrder: string;
}

function emptyForm(): FormState {
  return {
    code: '',
    displayName: '',
    type: 'MANUAL',

    supportedCurrencies: ['BDT'],

    depositEnabled: true,
    withdrawalEnabled: false,

    accountNumber: '',
    accountName: '',
    bankName: '',
    branch: '',
    routingNumber: '',

    instructions: '',

    minDeposit: '',
    maxDeposit: '',
    minWithdrawal: '',
    maxWithdrawal: '',

    requireTransactionId: true,
    requireProof: false,

    sortOrder: '',
  };
}

function normalizePaymentType(value: unknown): PaymentType {
  return value === 'GATEWAY' ? 'GATEWAY' : 'MANUAL';
}

function formFromMethod(m: AdminPaymentMethod): FormState {
  return {
    code: m.code,
    displayName: m.displayName,

    type: normalizePaymentType(
      (m as AdminPaymentMethod & { type?: unknown }).type,
    ),

    supportedCurrencies: Array.isArray(m.supportedCurrencies)
      ? m.supportedCurrencies
      : ['BDT'],

    depositEnabled: m.depositEnabled,
    withdrawalEnabled: m.withdrawalEnabled,

    accountNumber: m.accountNumber ?? '',
    accountName: m.accountName ?? '',
    bankName: m.bankName ?? '',
    branch: m.branch ?? '',
    routingNumber: m.routingNumber ?? '',

    instructions: m.instructions ?? '',

    minDeposit:
      m.minDeposit !== undefined && m.minDeposit !== null
        ? String(m.minDeposit)
        : '',

    maxDeposit:
      m.maxDeposit !== undefined && m.maxDeposit !== null
        ? String(m.maxDeposit)
        : '',

    minWithdrawal:
      m.minWithdrawal !== undefined && m.minWithdrawal !== null
        ? String(m.minWithdrawal)
        : '',

    maxWithdrawal:
      m.maxWithdrawal !== undefined && m.maxWithdrawal !== null
        ? String(m.maxWithdrawal)
        : '',

    requireTransactionId: m.requireTransactionId,
    requireProof: m.requireProof,

    sortOrder:
      m.sortOrder !== undefined && m.sortOrder !== null
        ? String(m.sortOrder)
        : '',
  };
}

function toOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const n = Number(trimmed);

  return Number.isFinite(n) && Number.isInteger(n)
    ? n
    : undefined;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';

    case 'INACTIVE':
      return 'Inactive';

    case 'ARCHIVED':
      return 'Archived';

    default:
      return status;
  }
}

/**
 * Builds the shared create/update field payload from the form.
 *
 * `code` is deliberately excluded here because the backend treats
 * payment method code as immutable after creation.
 */
function buildFields(
  form: FormState,
): Omit<CreateAdminPaymentMethodInput, 'code'> {
  const payload = {
    displayName: form.displayName.trim(),

    /**
     * IMPORTANT:
     * This is the payment processing mode:
     *
     * MANUAL  -> show configured account/payment information
     * GATEWAY -> use configured gateway/provider
     */
    type: form.type,

    supportedCurrencies: form.supportedCurrencies,

    depositEnabled: form.depositEnabled,
    withdrawalEnabled: form.withdrawalEnabled,

    minDeposit: toOptionalInt(form.minDeposit),
    maxDeposit: toOptionalInt(form.maxDeposit),

    minWithdrawal: toOptionalInt(form.minWithdrawal),
    maxWithdrawal: toOptionalInt(form.maxWithdrawal),

    requireTransactionId:
      form.type === 'MANUAL'
        ? form.requireTransactionId
        : false,

    requireProof:
      form.type === 'MANUAL'
        ? form.requireProof
        : false,

    sortOrder: toOptionalInt(form.sortOrder),
  } as Omit<CreateAdminPaymentMethodInput, 'code'>;

  /**
   * Manual payment account fields.
   *
   * Gateway credentials/secrets must NEVER be collected or stored
   * in this frontend admin form.
   */
  if (form.type === 'MANUAL') {
    const optionalStrings = [
      'accountNumber',
      'accountName',
      'bankName',
      'branch',
      'routingNumber',
      'instructions',
    ] as const;

    for (const field of optionalStrings) {
      const value = form[field].trim();

      if (value) {
        payload[field] = value;
      }
    }
  } else {
    /**
     * Gateway mode:
     *
     * Do not send manual account information.
     * Gateway credentials belong to secure backend configuration.
     */
    payload.instructions = form.instructions.trim() || undefined;
  }

  return payload;
}

export default function AdminPaymentMethodsPage() {
  const { toast } = useToast();
  const canCreate = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_METHODS_CREATE);
  const canUpdate = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_METHODS_UPDATE);
  const canArchive = useAdminPermission(ADMIN_PERMISSIONS.PAYMENT_METHODS_ARCHIVE);

  const [methods, setMethods] = useState<
    AdminPaymentMethod[] | null
  >(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] =
    useState<AdminPaymentMethod | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm());

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] =
    useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] =
    useState<AdminPaymentMethod | null>(null);

  const [archiving, setArchiving] = useState(false);

  /** Busy id for the per-row Enable/Disable toggle (Part 35). */
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await listAdminPaymentMethods();

      setMethods(result);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(m: AdminPaymentMethod) {
    setEditing(m);
    setForm(formFromMethod(m));
    setFormError(null);
    setFormOpen(true);
  }

  function toggleCurrency(
    currency: string,
    checked: boolean,
  ) {
    setForm((prev) => {
      if (
        !checked &&
        prev.supportedCurrencies.length <= 1
      ) {
        return prev;
      }

      const next = checked
        ? Array.from(
            new Set([
              ...prev.supportedCurrencies,
              currency,
            ]),
          )
        : prev.supportedCurrencies.filter(
            (c) => c !== currency,
          );

      return {
        ...prev,
        supportedCurrencies: next,
      };
    });
  }

  function changePaymentType(type: PaymentType) {
    setForm((prev) => ({
      ...prev,
      type,

      /**
       * Gateway payments do not require manual proof fields.
       */
      ...(type === 'GATEWAY'
        ? {
            requireTransactionId: false,
            requireProof: false,
          }
        : {}),
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    setFormError(null);

    if (!form.displayName.trim()) {
      setFormError(
        'Payment method name is required.',
      );

      return;
    }

    if (
      form.supportedCurrencies.length === 0
    ) {
      setFormError(
        'Select at least one supported currency.',
      );

      return;
    }

    if (!editing) {
      const code = form.code.trim();

      if (
        !/^[a-z0-9_\-]{2,40}$/.test(code)
      ) {
        setFormError(
          'Code must be 2-40 lowercase letters, numbers, underscores or hyphens.',
        );

        return;
      }
    }

    const fields = buildFields(form);
    const wasEditing = Boolean(editing);

    // Double-submit guard (Part 35).
    if (saving) return;
    setSaving(true);

    try {
      if (editing) {
        await updateAdminPaymentMethod(
          editing.id,
          fields,
        );
      } else {
        await createAdminPaymentMethod({
          ...fields,
          code: form.code.trim(),
        });
      }

      // Part 37: close the modal → refresh the list → THEN show the result.
      setFormOpen(false);
      await load();
      toast(
        wasEditing
          ? 'Payment method updated.'
          : 'Payment method created.',
        'success',
      );
    } catch (err) {
      // FAILURE: modal stays open, error rendered inside it, values intact.
      setFormError(
        describeApiError(err),
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(
    m: AdminPaymentMethod,
  ) {
    // Double-submit guard (Part 35) for this row.
    if (togglingId === m.id) return;
    setTogglingId(m.id);
    try {
      const next =
        m.status === 'ACTIVE'
          ? 'INACTIVE'
          : 'ACTIVE';

      await updateAdminPaymentMethod(
        m.id,
        {
          status: next,
        },
      );

      // Part 37: refresh the list → THEN show the result.
      await load();
      toast(
        `Payment method ${
          next === 'ACTIVE'
            ? 'enabled'
            : 'disabled'
        }.`,
        'success',
      );
    } catch (err) {
      toast(
        describeApiError(err),
        'error',
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function onArchive() {
    if (!archiveTarget) {
      return;
    }
    // Double-submit guard (Part 35).
    if (archiving) return;

    setArchiving(true);

    try {
      await archiveAdminPaymentMethod(
        archiveTarget.id,
      );

      // Part 37: close the confirm dialog → refresh → THEN show the result.
      setArchiveTarget(null);
      await load();
      toast(
        'Payment method archived.',
        'success',
      );
    } catch (err) {
      // FAILURE: dialog stays open, error toast, retry possible.
      toast(
        describeApiError(err),
        'error',
      );
    } finally {
      setArchiving(false);
    }
  }

  const columns: Array<
    AdminColumn<AdminPaymentMethod>
  > = [
    {
      key: 'name',
      header: 'Name',

      render: (m) => (
        <div>
          <p className="font-medium text-white">
            {m.displayName}
          </p>

          <p className="text-xs text-slate-500">
            {m.code}
          </p>
        </div>
      ),
    },

    {
      key: 'type',
      header: 'Mode',

      render: (m) => {
        const type = normalizePaymentType(
          (
            m as AdminPaymentMethod & {
              type?: unknown;
            }
          ).type,
        );

        return (
          <span
            className={
              type === 'GATEWAY'
                ? 'inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-300'
                : 'inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300'
            }
          >
            {type}
          </span>
        );
      },
    },

    {
      key: 'currencies',
      header: 'Currencies',

      render: (m) => (
        <span className="text-xs text-slate-300">
          {m.supportedCurrencies.join(', ') ||
            '—'}
        </span>
      ),
    },

    {
      key: 'deposit',
      header: 'Deposit',

      render: (m) =>
        m.depositEnabled ? (
          <span className="text-emerald-300">
            ✓
          </span>
        ) : (
          <span className="text-slate-300">
            —
          </span>
        ),
    },

    {
      key: 'withdrawal',
      header: 'Withdrawal',

      render: (m) =>
        m.withdrawalEnabled ? (
          <span className="text-emerald-300">
            ✓
          </span>
        ) : (
          <span className="text-slate-300">
            —
          </span>
        ),
    },

    {
      key: 'status',
      header: 'Status',

      render: (m) => (
        <AdminStatusBadge
          value={statusLabel(m.status)}
        />
      ),
    },

    {
      key: 'sortOrder',
      header: 'Sort',

      render: (m) => (
        <span className="text-xs text-slate-400">
          {m.sortOrder}
        </span>
      ),
    },

    {
      key: 'actions',
      header: 'Actions',

      render: (m) => (
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openEdit(m)}
            >
              Edit
            </Button>
          ) : null}

          {canUpdate && m.status !== 'ARCHIVED' ? (
            <Button
              size="sm"
              variant="outline"
              loading={togglingId === m.id}
              onClick={() =>
                void toggleStatus(m)
              }
            >
              {m.status === 'ACTIVE'
                ? 'Disable'
                : 'Enable'}
            </Button>
          ) : null}

          {canArchive && m.status !== 'ARCHIVED' ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                setArchiveTarget(m)
              }
            >
              Archive
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const inputClass =
    'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

  return (
    <div className="min-w-0">
      <AdminPageHeader
        title="Payment Methods"
        description="Manage manual payment methods and gateway payment methods. Changes become available to users after saving."
        crumbs={[
          {
            label: 'Admin',
            href: '/admin',
          },
          {
            label: 'Payment methods',
          },
        ]}
        actions={canCreate ? (
          <Button
            size="sm"
            onClick={openCreate}
          >
            + Add Payment Method
          </Button>
        ) : undefined}
      />

      {loading && !methods ? (
        <AdminTableSkeleton rows={6} />
      ) : error ? (
        <AdminErrorState
          message={error}
          onRetry={() => void load()}
        />
      ) : methods ? (
        <AdminTable
          columns={columns}
          rows={methods}
          rowKey={(m) => m.id}
          emptyState={
            <AdminEmptyState
              title="No payment methods yet"
              hint="Click “Add Payment Method” to create the first payment method."
            />
          }
        />
      ) : null}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        title={
          editing
            ? `Edit — ${editing.displayName}`
            : 'Add Payment Method'
        }
        onClose={() =>
          setFormOpen(false)
        }
        wide
        footer={
          <>
            <Button
              variant="outline"
              onClick={() =>
                setFormOpen(false)
              }
              disabled={saving}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              form="payment-method-form"
              loading={saving}
            >
              {editing
                ? 'Save changes'
                : 'Create method'}
            </Button>
          </>
        }
      >
        <form
          id="payment-method-form"
          onSubmit={onSubmit}
          className="space-y-4"
        >
          {formError && (
            <p
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300"
            >
              {formError}
            </p>
          )}

          {/* Code + Name */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Payment method code
              </span>

              <input
                className={inputClass}
                value={form.code}
                disabled={Boolean(editing)}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    code: e.target.value,
                  }))
                }
                placeholder="bkash"
                pattern="[a-z0-9_\-]{2,40}"
              />

              <span className="text-[11px] text-slate-500">
                Lowercase URL-safe code, e.g.
                bkash / nagad / rocket / bank /
                card.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Payment method name
              </span>

              <input
                className={inputClass}
                value={form.displayName}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    displayName:
                      e.target.value,
                  }))
                }
                placeholder="bKash"
              />
            </label>
          </div>

          {/* MANUAL / GATEWAY */}
          <fieldset className="space-y-2">
            <legend className="text-xs text-slate-400">
              Payment processing mode
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              {PAYMENT_TYPES.map((type) => {
                const selected =
                  form.type === type;

                return (
                  <label
                    key={type}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                      selected
                        ? 'border-teal-500/60 bg-teal-950/20'
                        : 'border-ink-600 bg-ink-800 hover:border-ink-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentType"
                      value={type}
                      checked={selected}
                      onChange={() =>
                        changePaymentType(type)
                      }
                      className="mt-1 h-4 w-4 accent-teal-500"
                    />

                    <span className="min-w-0">
                      <span
                        className={`block text-sm font-medium ${
                          selected
                            ? 'text-teal-200'
                            : 'text-slate-200'
                        }`}
                      >
                        {type}
                      </span>

                      <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                        {type === 'MANUAL'
                          ? 'User pays to an admin-configured account and submits payment proof.'
                          : 'Payment is processed through a configured payment gateway/provider.'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Currency */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-slate-400">
              Supported currencies
            </legend>

            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((currency) => {
                const checked =
                  form.supportedCurrencies.includes(
                    currency,
                  );

                return (
                  <label
                    key={currency}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      checked
                        ? 'border-teal-500/60 bg-teal-950/20 text-teal-200'
                        : 'border-ink-600 bg-ink-800 text-slate-400 hover:border-ink-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        toggleCurrency(
                          currency,
                          e.target.checked,
                        )
                      }
                      className="h-4 w-4 rounded border-ink-600 bg-ink-700 accent-teal-500"
                    />

                    {currency}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Deposit / Withdrawal */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200">
              <span>Deposit enabled</span>

              <input
                type="checkbox"
                checked={form.depositEnabled}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    depositEnabled:
                      e.target.checked,
                  }))
                }
                className="h-4 w-4 accent-teal-500"
              />
            </label>

            <label className="flex items-center justify-between rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200">
              <span>
                Withdrawal enabled
              </span>

              <input
                type="checkbox"
                checked={form.withdrawalEnabled}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    withdrawalEnabled:
                      e.target.checked,
                  }))
                }
                className="h-4 w-4 accent-teal-500"
              />
            </label>
          </div>

          {/* Manual account fields */}
          {form.type === 'MANUAL' && (
            <>
              <div className="rounded-lg border border-teal-500/20 bg-teal-950/10 px-3 py-2">
                <p className="text-xs font-medium text-teal-200">
                  Manual payment account
                </p>

                <p className="mt-1 text-[11px] leading-4 text-slate-500">
                  Users will see these details after
                  selecting this payment method.
                  Never put gateway secrets here.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Account number
                  </span>

                  <input
                    className={inputClass}
                    value={form.accountNumber}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        accountNumber:
                          e.target.value,
                      }))
                    }
                    placeholder="01712345678"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Account name
                  </span>

                  <input
                    className={inputClass}
                    value={form.accountName}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        accountName:
                          e.target.value,
                      }))
                    }
                    placeholder="TANVION ROYALE"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Bank name
                  </span>

                  <input
                    className={inputClass}
                    value={form.bankName}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        bankName:
                          e.target.value,
                      }))
                    }
                    placeholder="BRAC Bank"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Branch
                  </span>

                  <input
                    className={inputClass}
                    value={form.branch}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        branch:
                          e.target.value,
                      }))
                    }
                    placeholder="Gulshan"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Routing number
                  </span>

                  <input
                    className={inputClass}
                    value={form.routingNumber}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        routingNumber:
                          e.target.value,
                      }))
                    }
                    placeholder="060277536"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">
                    Sort order
                  </span>

                  <input
                    className={inputClass}
                    value={form.sortOrder}
                    inputMode="numeric"
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        sortOrder:
                          e.target.value.replace(
                            /[^\d-]/g,
                            '',
                          ),
                      }))
                    }
                    placeholder="0"
                  />
                </label>
              </div>
            </>
          )}

          {/* Gateway information */}
          {form.type === 'GATEWAY' && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-950/10 px-3 py-3">
              <p className="text-sm font-medium text-blue-200">
                Gateway mode
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                Gateway credentials must be configured
                securely on the backend/server. They
                must never be exposed in this frontend
                form.
              </p>
            </div>
          )}

          {/* Limits */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Minimum deposit (minor units)
              </span>

              <input
                className={inputClass}
                value={form.minDeposit}
                inputMode="numeric"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    minDeposit:
                      e.target.value.replace(
                        /\D/g,
                        '',
                      ),
                  }))
                }
                placeholder="100"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Maximum deposit (minor units)
              </span>

              <input
                className={inputClass}
                value={form.maxDeposit}
                inputMode="numeric"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    maxDeposit:
                      e.target.value.replace(
                        /\D/g,
                        '',
                      ),
                  }))
                }
                placeholder="500000"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Minimum withdrawal (minor units)
              </span>

              <input
                className={inputClass}
                value={form.minWithdrawal}
                inputMode="numeric"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    minWithdrawal:
                      e.target.value.replace(
                        /\D/g,
                        '',
                      ),
                  }))
                }
                placeholder="100"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">
                Maximum withdrawal (minor units)
              </span>

              <input
                className={inputClass}
                value={form.maxWithdrawal}
                inputMode="numeric"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    maxWithdrawal:
                      e.target.value.replace(
                        /\D/g,
                        '',
                      ),
                  }))
                }
                placeholder="100000"
              />
            </label>

            <p className="text-[11px] text-slate-500 sm:col-span-2">
              Amounts are stored as integers. Leave
              empty for no limit.
            </p>
          </div>

          {/* Instructions */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">
              Instructions (shown to users)
            </span>

            <textarea
              className={inputClass}
              rows={3}
              value={form.instructions}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  instructions:
                    e.target.value,
                }))
              }
              placeholder={
                form.type === 'MANUAL'
                  ? 'Send the exact amount and enter the transaction ID below.'
                  : 'Payment instructions or provider information.'
              }
            />
          </label>

          {/* Manual proof requirements */}
          {form.type === 'MANUAL' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200">
                <span>
                  Require transaction ID
                </span>

                <input
                  type="checkbox"
                  checked={
                    form.requireTransactionId
                  }
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      requireTransactionId:
                        e.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-teal-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-200">
                <span>
                  Require proof (screenshot)
                </span>

                <input
                  type="checkbox"
                  checked={form.requireProof}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      requireProof:
                        e.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-teal-500"
                />
              </label>
            </div>
          )}

          {form.type === 'GATEWAY' && (
            <p className="text-[11px] leading-4 text-slate-500">
              Gateway payments do not use the manual
              transaction-ID/screenshot requirement
              configured above. Gateway verification
              must happen through the backend provider
              integration.
            </p>
          )}
        </form>
      </Modal>

      {/* Archive confirmation */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive payment method"
        message={
          archiveTarget
            ? `Archive “${archiveTarget.displayName}” (${archiveTarget.code})? It will be removed from the user-visible deposit and withdrawal lists immediately.`
            : ''
        }
        confirmLabel="Archive"
        danger
        loading={archiving}
        onCancel={() =>
          setArchiveTarget(null)
        }
        onConfirm={() =>
          void onArchive()
        }
      />
    </div>
  );
}
