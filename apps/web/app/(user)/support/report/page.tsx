'use client';

/**
 * Report a Problem (/support/report).
 *
 * Submitting the form ALWAYS creates a NEW support case (POST /support/reports)
 * and then sends the user straight to that case's thread
 * (/support/reports/:id) — a report is never merged into the Live Chat
 * conversation.
 *
 * The identity is the JWT: the backend scopes the report to the authenticated
 * user, so this form has NO editable userId/username field. The username +
 * user id are shown READ-ONLY (a useful reference when talking to support)
 * but are never sent anywhere — the backend takes them from the session.
 *
 * The screenshot input copies the established wallet pattern
 * (app/(user)/wallet/deposit/page.tsx): FileReader → base64 data URL, with
 * client-side JPG/JPEG/PNG/WebP + 5MB checks before anything is uploaded.
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMe } from '@/lib/api/users';
import {
  MAX_REPORT_DESCRIPTION_LENGTH,
  MAX_REPORT_SCREENSHOT_BYTES,
  PROBLEM_REPORT_CATEGORIES,
  REPORT_SCREENSHOT_ACCEPT,
  submitProblemReport,
} from '@/lib/api/support';
import { ApiClientError, describeApiError } from '@/lib/api/client';
import { useAuth } from '@/src/lib/auth';
import type { PublicUser } from '@tanvion-royale/types';

const MIN_DESCRIPTION_LENGTH = 10;
const ALLOWED_SCREENSHOT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export default function ReportProblemPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const [attachmentDataUrl, setAttachmentDataUrl] = useState('');
  const [attachmentFileName, setAttachmentFileName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    let active = true;
    void (async () => {
      try {
        const me = await getMe();
        if (!active) return;
        setUser(me);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          router.replace('/login');
          return;
        }
        setError(
          'Could not load your account details. You can still submit the report below.',
        );
      } finally {
        if (active) setLoadingUser(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, isAuthenticated, router]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setAttachmentDataUrl('');
    setAttachmentFileName('');

    if (!file) {
      return;
    }

    if (
      !(ALLOWED_SCREENSHOT_TYPES as readonly string[]).includes(file.type)
    ) {
      setError('Please select a JPG, JPEG, PNG or WebP screenshot.');
      event.target.value = '';
      return;
    }

    /*
     * Spec: max 5MB. The backend enforces the same rule on the decoded
     * payload, so this client check is an early, friendly guard only.
     */
    if (file.size > MAX_REPORT_SCREENSHOT_BYTES) {
      setError('Screenshot is too large. Please use an image under 5MB.');
      event.target.value = '';
      return;
    }

    try {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;

        if (typeof result !== 'string') {
          setError('Unable to read the screenshot.');
          return;
        }

        setAttachmentDataUrl(result);
        setAttachmentFileName(file.name);
        setError('');
      };

      reader.onerror = () => {
        setError('Unable to read the screenshot.');
      };

      reader.readAsDataURL(file);
    } catch {
      setError('Unable to process the screenshot.');
    }
  }

  function removeAttachment() {
    setAttachmentDataUrl('');
    setAttachmentFileName('');
  }

  function validateForm(): string | null {
    if (!category) {
      return 'Please select a problem category.';
    }
    if (description.trim().length < MIN_DESCRIPTION_LENGTH) {
      return `Please describe the problem in at least ${MIN_DESCRIPTION_LENGTH} characters.`;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await submitProblemReport({
        category,
        body: description.trim(),
        attachmentDataUrl: attachmentDataUrl || undefined,
      });
      setSuccess(
        'Report submitted. Our support team will review it — replies appear on the report page and in your notifications.',
      );
      // Straight to the new case — exactly what was submitted, nothing merged.
      router.push(`/support/reports/${result.ticket.id}`);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || (!isAuthenticated && loadingUser)) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div
            className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center text-sm text-slate-500"
            role="status"
          >
            Loading…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Support
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
            Report a Problem
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Describe the problem and, if it helps, attach a screenshot. Your report
            becomes its own case — a support agent replies in it and you can follow
            every update on the report page. You can check your earlier reports in{' '}
            <Link href="/support/reports" className="font-semibold text-brand">
              My problem reports
            </Link>
            .
          </p>
        </div>

        {error ? (
          <div
            className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-300"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/50 p-4 text-sm text-emerald-300"
            role="status"
          >
            {success}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6"
        >
          {/* Problem category (spec list, required) */}
          <div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-slate-300">
                Problem Category <span className="text-red-400">*</span>
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                aria-label="Problem category"
                className="rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="">Select a category…</option>
                {PROBLEM_REPORT_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* User information — read-only, attached server-side from the JWT. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-slate-300">Username</span>
              <p className="break-all rounded-xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-400">
                {loadingUser ? 'Loading…' : (user?.username ?? 'Not available')}
              </p>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-slate-300">User ID</span>
              <p className="break-all rounded-xl border border-white/10 bg-ink-900 px-3 py-2 font-mono text-xs text-slate-400">
                {loadingUser ? 'Loading…' : (user?.id ?? 'Not available')}
              </p>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Attached automatically from your signed-in account — not editable.
          </p>

          {/* Problem description */}
          <div className="mt-5">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-slate-300">
                What went wrong?
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
                required
                placeholder="Tell us what happened, what you expected and where it happened (game, page, transaction)…"
                className="resize-y rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-500">
              {description.trim().length}/{MAX_REPORT_DESCRIPTION_LENGTH} characters
              (minimum {MIN_DESCRIPTION_LENGTH})
            </p>
          </div>

          {/* Screenshot — same client-side rule as the wallet deposit proof. */}
          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-300">
              Screenshot <span className="text-slate-500">(optional)</span>
            </p>

            <label
              htmlFor="report-screenshot"
              className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900 px-4 py-7 text-center transition hover:border-brand/60 hover:bg-white/10"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-800 text-lg">
                ↑
              </span>

              <span className="mt-3 text-sm font-semibold text-slate-200">
                {attachmentFileName
                  ? attachmentFileName
                  : 'Upload problem screenshot'}
              </span>

              <span className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                JPG, JPEG, PNG or WebP. Maximum 5MB.
              </span>

              <input
                id="report-screenshot"
                type="file"
                accept={REPORT_SCREENSHOT_ACCEPT}
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {attachmentDataUrl ? (
              <div className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachmentDataUrl}
                  alt="Selected problem screenshot"
                  className="max-h-64 rounded-md border border-white/10"
                />
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs font-medium text-emerald-300">
                    Screenshot attached.
                  </span>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Submit */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Report'}
            </button>
            <Link
              href="/support/reports"
              className="rounded-xl border border-ink-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              My problem reports
            </Link>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Submitting creates a new, separate support case. Replies from the team
            appear on the report page and in your notifications.
          </p>
        </form>
      </div>
    </main>
  );
}
