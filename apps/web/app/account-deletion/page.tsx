import type { Metadata } from 'next';
import {
  LegalDocument,
  LegalLink,
  LegalList,
  LegalSection,
  LegalSub,
} from '@/components/layout/legal-document';

export const metadata: Metadata = {
  title: 'Account Deletion | TANVIONROYALE',
  description:
    'How to request deletion of your TANVIONROYALE account and personal data: the request process, what is deleted, what must be retained for legal, financial and audit reasons, and how a completed deletion is confirmed.',
};

const LAST_UPDATED = '4 September 2026';

/**
 * Public Account Deletion instructions (/account-deletion).
 *
 * Server-rendered and static-friendly: no API calls, no authentication and no
 * database access — the page renders even when the backend is unavailable.
 *
 * HONESTY / SAFETY RULES this page is written to:
 *  - There is NO anonymous, unauthenticated self-service delete endpoint. An
 *    account can never be deleted without proving who is asking, so a request
 *    can never be used to delete someone else's account.
 *  - A request is NOT a completed deletion. The page never claims data has been
 *    erased when only a request has been received.
 *  - Records that must be retained (financial, betting, verification, audit)
 *    are named explicitly, mirroring the Privacy Policy, rather than promising
 *    a total wipe that the platform does not and must not perform.
 *  - The only channels referenced are ones that actually exist on the platform
 *    (in-platform Support Live Chat and Report a Problem, both authenticated).
 *    No email address or contact form is invented.
 */
export default function AccountDeletionPage() {
  return (
    <LegalDocument
      title="Account Deletion"
      updated={LAST_UPDATED}
      intro={
        <p>
          This page explains how to ask TANVIONROYALE (&quot;TANVIONROYALE&quot;, &quot;we&quot;, &quot;us&quot;) to delete
          your account and personal data, what happens to your information, and what we are required to keep.
          Please read it together with our <LegalLink href="/privacy">Privacy Policy</LegalLink> and{' '}
          <LegalLink href="/terms">Terms of Service</LegalLink>.
        </p>
      }
    >
      <LegalSection title="How to request account deletion">
        <p>
          To protect your account, deletion can only be requested from inside your own signed-in account —
          there is no anonymous deletion link. Requesting deletion therefore also proves that the person
          asking is the account holder, so a request can never be used to delete someone else&apos;s account.
        </p>
        <p>Sign in and choose one of the two in-platform support channels:</p>
        <LegalList
          items={[
            <>
              <strong>Live Chat:</strong> open <LegalLink href="/support/chat">Support → Live Chat</LegalLink>{' '}
              and tell the support team you want to close and delete your account. Messages are delivered to
              the support team and replies appear in the conversation and your{' '}
              <LegalLink href="/notifications">notifications</LegalLink>.
            </>,
            <>
              <strong>Report a Problem:</strong> submit a request through{' '}
              <LegalLink href="/support/report">Support → Report a Problem</LegalLink>, stating that you are
              requesting account deletion. Each request becomes a tracked case you can follow under{' '}
              <LegalLink href="/support/reports">My problem reports</LegalLink>.
            </>,
          ]}
        />
        <p>
          Both channels are authenticated: they are tied to your signed-in session, and the support team can
          only act on the account that made the request. We may ask you to confirm your identity or complete
          any outstanding verification before we process the request.
        </p>
      </LegalSection>

      <LegalSection title="What happens when you request deletion">
        <LegalSub title="A request is not an immediate deletion">
          <p>
            Submitting a request starts a review. Your account is not erased the moment you send the message,
            and nothing is deleted before the request has been confirmed and processed. We will tell you the
            outcome through the same support channel you used.
          </p>
        </LegalSub>

        <LegalSub title="What is deleted or anonymised">
          <p>
            Once your deletion request is accepted and processed, we delete or irreversibly anonymise your
            personal profile information — for example your name, profile details, email address and phone
            number — and your account can no longer be used to sign in. Linked Google or Facebook sign-in
            identities are removed from your TANVIONROYALE account.
          </p>
        </LegalSub>

        <LegalSub title="What we must keep, and for how long">
          <p>
            Some records must be retained even after your account is closed, because the law, financial
            regulations or legitimate audit and fraud-prevention requirements oblige us to keep them. These are
            kept only for as long as required and are not used to sign you in:
          </p>
          <LegalList
            items={[
              'financial and transaction records (deposits, withdrawals, wallet ledger entries) and related tax or accounting records;',
              'betting and settlement records, where real-money services apply;',
              'identity-verification (KYC) and age-verification records, where required;',
              'tamper-evident security and audit logs of account actions.',
            ]}
          />
          <p>
            This mirrors the retention section of our <LegalLink href="/privacy">Privacy Policy</LegalLink>.
            Retaining these records does not keep your account open — your login and profile are closed.
          </p>
        </LegalSub>

        <LegalSub title="Outstanding balances and pending activity">
          <p>
            If any funds remain in an enabled wallet, or there are bets, deposits or withdrawals still being
            processed, we may need to settle or verify them before the account can be closed. Where this
            applies, the support team will explain what is outstanding and the options available to you.
          </p>
        </LegalSub>
      </LegalSection>

      <LegalSection title="Before you request deletion">
        <LegalList
          items={[
            'You can review and edit your profile information yourself in the platform settings before deciding to delete.',
            'If your concern is a specific problem, you can raise it through Support instead — many issues can be resolved without closing your account.',
            'If you only want to remove an email address or phone number (rather than delete the whole account), the account settings and the verification center let you do that, as long as another sign-in or recovery method remains.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Children and age restriction">
        <p>
          TANVIONROYALE is intended for adults aged 18 or over. If we learn that an account belongs to a person
          under 18, we will suspend or close it and take reasonable steps to delete the related personal
          information, subject to the records we are required to retain.
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <p>
          Questions about account deletion or about how your information is handled can be raised through the{' '}
          <LegalLink href="/support">Support</LegalLink> page. Privacy and data-protection enquiries are
          handled through the same channel, as described in our{' '}
          <LegalLink href="/privacy">Privacy Policy</LegalLink>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
