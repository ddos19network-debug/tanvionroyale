'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminUsers,
  getAdminWalletDetail,
  adjustAdminWallet,
  type AdminUserListItem,
  type AdminWalletDetail,
  type AdminWalletTransactionItem,
} from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import {
  AdminPageHeader,
  AdminStatusBadge,
  formatDateTime,
  formatMinor,
} from '@/components/admin/ui';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminErrorState,
  AdminEmptyState,
  AdminPagination,
} from '@/components/admin/data-table';
import { ConfirmDialog } from '@/components/admin/modal';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const inputClass =
  'w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30';

const TX_TYPES = [
  '',
  'DEPOSIT',
  'WITHDRAWAL',
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'ADJUSTMENT',
];

const TX_STATUSES = [
  '',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REVERSED',
];

const CURRENCIES = ['', 'BDT', 'USD', 'EUR'];

function newIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto
  ) {
    return crypto.randomUUID();
  }

  return `admin-wallet-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getCurrencyLabel(currency: string) {
  switch (currency) {
    case 'BDT':
      return '৳ BDT';
    case 'USD':
      return '$ USD';
    case 'EUR':
      return '€ EUR';
    default:
      return currency;
  }
}

export default function AdminWalletsPage() {
  const { toast } = useToast();
  const canManage = useAdminPermission(ADMIN_PERMISSIONS.WALLETS_MANAGE);

  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] =
    useState<AdminUserListItem[] | null>(null);
  const [searchError, setSearchError] =
    useState<string | null>(null);

  const [selected, setSelected] =
    useState<AdminUserListItem | null>(null);

  const [detail, setDetail] =
    useState<AdminWalletDetail | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] =
    useState<string | null>(null);

  const [txPage, setTxPage] = useState(1);
  const [txType, setTxType] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [txCurrency, setTxCurrency] = useState('');

  const pageSize = 15;

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [amountMajor, setAmountMajor] = useState('');
  const [direction, setDirection] =
    useState<'credit' | 'debit'>('credit');
  const [adjustCurrency, setAdjustCurrency] =
    useState<'BDT' | 'USD' | 'EUR'>('BDT');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  async function runSearch() {
    if (search.trim().length < 2) {
      toast(
        'Enter at least 2 characters (email, username, phone or name).',
        'error',
      );
      return;
    }

    setSearching(true);
    setSearchError(null);

    try {
      const res = await listAdminUsers({
        q: search.trim(),
        limit: 10,
      });

      setResults(res.items);
    } catch (err) {
      setSearchError(
        err instanceof ApiClientError
          ? err.message
          : 'Search failed.',
      );
    } finally {
      setSearching(false);
    }
  }

  const loadDetail = useCallback(
    async (
      userId: string,
      page: number,
      type: string,
      status: string,
      currency: string,
    ) => {
      setDetailLoading(true);
      setDetailError(null);

      try {
        const res = await getAdminWalletDetail(userId, {
          page,
          limit: pageSize,
          type: type || undefined,
          status: status || undefined,
          currency: currency || undefined,
        });

        setDetail(res);
      } catch (err) {
        setDetailError(
          err instanceof ApiClientError
            ? err.message
            : 'Failed to load wallet details.',
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [pageSize],
  );

  useEffect(() => {
    if (!selected) return;

    void loadDetail(
      selected.id,
      txPage,
      txType,
      txStatus,
      txCurrency,
    );
  }, [
    selected,
    txPage,
    txType,
    txStatus,
    txCurrency,
    loadDetail,
  ]);

  function selectUser(user: AdminUserListItem) {
    setSelected(user);
    setDetail(null);
    setDetailError(null);
    setTxPage(1);
    setTxType('');
    setTxStatus('');
    setTxCurrency('');
  }

  function openAdjust() {
    setAmountMajor('');
    setDirection('credit');
    setAdjustCurrency('BDT');
    setReason('');
    setAdjustOpen(true);
  }

  function parsedMinor(): number {
    const parsed = Number.parseFloat(
      (amountMajor || '0')
        .replace(/,/g, '')
        .trim(),
    );

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.floor(parsed * 100);
  }

  async function submitAdjustment() {
    if (!selected) return;
    // Double-submit guard (Part 35).
    if (adjusting) return;

    const minor = parsedMinor();

    if (minor <= 0) {
      toast('Enter a valid positive amount.', 'error');
      return;
    }

    if (reason.trim().length < 3) {
      toast(
        'A reason (minimum 3 characters) is mandatory.',
        'error',
      );
      return;
    }

    setAdjusting(true);

    try {
      const res = await adjustAdminWallet(selected.id, {
        amount:
          direction === 'credit' ? minor : -minor,
        reason: reason.trim(),
        idempotencyKey: newIdempotencyKey(),
        currency: adjustCurrency,
      });

      // Part 37: close → refresh the wallet detail → THEN show the result.
      setAdjustOpen(false);

      await loadDetail(
        selected.id,
        txPage,
        txType,
        txStatus,
        txCurrency,
      );

      toast(
        res.duplicate
          ? 'Duplicate request detected. No double credit was applied.'
          : `Adjustment complete: ${formatMinor(
              res.transaction.amount,
              res.transaction.currency,
            )}. New balance: ${formatMinor(
              res.wallet.availableBalance,
              res.wallet.currency,
            )}.`,
        'success',
      );
    } catch (err) {
      // FAILURE: dialog stays open, error toast, retry possible.
      toast(
        err instanceof ApiClientError
          ? err.message
          : 'Adjustment failed.',
        'error',
      );
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Wallets"
        description="Manage user wallets, review balances and transactions, and make audited manual adjustments."
        crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Wallets' },
        ]}
      />

      {/* Search */}
      <form
        className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-slate-400">
            Find a user
          </span>

          <input
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            placeholder="Email, username, phone or name…"
          />
        </label>

        <Button
          type="submit"
          loading={searching}
          className="w-full sm:w-auto"
        >
          Search
        </Button>
      </form>

      {searchError && (
        <AdminErrorState
          message={searchError}
          onRetry={() => void runSearch()}
        />
      )}

      {results && results.length === 0 && (
        <AdminEmptyState
          title="No users matched your search"
        />
      )}

      {/* Search results */}
      {results && results.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Search results
          </h2>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => selectUser(user)}
                className={`rounded-lg border px-3 py-3 text-left transition ${
                  selected?.id === user.id
                    ? 'border-teal-500/60 bg-teal-950/20'
                    : 'border-ink-600 bg-ink-900 hover:border-teal-500/40'
                }`}
              >
                <p className="break-all text-sm font-medium text-white">
                  {user.username}
                </p>

                <p className="mt-1 break-all text-xs text-slate-500">
                  {user.email ||
                    user.phone ||
                    user.id}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <AdminStatusBadge value={user.status} />

                  <span className="text-xs text-slate-500">
                    {user.roles.join(', ') || '—'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected user */}
      {selected && (
        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Wallet —{' '}
                <span className="text-teal-300">
                  {selected.username}
                </span>
              </h2>

              <p className="mt-1 break-all text-xs text-slate-500">
                {selected.email ||
                  selected.phone ||
                  selected.id}
              </p>
            </div>

            {canManage ? (
              <Button
                size="sm"
                onClick={openAdjust}
                className="w-full sm:w-auto"
              >
                New adjustment
              </Button>
            ) : null}
          </div>

          {detailLoading && !detail ? (
            <AdminTableSkeleton />
          ) : detailError ? (
            <AdminErrorState
              message={detailError}
              onRetry={() =>
                void loadDetail(
                  selected.id,
                  txPage,
                  txType,
                  txStatus,
                  txCurrency,
                )
              }
            />
          ) : detail ? (
            <div className="space-y-4">
              {/* Currency wallets */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {detail.wallets.length === 0 ? (
                  <div className="rounded-lg border border-ink-600 bg-ink-900 p-4">
                    <p className="text-sm text-slate-400">
                      This user has no wallets yet.
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      A wallet is created when the first funded
                      transaction is completed.
                    </p>
                  </div>
                ) : (
                  detail.wallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="rounded-lg border border-ink-600 bg-ink-900 px-4 py-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          {getCurrencyLabel(
                            wallet.currency,
                          )}
                        </p>

                        <AdminStatusBadge
                          value={wallet.status}
                        />
                      </div>

                      <p className="mt-2 break-all text-xl font-semibold text-white">
                        {formatMinor(
                          wallet.availableBalance,
                          wallet.currency,
                        )}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Locked:{' '}
                        {formatMinor(
                          wallet.lockedBalance,
                          wallet.currency,
                        )}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {/* Transaction filters */}
              <div className="rounded-lg border border-ink-600 bg-ink-900 p-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-slate-400">
                      Type
                    </span>

                    <select
                      className={inputClass}
                      value={txType}
                      onChange={(e) => {
                        setTxType(e.target.value);
                        setTxPage(1);
                      }}
                    >
                      {TX_TYPES.map((type) => (
                        <option
                          key={type}
                          value={type}
                        >
                          {type === ''
                            ? 'All types'
                            : type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-slate-400">
                      Status
                    </span>

                    <select
                      className={inputClass}
                      value={txStatus}
                      onChange={(e) => {
                        setTxStatus(e.target.value);
                        setTxPage(1);
                      }}
                    >
                      {TX_STATUSES.map((status) => (
                        <option
                          key={status}
                          value={status}
                        >
                          {status === ''
                            ? 'All statuses'
                            : status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-slate-400">
                      Currency
                    </span>

                    <select
                      className={inputClass}
                      value={txCurrency}
                      onChange={(e) => {
                        setTxCurrency(e.target.value);
                        setTxPage(1);
                      }}
                    >
                      {CURRENCIES.map((currency) => (
                        <option
                          key={currency}
                          value={currency}
                        >
                          {currency === ''
                            ? 'All currencies'
                            : getCurrencyLabel(
                                currency,
                              )}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Transactions */}
              <TransactionsTable
                transactions={
                  detail.transactions.items
                }
                onRetry={() =>
                  void loadDetail(
                    selected.id,
                    txPage,
                    txType,
                    txStatus,
                    txCurrency,
                  )
                }
                loading={detailLoading}
              />

              <AdminPagination
                page={detail.transactions.page}
                limit={detail.transactions.limit}
                total={detail.transactions.total}
                onPageChange={setTxPage}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Adjustment dialog */}
      <ConfirmDialog
        open={adjustOpen}
        title="Confirm wallet adjustment"
        danger={direction === 'debit'}
        confirmLabel={
          direction === 'credit'
            ? 'Credit wallet'
            : 'Debit wallet'
        }
        loading={adjusting}
        onConfirm={() => void submitAdjustment()}
        onCancel={() => setAdjustOpen(false)}
        message={
          <div className="space-y-4">
            <p className="text-sm leading-6">
              You are about to{' '}
              <span className="font-semibold text-white">
                {direction === 'credit'
                  ? 'credit'
                  : 'debit'}
              </span>{' '}
              the wallet of{' '}
              <span className="font-medium text-teal-300">
                {selected?.username}
              </span>
              .
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Direction */}
              <label className="flex flex-col gap-1 text-sm">
                <span>Direction</span>

                <select
                  className={inputClass}
                  value={direction}
                  onChange={(e) =>
                    setDirection(
                      e.target.value as
                        | 'credit'
                        | 'debit',
                    )
                  }
                >
                  <option value="credit">
                    Credit (+)
                  </option>

                  <option value="debit">
                    Debit (−)
                  </option>
                </select>
              </label>

              {/* Currency */}
              <label className="flex flex-col gap-1 text-sm">
                <span>Currency</span>

                <select
                  className={inputClass}
                  value={adjustCurrency}
                  onChange={(e) =>
                    setAdjustCurrency(
                      e.target.value as
                        | 'BDT'
                        | 'USD'
                        | 'EUR',
                    )
                  }
                >
                  <option value="BDT">
                    ৳ BDT
                  </option>

                  <option value="USD">
                    $ USD
                  </option>

                  <option value="EUR">
                    € EUR
                  </option>
                </select>
              </label>

              {/* Amount */}
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span>
                  Amount ({adjustCurrency}, major units)
                </span>

                <input
                  className={inputClass}
                  value={amountMajor}
                  onChange={(e) =>
                    setAmountMajor(
                      e.target.value,
                    )
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                />

                {parsedMinor() > 0 && (
                  <span className="text-xs text-slate-500">
                    Adjustment:{' '}
                    {formatMinor(
                      direction === 'credit'
                        ? parsedMinor()
                        : -parsedMinor(),
                      adjustCurrency,
                    )}
                  </span>
                )}
              </label>

              {/* Reason */}
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span>
                  Reason{' '}
                  <span className="text-red-400">
                    *
                  </span>
                </span>

                <input
                  className={inputClass}
                  value={reason}
                  onChange={(e) =>
                    setReason(e.target.value)
                  }
                  maxLength={500}
                  placeholder="e.g. Goodwill credit after settlement review"
                />

                <span className="text-xs text-slate-500">
                  This reason is stored in the audit trail.
                </span>
              </label>
            </div>

            <div className="rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs leading-5 text-amber-300">
              This operation changes the real wallet balance
              through the backend ledger. Do not submit an
              adjustment unless the amount, currency and reason
              are correct.
            </div>
          </div>
        }
      />
    </div>
  );
}

function TransactionsTable({
  transactions,
  loading,
}: {
  transactions: AdminWalletTransactionItem[];
  onRetry: () => void;
  loading: boolean;
}) {
  return (
    <AdminTable
      columns={[
        {
          key: 'created',
          header: 'Date',
          render: (transaction) => (
            <span className="text-xs text-slate-400">
              {formatDateTime(
                transaction.createdAt,
              )}
            </span>
          ),
        },
        {
          key: 'type',
          header: 'Type',
          render: (transaction) => (
            <AdminStatusBadge
              value={transaction.type}
            />
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (transaction) => (
            <AdminStatusBadge
              value={transaction.status}
            />
          ),
        },
        {
          key: 'currency',
          header: 'Currency',
          render: (transaction) => (
            <span className="text-xs font-semibold text-slate-300">
              {getCurrencyLabel(
                transaction.currency,
              )}
            </span>
          ),
        },
        {
          key: 'amount',
          header: 'Amount',
          render: (transaction) => (
            <span
              className={
                transaction.amount < 0
                  ? 'font-medium text-red-300'
                  : 'font-medium text-emerald-300'
              }
            >
              {formatMinor(
                transaction.amount,
                transaction.currency,
              )}
            </span>
          ),
        },
        {
          key: 'reference',
          header: 'Reference',
          render: (transaction) => (
            <span className="break-all font-mono text-xs text-slate-500">
              {transaction.reference ?? '—'}
            </span>
          ),
        },
        {
          key: 'failure',
          header: 'Failure reason',
          render: (transaction) => (
            <span className="break-all text-xs text-red-300">
              {transaction.failureReason ?? '—'}
            </span>
          ),
        },
      ]}
      rows={transactions}
      rowKey={(transaction) => transaction.id}
      emptyState={
        loading ? (
          <AdminTableSkeleton rows={3} />
        ) : (
          <AdminEmptyState
            title="No transactions"
            hint="Nothing matches the current filters."
          />
        )
      }
    />
  );
}
