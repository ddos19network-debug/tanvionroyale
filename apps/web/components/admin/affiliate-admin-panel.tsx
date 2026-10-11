'use client';

/**
 * ADMIN — Affiliate program panel.
 *
 * Mounted on the EXISTING `/admin/referral` page rather than a second admin
 * page, so referral and affiliate administration live in one place instead of
 * two competing surfaces for the same underlying system.
 *
 * WHAT IT DOES
 *   - program counters, where "Affiliates" counts ACTIVE affiliate profiles
 *     (never every user who happens to own a referral code);
 *   - search over ACTIVE affiliates, their detail, and monthly-target editing;
 *   - activate / deactivate an affiliate (audited server-side);
 *   - content-block create / edit / delete / reorder / enable-disable.
 *
 * MEMBERSHIP != REFERRAL
 *   The list and the detail are driven by `AffiliateProfile`, so a referral user
 *   who never activated does not appear as an affiliate. They remain visible in
 *   the referral admin section of the same page, which is unchanged.
 *
 * FINANCIAL SAFETY (the rule this panel must never break)
 *   It submits ONLY configuration: a month, a target type and a whole target
 *   value, or content text/URLs. It NEVER submits a reward amount, an income
 *   figure, or a paid/approved status — those are computed and stored
 *   server-side. Every value displayed here is returned by the API.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { describeApiError } from '@/lib/api/client';
import { useToast } from '@/components/admin/toast';
import {
  AFFILIATE_PROMOTION_METHODS,
  createAffiliateContentBlock,
  createAffiliateIndividualContent,
  deleteAffiliateContentBlock,
  deleteAffiliateIndividualContent,
  deleteAffiliateTarget,
  formatMinor,
  getAffiliateAdminDetail,
  getAffiliateAdminOverview,
  getAffiliateContentBlocks,
  getAffiliateIndividualContent,
  reorderAffiliateContentBlocks,
  reorderAffiliateIndividualContent,
  searchAffiliateAdmins,
  setAffiliateStatus,
  setAffiliateTarget,
  updateAffiliateContentBlock,
  updateAffiliateIndividualContent,
  type AffiliateAdminDetail,
  type AffiliateAdminOverview,
  type AffiliateAdminRow,
  type AffiliateContentBlock,
  type AffiliateContentInput,
  type AffiliateContentType,
  type AffiliateTargetType,
} from '@/lib/api/affiliate';


const inputClass =
  'w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-brand/60 focus:outline-none';
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-slate-400';

const BLOCK_TYPES: AffiliateContentType[] = [
  'BANNER',
  'TEXT',
  'HOW_IT_WORKS',
  'FAQ',
  'CTA',
  'STATS',
  'IMAGE',
];

const TARGET_TYPES: AffiliateTargetType[] = ['QUALIFIED_REFERRALS', 'SIGNUPS'];

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function methodLabel(value: string | null): string {
  if (!value) return '-';
  return AFFILIATE_PROMOTION_METHODS.find((m) => m.value === value)?.label ?? value;
}

/** One stat tile, matching the admin overview styling. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-ink-800/60 p-2">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-100">{value}</p>
    </div>
  );
}

/**
 * Client-side mirror of the API's `AFFILIATE_SAFE_URL_PATTERN`.
 *
 * The server is the real authority (it re-validates on every write), but the
 * admin preview uses the SAME rule so a rejected URL is visibly flagged before
 * it is saved. A protocol-relative `//host` url is refused too, which the
 * regex would otherwise read as a site-relative path.
 */
const SAFE_URL = /^(\/[^/][\w\-./?=&%]*|https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)$/;

function isSafeImageUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && SAFE_URL.test(trimmed);
}

/**
 * A SMALL, SAFE image preview.
 *
 * It renders in the BROWSER only - the server never fetches an admin-supplied
 * URL, so a preview cannot become an SSRF vector. The `src` is only produced
 * after the same https-only allow-list the API enforces has passed, so no
 * `javascript:`, `data:`, `vbscript:` or protocol-relative source can be
 * rendered here. An unsafe or empty value just shows a hint.
 *
 * `compact` is the LIST variant: a small fixed-size thumbnail with no label, so
 * a content list with twenty illustrated blocks does not render twenty
 * full-size images (and twenty alt-text captions) inline. The editor still
 * gets the full preview, so image support itself is unchanged.
 */
