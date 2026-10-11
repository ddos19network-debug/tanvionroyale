/**
 * `/register` - the historical signup URL.
 *
 * It now renders the EXACT SAME component as `/signup` (see
 * `app/(auth)/signup/page.tsx`). Previously each URL had its own copy of the
 * form, which is how a referral fix could be applied to one and silently
 * missed by the other.
 *
 * BOTH URLs are fully supported and share one implementation, one validation
 * path and one referral-attribution path, so a link issued in either form
 * behaves identically and none of the links already shared stop working.
 *
 * The metadata is declared HERE, in this server component, rather than on the
 * 'use client' signup page - a client component may only export a default.
 */
export const metadata = {
  title: 'Create your account | TANVIONROYALE',
  description: 'Create your TANVIONROYALE account to start playing.',
};

export { default } from '../signup/page';
