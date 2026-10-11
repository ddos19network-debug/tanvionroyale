import type { Metadata } from 'next';
import {
  LegalArticle,
  LegalLink,
  LegalList,
  LegalSection,
} from '@/components/layout/legal-document';
import { AppFooter } from '@/components/layout/app-footer';

export const metadata: Metadata = {
  title: 'Support — TANVIONROYALE',
  description:
    'Help and support for the TANVIONROYALE platform: accounts and sign-in, verification, games, sports and events, wallet and transactions, privacy enquiries and responsible gaming.',
};

/**
 * Public Help & Support (/support).
 *
 * Server-rendered and static-friendly: no API calls, no authentication and no
 * database access — the page renders even when the backend is unavailable.
 * It fills the /support route that the site footer and the legal pages
 * already link to, and only points to support resources that actually exist
 * on the platform (no invented contact channels).
 *
 * /support is a user-panel route, so it lives inside the `(user)` route group:
 * the top navigation comes from app/(user)/layout.tsx (never from this page),
 * which is why it renders <LegalArticle> (chrome-free document body) instead of
 * the full <LegalDocument> shell used by the standalone /privacy and /terms.
 */
export default function SupportPage() {
  return (
    <>
      <LegalArticle
        eyebrow="Support"
        title="Help & Support"
        updated="4 September 2026"
        intro={
          <p>
            This page explains where to get help with the TANVIONROYALE platform. Use the links below to
            reach the right place — account and security options are available in the platform itself
            once you are signed in, and the public catalog pages work without an account.
          </p>
        }
      >
      <LegalSection title="Account, sign-in and security">
        <LegalList
          items={[
            <>
              For account questions, use the in-platform{' '}
              <LegalLink href="/support/chat">Live Chat</LegalLink> — messages are
              delivered to the support team and replies appear in the conversation
              and your <LegalLink href="/notifications">notifications</LegalLink>.
            </>,
            <>
              To report a specific problem (a screenshot can be attached), use{' '}
              <LegalLink href="/support/report">Report a Problem</LegalLink>. Each
              report is a case of its own — the ones you have submitted, with their
              status and updates, are listed under{' '}
              <LegalLink href="/support/reports">My problem reports</LegalLink>.
            </>,
            <>
              Password and sign-in options, including password reset and active session management,
              are available on the <LegalLink href="/settings">Settings</LegalLink> page.
            </>,
            <>
              Identity and phone verification is managed in the{' '}
              <LegalLink href="/verification">Verification</LegalLink> center.
            </>,
            <>
              If you cannot access your account, try password recovery first; if that does not work,
              review the account guidance in our{' '}
              <LegalLink href="/terms">Terms of Service</LegalLink>.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Games, sports and events">
        <LegalList
          items={[
            <>
              Browse the game catalog on the <LegalLink href="/games">Games</LegalLink> page and your
              saved titles on <LegalLink href="/favorites">Favorites</LegalLink>.
            </>,
            <>
              Follow sports, competitions and events under{' '}
              <LegalLink href="/sports">Sports</LegalLink>,{' '}
              <LegalLink href="/events">Events</LegalLink> and{' '}
              <LegalLink href="/live">Live</LegalLink>.
            </>,
            <>
              Current platform promotions are listed on the{' '}
              <LegalLink href="/promotions">Promotions</LegalLink> page.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Wallet, transactions and bets">
        <LegalList
          items={[
            <>
              Wallet balances, deposits and withdrawals (where these services are enabled for your
              account) are managed under <LegalLink href="/wallet">Wallet</LegalLink>.
            </>,
            <>
              Transaction history is available under{' '}
              <LegalLink href="/wallet/transactions">Transactions</LegalLink>, and bet records under{' '}
              <LegalLink href="/my-bets">My Bets</LegalLink>.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Privacy and data protection">
        <p>
          How your information is collected, used and protected — and how to exercise your rights —
          is described in our <LegalLink href="/privacy">Privacy Policy</LegalLink>. Questions about
          your data can be raised through the channels described there.
        </p>
      </LegalSection>

      <LegalSection title="Responsible gaming">
        <p>
          TANVIONROYALE is intended for adults aged 18 or over. Play responsibly, and review the rules
          that govern use of the platform in our{' '}
          <LegalLink href="/terms">Terms of Service</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="Service status">
        <p>
          If pages or features appear unavailable, you can check the platform service status on the{' '}
          <LegalLink href="/health">System status</LegalLink> page.
        </p>
      </LegalSection>
    </LegalArticle>
      <AppFooter />
    </>
  );
}