function ImagePreview({ url, compact = false }: { url: string; compact?: boolean }) {
  const safe = isSafeImageUrl(url);
  if (compact) {
    return safe ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url.trim()}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded border border-white/10 bg-ink-900 object-cover"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    ) : (
      <span className="shrink-0 text-[11px] text-amber-300" title="Image URL is not previewable">
        img?
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">Image preview</span>
      {safe ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url.trim()}
          alt="Content image preview"
          className="h-20 w-full max-w-xs rounded-md border border-white/10 bg-ink-900 object-contain"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <p className="text-xs text-amber-300">
          {url.trim()
            ? 'Not previewable: the URL must be https:// or a site-relative path.'
            : 'No image URL set.'}
        </p>
      )}
    </div>
  );
}

/** The form shape shared by the global and the individual content editors. */
type ContentDraft = {
  type: AffiliateContentType;
  title: string;
  subtitle: string;
  body: string;
  items: string;
  imageUrl: string;
  ctaText: string;
  ctaUrl: string;
  sortOrder: string;
  isEnabled: boolean;
};

/**
 * THE one empty draft.
 *
 * Both editors reset to exactly this value, so "create" and "cancel edit" can
 * never disagree and there is no second, competing definition in this file. It
 * is frozen because React state keeps the object BY REFERENCE: an in-place edit
 * would otherwise corrupt the constant for every later reset. Both editors are
 * already immutable (they always spread into a new object), so the freeze makes
 * that a guarantee rather than a convention.
 *
 * `type` is `BLOCK_TYPES[0]` — the first option the select starts on — so the
 * default can never fall outside the closed set. `sortOrder` starts empty and
 * is therefore omitted from the payload, letting the SERVER pick the position
 * instead of the browser inventing one.
 */
const EMPTY_DRAFT: ContentDraft = Object.freeze({
  type: BLOCK_TYPES[0],
  title: '',
  subtitle: '',
  body: '',
  items: '',
  imageUrl: '',
  ctaText: '',
  ctaUrl: '',
  sortOrder: '',
  isEnabled: true,
});

/**
 * Turns the shared editor draft into the API payload.
 *
 * Identical for both scopes and deliberately free of any scope field: which
 * page a block lands on is decided by the ENDPOINT, never by this form.
 */
function toContentInput(draft: ContentDraft): AffiliateContentInput {
  return {
    type: draft.type,
    title: draft.title || undefined,
    subtitle: draft.subtitle || undefined,
    body: draft.body || undefined,
    items: draft.items || undefined,
    imageUrl: draft.imageUrl || undefined,
    ctaText: draft.ctaText || undefined,
    ctaUrl: draft.ctaUrl || undefined,
    // Trimmed so a whitespace-only box means "let the server choose", not 0.
    sortOrder: draft.sortOrder.trim() === '' ? undefined : Number(draft.sortOrder),
    isEnabled: draft.isEnabled,
  };
}

/**
 * The INVERSE of `toContentInput`: loads a stored block into the editor form.
 *
 * Shared by the global and the individual "Edit" actions, which are otherwise
 * identical, so a field added to `ContentDraft` is picked up by both at once
 * instead of one scope silently dropping it. The inverse defaults match
 * `EMPTY_DRAFT`, so cancelling an edit returns the form to exactly the state a
 * fresh "Add" starts in. `items` is stored as an array and edited as one entry
 * per line; `sortOrder` is stored as a number and edited as text.
 */
function fromContentBlock(block: AffiliateContentBlock): ContentDraft {
  return {
    type: block.type,
    title: block.title ?? '',
    subtitle: block.subtitle ?? '',
    body: block.body ?? '',
    items: (block.items ?? []).join('\n'),
    imageUrl: block.imageUrl ?? '',
    ctaText: block.ctaText ?? '',
    ctaUrl: block.ctaUrl ?? '',
    sortOrder: String(block.sortOrder),
    isEnabled: block.isEnabled,
  };
}

/**
 * The content editor FIELDS, shared by both scopes.
 *
 * Deliberately ONE component rather than a global copy and an individual copy:
 * the only difference between the two scopes is which endpoint the save calls,
 * and duplicating ten inputs would guarantee they drift. It is data only - there
 * is no field for HTML, a script or a style block anywhere in this form.
 */
