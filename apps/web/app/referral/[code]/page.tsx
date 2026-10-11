import { redirect } from 'next/navigation';
import { normalizeReferralCodeInput } from '@/lib/referral-capture';

/**
 * `/referral/CODE` — the alternate (path-style) referral link format.
 *
 * It resolves to the SAME signup attribution flow as `/signup?ref=CODE`, so
 * both link formats ever issued keep working and neither is a dead end.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *   - It performs NO attribution. Nothing is recorded here at all: the code is
 *     only carried to the signup page in the query string, and the SERVER
 *     decides at account-creation time whether it is valid and who owns it.
 *   - An invalid/unknown code still lands on the signup page. Signup must never
 *     be blocked by a bad link; the page shows a non-sensitive notice and the
 *     code is simply never sent.
 *   - The code is shape-checked here only to decide whether it is worth
 *     forwarding. The authoritative validation is always server-side.
 */
export default function ReferralRedirectPage({
  params,
}: {
  params: { code: string };
}) {
  const code = normalizeReferralCodeInput(params?.code);
  if (code) {
    redirect(`/signup?ref=${encodeURIComponent(code)}`);
  }
  // A malformed code still opens signup, with no attribution attached.
  redirect('/signup');
}
