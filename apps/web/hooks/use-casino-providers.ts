'use client';

/**
 * The ONE public provider (studio) list.
 *
 * DATA SOURCE (unchanged, already public): `GET /casino/catalog/providers?
 * product=<casino|live>` through `getCasinoProviders` in `lib/api/casino.ts`.
 * The backend answers with one entry per ACTIVE provider row that actually
 * holds ACTIVE games for that product, e.g.
 *   `[{ id, name, gameCount, productType }, …]`
 * so adding a provider in Admin + syncing its games makes it appear here with
 * no frontend change, and deactivating a provider removes it.
 *
 * ONE FETCH PER PRODUCT: the left menu, the Home selector and the Games
 * selector are usually mounted at the same time. A tiny module-level store
 * (per product) plus in-flight de-duplication means those surfaces share one
 * request instead of racing three identical ones, and every one of them
 * re-renders from the same result.
 *
 * NOTHING IS FABRICATED: a failed request yields `error` (the UI shows a retry
 * state) and an empty list — never a placeholder studio.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogProviderSummary } from '@tanvion-royale/types';
import type { CasinoProductParam } from '@/lib/api/casino';
import { getCasinoProviders } from '@/lib/api/casino';
import { describeApiError } from '@/lib/api/client';

export interface UseCasinoProvidersResult {
  /** Real active providers for this product, exactly as the API returned them. */
  providers: CatalogProviderSummary[];
  /** True while the list has never been read (or is being re-read). */
  loading: boolean;
  /** Human-readable failure, or null. Never a substitute for the list. */
  error: string | null;
  /** True once the public list has been read at least once for this product. */
  loaded: boolean;
  /** Re-read the public list (used by the error state). */
  reload: () => void;
}

interface StoreEntry {
  loaded: boolean;
  loading: boolean;
  providers: CatalogProviderSummary[];
  error: string | null;
}

const IDLE: StoreEntry = { loaded: false, loading: false, providers: [], error: null };

const store = new Map<string, StoreEntry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();

function readEntry(product: string): StoreEntry {
  return store.get(product) ?? IDLE;
}

function writeEntry(product: string, patch: Partial<StoreEntry>): void {
  store.set(product, { ...readEntry(product), ...patch });
  for (const listener of listeners.get(product) ?? []) listener();
}

function load(product: string, force: boolean): void {
  if (inflight.has(product)) return;
  if (readEntry(product).loaded && !force) return;
  writeEntry(product, { loading: true, error: null });
  const request = getCasinoProviders(product as CasinoProductParam)
    .then((rows) => {
      writeEntry(product, {
        loaded: true,
        loading: false,
        providers: Array.isArray(rows) ? rows : [],
        error: null,
      });
    })
    .catch((err: unknown) => {
      writeEntry(product, {
        loaded: true,
        loading: false,
        providers: [],
        error: describeApiError(err),
      });
    })
    .finally(() => {
      inflight.delete(product);
    });
  inflight.set(product, request);
}

/**
 * Public studio list for one product.
 *
 * Casino and live are separate stores, so the two catalogs can never mix.
 */
export function useCasinoProviders(product: CasinoProductParam): UseCasinoProvidersResult {
  const [entry, setEntry] = useState<StoreEntry>(() => readEntry(product));

  useEffect(() => {
    setEntry(readEntry(product));
    let bucket = listeners.get(product);
    if (!bucket) {
      bucket = new Set();
      listeners.set(product, bucket);
    }
    const listener = () => setEntry(readEntry(product));
    bucket.add(listener);
    load(product, false);
    return () => {
      bucket.delete(listener);
    };
  }, [product]);

  const reload = useCallback(() => load(product, true), [product]);

  return useMemo(
    () => ({
      providers: entry.providers,
      loading: !entry.loaded || entry.loading,
      error: entry.error,
      loaded: entry.loaded,
      reload,
    }),
    [entry, reload],
  );
}

/**
 * Test-only: drops the shared per-product cache so a test can observe a fresh
 * read of the public endpoint (used to prove a newly synced provider appears
 * without any frontend change).
 */
export function resetCasinoProvidersCache(): void {
  store.clear();
  listeners.clear();
  inflight.clear();
}