function ContentFields({
  draft,
  onChange,
}: {
  draft: ContentDraft;
  onChange: (next: ContentDraft) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className={labelClass}>
        Section type
        <select
          className={inputClass}
          value={draft.type}
          onChange={(e) => onChange({ ...draft, type: e.target.value as AffiliateContentType })}
        >
          {BLOCK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Title
        <input
          className={inputClass}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Subtitle
        <input
          className={inputClass}
          value={draft.subtitle}
          onChange={(e) => onChange({ ...draft, subtitle: e.target.value })}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Body (plain text)
        <textarea
          className={inputClass}
          rows={3}
          value={draft.body}
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Items (one per line; use Question|Answer for FAQ)
        <textarea
          className={inputClass}
          rows={4}
          value={draft.items}
          onChange={(e) => onChange({ ...draft, items: e.target.value })}
        />
      </label>
      <label className={`${labelClass} sm:col-span-2`}>
        Image URL (https:// or /path)
        <input
          className={inputClass}
          inputMode="url"
          value={draft.imageUrl}
          onChange={(e) => onChange({ ...draft, imageUrl: e.target.value })}
          placeholder="https://cdn.example.com/banner.png"
        />
      </label>
      <div className="sm:col-span-2">
        <ImagePreview url={draft.imageUrl} />
      </div>
      <label className={labelClass}>
        CTA text
        <input
          className={inputClass}
          value={draft.ctaText}
          onChange={(e) => onChange({ ...draft, ctaText: e.target.value })}
        />
      </label>
      <label className={labelClass}>
        CTA link (https:// or /path)
        <input
          className={inputClass}
          value={draft.ctaUrl}
          onChange={(e) => onChange({ ...draft, ctaUrl: e.target.value })}
        />
      </label>
      <label className={labelClass}>
        Position (order)
        <input
          className={inputClass}
          type="number"
          min={0}
          max={10000}
          value={draft.sortOrder}
          onChange={(e) => onChange({ ...draft, sortOrder: e.target.value })}
          placeholder="0"
        />
      </label>
      <label className={`${labelClass} justify-end`}>
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.isEnabled}
            onChange={(e) => onChange({ ...draft, isEnabled: e.target.checked })}
          />
          Enabled
        </span>
      </label>
    </div>
  );
}

/**
 * The content LIST, shared by both scopes.
 *
 * `scopeLabel` is what makes each row's ownership obvious ("GLOBAL" or
 * "@username"), so an admin never has to guess whether a block is shared with
 * every affiliate or belongs only to the selected one.
 */
function ContentList({
  blocks,
  scopeLabel,
  busy,
  emptyLabel,
  onEdit,
  onMove,
  onToggle,
  onDelete,
}: {
  blocks: AffiliateContentBlock[];
  scopeLabel: string;
  busy: boolean;
  emptyLabel: string;
  onEdit: (block: AffiliateContentBlock) => void;
  onMove: (index: number, delta: number) => void;
  onToggle: (block: AffiliateContentBlock) => void;
  onDelete: (block: AffiliateContentBlock) => void;
}) {
  if (blocks.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-800/40 p-2"
        >
          <span className="w-10 text-[11px] text-slate-500">{block.sortOrder}</span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
            Scope: {scopeLabel}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-slate-500">{block.type}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
            {block.title ?? block.key}
          </span>
          {/* A thumbnail, not a full preview: see ImagePreview's `compact` mode. */}
          {block.imageUrl ? <ImagePreview url={block.imageUrl} compact /> : null}
          {!block.isEnabled ? (
            <span className="text-[11px] text-amber-300">hidden</span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={() => onEdit(block)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onMove(index, -1)}
            disabled={busy || index === 0}
          >
            Up
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onMove(index, 1)}
            disabled={busy || index === blocks.length - 1}
          >
            Down
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onToggle(block)}
            disabled={busy}
          >
            {block.isEnabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onDelete(block)}
            disabled={busy}
          >
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function AffiliateAdminPanel() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<AffiliateAdminOverview | null>(null);
  const [blocks, setBlocks] = useState<AffiliateContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Active-affiliate search. The server filters on ACTIVE AffiliateProfile rows,
  // so a plain referral user cannot appear in this list at all.
  const [affiliateQuery, setAffiliateQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<AffiliateAdminRow[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultPage, setResultPage] = useState(1);
  const [selected, setSelected] = useState<string>('');
  const [detail, setDetail] = useState<AffiliateAdminDetail | null>(null);

  // Per-affiliate target editing (configuration only).
  const [targetYear, setTargetYear] = useState(new Date().getFullYear());
  const [targetMonth, setTargetMonth] = useState(new Date().getMonth() + 1);
  const [targetType, setTargetType] = useState<AffiliateTargetType>('QUALIFIED_REFERRALS');
  const [targetValue, setTargetValue] = useState('');
  // The id of the target row being EDITED, or null when adding a new one. Saving
  // an edit updates THAT row (the server upserts on
  // affiliateUserId+year+month+targetType), so an edit can never silently
  // create a duplicate month.
  const [targetEditingId, setTargetEditingId] = useState<string | null>(null);

  // The GLOBAL content editor. `editingId === null` means "create a new section";
  // otherwise the SAME form edits that block, and saving calls update.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContentDraft>(EMPTY_DRAFT);

  // The INDIVIDUAL content editor, scoped to the SELECTED affiliate.
  //
  // It is a SEPARATE set of state from the global editor on purpose: switching
  // from Affiliate A to Affiliate B must never leave A's blocks, A's half-typed
  // form or A's "editing" id on screen. `useEffect` on `selected` below clears
  // all of it, so the panel cannot ever show one affiliate's content under
  // another affiliate's name.
  const [indBlocks, setIndBlocks] = useState<AffiliateContentBlock[]>([]);
  const [indEditingId, setIndEditingId] = useState<string | null>(null);
  const [indDraft, setIndDraft] = useState<ContentDraft>(EMPTY_DRAFT);

  /** Re-reads the selected affiliate's own blocks. Never reads another scope. */
  const loadIndividual = useCallback(async (userId: string) => {
    const res = await getAffiliateIndividualContent(userId);
    setIndBlocks(res.blocks);
  }, []);

  // Clear every affiliate-scoped slice of state the moment the selection moves.
  useEffect(() => {
    setIndBlocks([]);
    setIndEditingId(null);
    setIndDraft(EMPTY_DRAFT);
    setTargetValue('');
    setTargetEditingId(null);
  }, [selected]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, b] = await Promise.all([getAffiliateAdminOverview(), getAffiliateContentBlocks()]);
      setOverview(o);
      setBlocks(b.items);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number) => formatMinor(amount, overview?.currency ?? 'BDT');

  const onSearch = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await searchAffiliateAdmins(searchTerm.trim(), resultPage, 20);
      setResults(res.items);
      setResultTotal(res.total);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, [searchTerm, resultPage]);

  const openAffiliate = useCallback(async (userId: string) => {
    setSelected(userId);
    setError(null);
    setDetail(null);
    // The state-clearing effect keyed on `selected` wipes the previous
    // affiliate's individual blocks and editor, so nothing from Affiliate A can
    // still be on screen while Affiliate B is loading.
    setIndBlocks([]);
    setIndEditingId(null);
    setIndDraft(EMPTY_DRAFT);
    setTargetEditingId(null);
    setTargetValue('');
    try {
      const [d, ind] = await Promise.all([
        getAffiliateAdminDetail(userId),
        // Scoped read for the SELECTED affiliate only. A failure here must not
        // blank the detail view, so it is caught separately.
        getAffiliateIndividualContent(userId).then((r) => r.blocks).catch(() => [] as AffiliateContentBlock[]),
      ]);
      setDetail(d);
      setIndBlocks(ind);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, []);

  /**
   * Deactivate / reactivate.
   *
   * Submits only a boolean intent. The server changes the membership flag and
   * writes an audit row; it never touches a referral, a reward, a wallet or a
   * ledger entry, and the click history is preserved.
   */
  const onToggleStatus = useCallback(
    async (userId: string, isActive: boolean) => {
      setError(null);
      setBusy(true);
      try {
        await setAffiliateStatus(userId, isActive);
        toast(isActive ? 'Affiliate reactivated (audited)' : 'Affiliate deactivated (audited)');
        await openAffiliate(userId);
        await load();
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [toast, openAffiliate, load],
  );

  /**
   * Adds a NEW target, or UPDATES the one being edited.
   *
   * Both go through the same `PUT /:userId/target`, which upserts on
   * (affiliateUserId, year, month, targetType). That is what guarantees an edit
   * updates the SAME row instead of adding a second row for the same month.
   */
  const onSaveTarget = useCallback(async () => {
    if (!selected) return;
    const value = Number.parseInt(targetValue, 10);
    if (!Number.isInteger(value) || value < 0) {
      setError('Target value must be a whole number of 0 or more');
      return;
    }
    setBusy(true);
    try {
      await setAffiliateTarget(selected, {
        year: targetYear,
        month: targetMonth,
        targetType,
        targetValue: value,
      });
      toast(targetEditingId ? 'Monthly target updated (audited)' : 'Monthly target saved (audited)');
      setTargetValue('');
      setTargetEditingId(null);
      setDetail(await getAffiliateAdminDetail(selected));
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, [selected, targetYear, targetMonth, targetType, targetValue, targetEditingId, toast, load]);

  /** Loads an existing target row into the SAME form, for editing. */
  const startEditTarget = useCallback((row: AffiliateAdminDetail['targets'][number]) => {
    setTargetEditingId(row.id);
    setTargetYear(row.year);
    setTargetMonth(row.month);
    setTargetType(row.targetType);
    setTargetValue(String(row.targetValue));
  }, []);

  const cancelEditTarget = useCallback(() => {
    setTargetEditingId(null);
    setTargetValue('');
  }, []);

  /**
   * Removes ONE target of the SELECTED affiliate, after an explicit
   * confirmation. A target is configuration, so only the one
   * `AffiliateMonthlyTarget` row goes: referrals, rewards, clicks, the wallet,
   * the ledger and every other affiliate's targets are untouched, and the
   * deletion is audited server-side.
   */
  const onDeleteTarget = useCallback(
    async (row: AffiliateAdminDetail['targets'][number]) => {
      if (!selected) return;
      const ok = window.confirm(
        `Delete the ${row.year}-${String(row.month).padStart(2, '0')} ${row.targetType} target of ` +
          `${row.targetValue}?\n\nThis removes the target setting only. Referral, reward, wallet ` +
          `and ledger records are not affected, and the deletion is recorded in the audit log.`,
      );
      if (!ok) return;
      setBusy(true);
      try {
        await deleteAffiliateTarget(selected, row.id);
        toast('Monthly target removed (audited)');
        if (targetEditingId === row.id) cancelEditTarget();
        setDetail(await getAffiliateAdminDetail(selected));
        await load();
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [selected, targetEditingId, cancelEditTarget, toast, load],
  );

  /** Loads a block into the SAME form used for creating one. */
  const startEdit = useCallback((block: AffiliateContentBlock) => {
    setEditingId(block.id);
    setDraft(fromContentBlock(block));
  }, []);

  const resetEditor = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }, []);

  /**
   * One save path for create AND edit.
   *
   * When `editingId` is set this calls `updateAffiliateContentBlock`, so
   * editing can never silently create a duplicate block. Only data fields are
   * sent: never HTML, never a script, and the image/CTA URLs are re-validated
   * server-side against the https-only allow-list.
   *
   * The payload is built by the SHARED `toContentInput`, the same one the
   * individual editor uses, so the two scopes cannot drift apart in what they
   * submit. The scope itself is not part of that payload: the global route
   * stores `affiliateUserId = null` and the individual route stores the selected
   * affiliate, entirely server-side from the URL.
   */
  const onSaveBlock = useCallback(async () => {
    setError(null);
    setBusy(true);
    const payload = toContentInput(draft);
    try {
      if (editingId) {
        await updateAffiliateContentBlock(editingId, payload);
        toast('Section updated');
      } else {
        await createAffiliateContentBlock(payload);
        toast('Section added');
      }
      resetEditor();
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, [draft, editingId, toast, load, resetEditor]);

  const onToggleBlock = useCallback(
    async (block: AffiliateContentBlock) => {
      setBusy(true);
      try {
        await updateAffiliateContentBlock(block.id, {
          type: block.type,
          isEnabled: !block.isEnabled,
        });
        await load();
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onDeleteBlock = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await deleteAffiliateContentBlock(id);
        toast('Section removed');
        if (editingId === id) resetEditor();
        await load();
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [load, toast, editingId, resetEditor],
  );

  const move = useCallback(
    async (index: number, delta: number) => {
      const next = [...blocks];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      setBusy(true);
      try {
        // An explicit ordered list is the reorder contract: deterministic and
        // testable, with no drag-and-drop dependency. The server rewrites
        // sortOrder and returns the list already sorted.
        const res = await reorderAffiliateContentBlocks(next.map((b) => b.id));
        setBlocks(res.items);
      } catch (err) {
        setError(describeApiError(err));
        await load();
      } finally {
        setBusy(false);
      }
    },
    [blocks, load],
  );

  // ---------------------------------------------------------------------------
  // INDIVIDUAL content handlers.
  //
  // Every one of them is keyed on `selected`, is a no-op when nothing is
  // selected, and calls the per-affiliate endpoint - so the panel physically
  // cannot act on the global scope or on a different affiliate's content. The
  // server re-verifies the same two facts; this is a UX guard, not the
  // authorization (that lives in the service's ownership checks).
  // ---------------------------------------------------------------------------

  const startEditIndividual = useCallback((block: AffiliateContentBlock) => {
    setIndEditingId(block.id);
    setIndDraft(fromContentBlock(block));
  }, []);

  const resetIndividualEditor = useCallback(() => {
    setIndEditingId(null);
    setIndDraft(EMPTY_DRAFT);
  }, []);

  const onSaveIndividualBlock = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    const payload = toContentInput(indDraft);
    try {
      if (indEditingId) {
        await updateAffiliateIndividualContent(selected, indEditingId, payload);
        toast('Individual section updated');
      } else {
        await createAffiliateIndividualContent(selected, payload);
        toast('Individual section added');
      }
      resetIndividualEditor();
      await loadIndividual(selected);
      setDetail(await getAffiliateAdminDetail(selected));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, [selected, indDraft, indEditingId, toast, loadIndividual, resetIndividualEditor]);

  const onToggleIndividualBlock = useCallback(
    async (block: AffiliateContentBlock) => {
      if (!selected) return;
      setBusy(true);
      try {
        await updateAffiliateIndividualContent(selected, block.id, {
          type: block.type,
          isEnabled: !block.isEnabled,
        });
        await loadIndividual(selected);
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [selected, loadIndividual],
  );

  const onDeleteIndividualBlock = useCallback(
    async (block: AffiliateContentBlock) => {
      if (!selected) return;
      setBusy(true);
      try {
        await deleteAffiliateIndividualContent(selected, block.id);
        toast('Individual section removed');
        if (indEditingId === block.id) resetIndividualEditor();
        await loadIndividual(selected);
        setDetail(await getAffiliateAdminDetail(selected));
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [selected, indEditingId, resetIndividualEditor, toast, loadIndividual],
  );

  /**
   * Up/Down within the SELECTED affiliate's own sequence.
   *
   * The reorder endpoint is scoped to `selected`, so the global order and every
   * other affiliate's order are untouched by this call.
   */
  const moveIndividual = useCallback(
    async (index: number, delta: number) => {
      if (!selected) return;
      const next = [...indBlocks];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      setBusy(true);
      try {
        const res = await reorderAffiliateIndividualContent(selected, next.map((b) => b.id));
        setIndBlocks(res.items);
      } catch (err) {
        setError(describeApiError(err));
        await loadIndividual(selected);
      } finally {
        setBusy(false);
      }
    },
    [selected, indBlocks, loadIndividual],
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {/* ---------------- 1. Program overview ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Affiliate program</CardTitle>
        </CardHeader>
        <CardContent>
          {overview ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Program" value={overview.programEnabled ? 'Enabled' : 'Off'} />
              <Tile label="Active affiliates" value={String(overview.totalAffiliates)} />
              <Tile label="Inactive affiliates" value={String(overview.inactiveAffiliates)} />
              <Tile label="Referred users" value={String(overview.totalReferredUsers)} />
              <Tile label="Clicks" value={String(overview.totalClicks)} />
              <Tile
                label="Conversion"
                value={overview.conversionRate === null ? '-' : `${overview.conversionRate}%`}
              />
              <Tile label="Targets this month" value={String(overview.targetsSetThisMonth)} />
              <Tile label="Pending rewards" value={money(overview.pendingRewardAmount)} />
              <Tile label="Paid rewards" value={money(overview.paidRewardAmount)} />
              <Tile label="Rejected rewards" value={money(overview.rejectedRewardAmount)} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Loading...</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Active affiliates are users with an ACTIVE affiliate profile. A user who only has a
            referral code is a referral user, not an affiliate, and is listed in the referral
            section above instead.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- 2. Active affiliates + search ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Active affiliates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className={`${labelClass} flex-1`}>
              Search by username, user id or referral code
              <input
                className={inputClass}
                value={affiliateQuery}
                onChange={(e) => setAffiliateQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearchTerm(affiliateQuery);
                    setResultPage(1);
                    void onSearch();
                  }
                }}
                placeholder="username, id or code"
              />
            </label>
            <Button
              type="button"
              onClick={() => {
                setSearchTerm(affiliateQuery);
                setResultPage(1);
                void onSearch();
              }}
              disabled={!affiliateQuery.trim() || busy}
            >
              Search
            </Button>
          </div>

          {searchTerm ? (
            results.length === 0 ? (
              <p className="text-sm text-slate-500">
                No ACTIVE affiliate matches. Referral users without an affiliate profile are not
                listed here.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Username</th>
                        <th className="py-2 pr-3 font-semibold">Referral code</th>
                        <th className="py-2 pr-3 font-semibold">Channel</th>
                        <th className="py-2 pr-3 font-semibold">Activated</th>
                        <th className="py-2 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row) => (
                        <tr
                          key={row.userId}
                          className="border-b border-white/5 last:border-0"
                        >
                          <td className="py-2 pr-3 text-slate-200">{row.username}</td>
                          <td className="py-2 pr-3 text-xs text-slate-400">
                            {row.referralCode ?? '-'}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-400">
                            {methodLabel(row.promotionMethod)}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-400">
                            {new Date(row.activatedAt).toLocaleDateString()}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openAffiliate(row.userId)}
                              >
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void onToggleStatus(row.userId, false)}
                              >
                                Deactivate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-slate-500">
                    Page {resultPage} of {Math.max(1, Math.ceil(resultTotal / 20))} ({resultTotal})
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || resultPage <= 1}
                    onClick={() => {
                      const next = resultPage - 1;
                      setResultPage(next);
                      void searchAffiliateAdmins(searchTerm.trim(), next, 20).then((res) => {
                        setResults(res.items);
                        setResultTotal(res.total);
                      });
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || resultPage * 20 >= resultTotal}
                    onClick={() => {
                      const next = resultPage + 1;
                      setResultPage(next);
                      void searchAffiliateAdmins(searchTerm.trim(), next, 20).then((res) => {
                        setResults(res.items);
                        setResultTotal(res.total);
                      });
                    }}
                  >
                    Next
                  </Button>
                </div>
              </>
            )
          ) : (
            <p className="text-sm text-slate-500">Search to list active affiliates.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- 3. Affiliate detail ---------------- */}
      {detail ? (
        <Card>
          <CardHeader>
            <CardTitle>Affiliate detail</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">{detail.user.username}</span>
              <span className="text-xs text-slate-500">{detail.user.id}</span>
              <span className="rounded bg-ink-700 px-2 py-0.5 text-xs text-slate-300">
                {detail.profile?.status ?? 'NOT AN AFFILIATE'}
              </span>
            </div>

            {detail.isAffiliate && detail.profile ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Referral code" value={detail.user.referralCode ?? '-'} />
                <Tile label="Activated" value={new Date(detail.profile.activatedAt).toLocaleDateString()} />
                <Tile label="Channel" value={methodLabel(detail.profile.promotionMethod)} />
                <Tile
                  label="Deactivated"
                  value={
                    detail.profile.deactivatedAt
                      ? new Date(detail.profile.deactivatedAt).toLocaleDateString()
                      : '-'
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-amber-300">
                This account has a referral code but no affiliate profile. It is a referral user,
                not an affiliate, and appears in the referral admin list instead.
              </p>
            )}

            {detail.isAffiliate ? (
              <>
                {detail.profile?.promotionUrl ? (
                  <p className="break-all text-xs text-slate-400">
                    Channel URL: {detail.profile.promotionUrl}
                  </p>
                ) : null}
                {detail.profile?.description ? (
                  <p className="text-xs text-slate-400">{detail.profile.description}</p>
                ) : null}

                {detail.stats ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Tile label="Total referred" value={String(detail.stats.totalReferredUsers)} />
                    <Tile label="Qualified" value={String(detail.stats.qualifiedReferrals)} />
                    <Tile label="Pending" value={String(detail.stats.pendingReferredUsers)} />
                    <Tile label="Clicks" value={String(detail.stats.totalClicks)} />
                    <Tile
                      label="Conversion"
                      value={
                        detail.stats.conversionRate === null
                          ? '-'
                          : `${detail.stats.conversionRate}%`
                      }
                    />
                    <Tile label="Total income" value={money(detail.stats.totalIncome)} />
                    <Tile label="Pending income" value={money(detail.stats.pendingIncome)} />
                    <Tile label="Paid income" value={money(detail.stats.paidIncome)} />
                    <Tile label="Rejected income" value={money(detail.stats.rejectedIncome)} />
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onToggleStatus(detail.user.id, detail.profile?.status !== 'ACTIVE')}
                  >
                    {detail.profile?.status === 'ACTIVE'
                      ? 'Deactivate affiliate'
                      : 'Reactivate affiliate'}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Deactivating hides the affiliate link, stops new click attribution and removes
                  the user from the active list. Referral relationships, rewards, wallet balances
                  and click history are left untouched.
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className={labelClass}>
                    Year
                    <input
                      className={inputClass}
                      type="number"
                      value={targetYear}
                      onChange={(e) => setTargetYear(Number(e.target.value))}
                    />
                  </label>
                  <label className={labelClass}>
                    Month
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={12}
                      value={targetMonth}
                      onChange={(e) => setTargetMonth(Number(e.target.value))}
                    />
                  </label>
                  <label className={labelClass}>
                    Type
                    <select
                      className={inputClass}
                      value={targetType}
                      onChange={(e) => setTargetType(e.target.value as AffiliateTargetType)}
                    >
                      {TARGET_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Value
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      value={targetValue}
                      onChange={(e) => setTargetValue(e.target.value)}
                      placeholder="100"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={onSaveTarget} disabled={busy}>
                    {targetEditingId ? 'Save target changes' : 'Save target'}
                  </Button>
                  {targetEditingId ? (
                    <Button type="button" variant="outline" onClick={cancelEditTarget}>
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
                {targetEditingId ? (
                  <p className="text-xs text-slate-400">
                    Editing the target already set for{' '}
                    {monthLabel(targetYear, targetMonth)} / {targetType}. Saving updates that same
                    row - it does not add a second target for the same month.
                  </p>
                ) : null}

                <p className="text-xs text-slate-500">
                  Current target:{' '}
                  {detail.target === null || detail.target.targetValue === null
                    ? 'No monthly target set'
                    : `${detail.target.actual} / ${detail.target.targetValue}`}
                </p>

                {/* Target history. A target is configuration, so deleting one removes
                    only the setting; the historical referral and reward records it was
                    compared against are never deleted with it. */}
                {detail.targets.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/5 uppercase tracking-wider text-slate-500">
                          <th className="py-1 pr-3">Month</th>
                          <th className="py-1 pr-3">Type</th>
                          <th className="py-1 pr-3">Target</th>
                          <th className="py-1 pr-3">Actual</th>
                          <th className="py-1 pr-3">Status</th>
                          <th className="py-1">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.targets.map((t) => {
                          const isCurrent =
                            detail.target !== null && detail.target.targetValue !== null;
                          const actual = isCurrent
                            ? detail.target!.actual
                            : detail.stats?.qualifiedReferrals ?? 0;
                          const reached = actual >= t.targetValue;
                          return (
                            <tr key={t.id} className="border-b border-white/5 last:border-0">
                              <td className="py-1 pr-3 text-slate-300">
                                {monthLabel(t.year, t.month)}
                              </td>
                              <td className="py-1 pr-3 text-slate-400">{t.targetType}</td>
                              <td className="py-1 pr-3 text-slate-200">{t.targetValue}</td>
                              <td className="py-1 pr-3 text-slate-300">{actual}</td>
                              <td className="py-1 pr-3">
                                <span className={reached ? 'text-emerald-300' : 'text-slate-400'}>
                                  {reached ? 'Reached' : 'In progress'}
                                </span>
                              </td>
                              <td className="py-1">
                                <div className="flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    disabled={busy}
                                    onClick={() => startEditTarget(t)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    disabled={busy}
                                    onClick={() => void onDeleteTarget(t)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No monthly target set</p>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- 4. Individual page content (selected affiliate) ---------------- */}
      {detail && detail.isAffiliate ? (
        <Card>
          <CardHeader>
            <CardTitle>{`Individual Content - @${detail.user.username}`}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Custom content for <span className="font-semibold">{detail.user.username}</span> (user
              id <span className="font-mono">{detail.user.id}</span>,{' '}
              {detail.profile?.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'}). These sections appear
              ONLY on this affiliate&apos;s /affiliate page, after the global content and before the
              personal dashboard. They are never shown to any other affiliate.
            </p>
            {detail.profile?.status !== 'ACTIVE' ? (
              <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This affiliate is INACTIVE, so new or edited individual content is refused. The
                content stored below is kept and returns unchanged when the affiliate is
                reactivated.
              </p>
            ) : null}

            <ContentFields draft={indDraft} onChange={setIndDraft} />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={onSaveIndividualBlock}
                disabled={busy || detail.profile?.status !== 'ACTIVE'}
              >
                {indEditingId ? 'Save changes' : '+ Add Individual Section'}
              </Button>
              {indEditingId ? (
                <Button type="button" variant="outline" onClick={resetIndividualEditor}>
                  Cancel edit
                </Button>
              ) : null}
            </div>

            <ContentList
              blocks={indBlocks}
              scopeLabel={`@${detail.user.username}`}
              busy={busy}
              emptyLabel="No individual sections for this affiliate yet."
              onEdit={startEditIndividual}
              onMove={(index, delta) => void moveIndividual(index, delta)}
              onToggle={(block) => void onToggleIndividualBlock(block)}
              onDelete={(block) => void onDeleteIndividualBlock(block)}
            />
            <p className="text-xs text-slate-500">
              This list is ordered by the position saved on the server for THIS affiliate only.
              Up/Down rewrites it immediately; reordering here never changes the global order or
              another affiliate&apos;s order.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- 5. Global affiliate page content ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Global Affiliate Content</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            Content only. These sections appear ABOVE the personal dashboard on /affiliate for
            EVERY active affiliate, and never replace it. They are shown before any
            individual content. URLs must be https:// or a site-relative path; no HTML, no script.
          </p>
          <ContentFields draft={draft} onChange={setDraft} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onSaveBlock} disabled={busy}>
              {editingId ? 'Save changes' : 'Add section'}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetEditor}>
                Cancel edit
              </Button>
            ) : null}
          </div>
          <ContentList
            blocks={blocks}
            scopeLabel="GLOBAL"
            busy={busy}
            emptyLabel="No global content sections yet."
            onEdit={startEdit}
            onMove={(index, delta) => void move(index, delta)}
            onToggle={(block) => void onToggleBlock(block)}
            onDelete={(block) => void onDeleteBlock(block.id)}
          />
          <p className="text-xs text-slate-500">
            The list is ordered by the position saved on the server. Up/Down rewrites it
            immediately; the exact number can also be typed in the editor.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
