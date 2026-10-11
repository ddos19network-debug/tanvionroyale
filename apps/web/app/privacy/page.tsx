import type { Metadata } from 'next';
import {
  LegalDocument,
  LegalLink,
  LegalList,
  LegalSection,
  LegalSub,
} from '@/components/layout/legal-document';

export const metadata: Metadata = {
  title: 'Privacy Policy | TANVIONROYALE',
  description:
    'How TANVIONROYALE collects, uses and protects your information: account registration, phone, email and Google/Facebook sign-in, session and technical data, betting and wallet records, third-party providers, retention, security and your rights.',
};

const LAST_UPDATED = '4 September 2026';

/**
 * Public Privacy Policy (/privacy).
 *
 * Server-rendered and static-friendly: no API calls, no authentication and no
 * database access — the page renders even when the backend is unavailable.
 * Wording reflects the data the platform actually handles (see the Prisma
 * schema): phone/OTP and email registration, optional profile fields, Google
 * and Facebook sign-in identities, hashed sessions/OTP codes, audit records,
 * bets, wallets and optional verification providers.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={LAST_UPDATED}
      intro={
        <p>
          This Privacy Policy explains what information TANVIONROYALE (&quot;TANVIONROYALE&quot;, &quot;we&quot;, &quot;us&quot;,
          &quot;our&quot;) collects when you visit this website or use the platform, why we collect it, how we
          protect it, and the rights and choices you have. It applies to the TANVIONROYALE website and its
          supporting platform services. Please read it together with our{' '}
          <LegalLink href="/terms">Terms of Service</LegalLink>.
        </p>
      }
    >
      <LegalSection title="About TANVIONROYALE">
        <p>
          TANVIONROYALE is a branded web platform that brings games and sports content together in one place.
          It consists of this website, its supporting backend service, and integrations with selected
          third parties. Where regulated activities — such as real-money betting, deposits or withdrawals
          — are enabled, they are provided through a licensed betting operator and payment providers
          integrated into the platform (see “Third-party service providers” below). When the platform is
          operated in demonstration mode, no real-money transactions are processed and related features
          are simulated.
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <LegalSub title="Account registration">
          <p>When you create an account we collect the information needed to identify and secure it:</p>
          <LegalList
            items={[
              'your phone number, verified with a one-time SMS code when you sign up with your phone;',
              'a username and a password — passwords are stored only as cryptographic hashes, never in plain text;',
              'optionally, profile details you choose to add, such as first name, last name, country, timezone or date of birth;',
              'your email address, if you register or sign in with email, add an email to your profile, or use password recovery.',
            ]}
          />
        </LegalSub>

        <LegalSub title="Authentication and security information">
          <p>To keep accounts safe we maintain the following authentication records:</p>
          <LegalList
            items={[
              'login session records, including the IP address, browser user-agent and timestamps of your sign-ins;',
              'one-time codes used for phone sign-up, verification, account recovery and OAuth exchanges — stored only as irreversible SHA-256 hashes, single-use and short-lived;',
              'security and audit records for sensitive actions (for example registration, password changes and administrative actions), which may include IP address and user-agent;',
              'two-factor authentication secrets, encrypted at rest, if you enable two-factor authentication where it is available.',
            ]}
          />
        </LegalSub>

        <LegalSub title="Google and Facebook sign-in">
          <p>
            If you choose “Continue with Google” or “Continue with Facebook”, we receive the account
            identifier, email address and basic profile details (such as your name and profile picture)
            that you consent to share through that provider. We store this as a linked sign-in identity
            (the provider name and a provider account identifier) attached to your TANVIONROYALE account. We
            never receive your Google or Facebook password, and one external identity can be linked to
            only one TANVIONROYALE account.
          </p>
        </LegalSub>

        <LegalSub title="Technical information">
          <p>
            When you use the website, our backend records standard technical request information such as
            your IP address and browser user-agent. This is used for security, fraud prevention, rate
            limiting and keeping the service available and reliable.
          </p>
        </LegalSub>

        <LegalSub title="Games, sports and betting information">
          <p>
            Your favourites and bet-slip selections are stored locally in your browser. Where betting is
            enabled, we record the bets you place: the stake and currency, the selections and the odds
            snapshot taken at placement, and the settlement outcome. For events routed to a partner
            operator, the operator processes the bet and we receive the references and settlement details
            needed to reflect the result in your account.
          </p>
        </LegalSub>

        <LegalSub title="Wallet and payment information">
          <p>
            Where wallet features are enabled, we record your balances and every wallet movement —
            deposits, withdrawals, bet stakes, payouts and adjustments — including the transaction status
            and the payment provider reference. Amounts are stored as integer minor-unit values within a
            double-entry ledger. We do not store card numbers, CVV/CVC codes, bank logins or other payment
            credentials: payments are handled by the payment provider.
          </p>
        </LegalSub>

        <LegalSub title="Verification information">
          <p>
            We keep the verification status of your phone and email. Where identity or face verification
            is configured, we store the verification status and the provider case reference — raw
            biometric data is not stored by TANVIONROYALE.
          </p>
        </LegalSub>
      </LegalSection>

      <LegalSection title="How we use your information">
        <p>We use the information described above to:</p>
        <LegalList
          items={[
            'create and maintain your account and authenticate you, including phone, email, Google and Facebook sign-in;',
            'operate the games, sports, betting and wallet features where they are enabled;',
            'protect the platform and its users — fraud prevention, abuse detection, rate limiting and account recovery;',
            'meet legal, regulatory and record-keeping obligations that apply to the operator;',
            'provide customer support and send transactional messages related to your account, such as one-time codes;',
            'keep an audit trail of sensitive actions and diagnose, fix and improve the service.',
          ]}
        />
        <p>We do not sell your personal information and we do not use it for third-party advertising.</p>
      </LegalSection>

      <LegalSection title="Legal bases for processing (where applicable)">
        <p>
          Where the EU or UK General Data Protection Regulation or similar laws apply, we process personal
          information on the following bases: performance of a contract (operating your account, bets and
          wallet); legitimate interests (securing the platform, preventing fraud and abuse, and improving
          reliability); compliance with legal obligations (financial and gaming record-keeping); and
          your consent, where you choose an optional feature such as linking a Google or Facebook
          identity. You may withdraw consent at any time; this does not affect processing already carried
          out.
        </p>
      </LegalSection>

      <LegalSection title="Third-party service providers">
        <p>
          We rely on the following categories of providers to operate the platform. Several of these
          integrations are optional: when a provider is not configured, the related feature is disabled
          or fails safely rather than collecting data.
        </p>
        <LegalList
          items={[
            'Website hosting — this website is served from Vercel;',
            'API hosting — the TANVIONROYALE backend API runs on Render;',
            'Database — a managed PostgreSQL database provider stores platform data;',
            'SMS provider — delivery of one-time codes for phone sign-up and verification (for example Twilio);',
            'Email provider — delivery of transactional email such as password resets;',
            'Payment provider — processing of deposits and withdrawals where wallet features are enabled;',
            'Licensed betting operator and partner providers — operation of partner betting events, where enabled;',
            'Google LLC and Meta Platforms, Inc. — sign-in with Google and Facebook;',
            'Face verification provider — identity checks, only where this integration is configured.',
          ]}
        />
        <p>
          These providers process information on our behalf, or as independent controllers for their own
          services, under their own privacy policies.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          We do not use advertising cookies or third-party tracking. After you sign in, your session
          tokens and basic profile details are stored in your browser&apos;s local storage so that you stay
          signed in between visits. Your bet slip, favourites and some interface preferences are also
          stored locally on your device. Clearing your browser storage signs you out and removes these
          items. If the platform later moves sessions to httpOnly cookies, this policy will be updated to
          reflect that.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <LegalList
          items={[
            'Account and profile information is kept while your account is active.',
            'When you close your account, personal data is deleted or anonymised except for records we must retain — for example financial, betting, verification or audit records — for the period required by law or regulation.',
            'Login sessions are kept until they expire or are revoked; one-time codes are kept only until shortly after their short expiry.',
            'Audit and security records are kept as tamper-evident logs for the retention period required by law or operator policy.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Data security">
        <p>
          We protect information with measures proportionate to its sensitivity, including TLS encryption
          in transit, passwords hashed with Argon2, session tokens and one-time codes stored only as
          hashes, provider secrets encrypted at rest (AES-256-GCM), role-based access control for
          administrative functions, and audit logging of sensitive actions.
        </p>
        <p>
          No method of transmission or storage is completely secure, so we cannot guarantee absolute
          security. If a breach affects your information, we will notify you and the relevant authorities
          where required by law.
        </p>
      </LegalSection>

      <LegalSection title="Your rights and choices">
        <p>
          Depending on where you live, you may have the right to access, correct, delete, restrict or
          object to the processing of your personal information, to data portability, and to withdraw
          consent where processing is based on consent. You can review and edit your profile details in
          the platform settings at any time, and you can clear locally stored data (bet slip, favourites,
          session) from your browser.
        </p>
        <p>
          To exercise your rights, ask a question or close your account, contact us through the{' '}
          <LegalLink href="/support">Support</LegalLink> page. We may need to verify your identity before
          acting on a request. The steps for requesting deletion of your account and personal data — and the
          records we must retain — are set out on the{' '}
          <LegalLink href="/account-deletion">Account Deletion</LegalLink> page.
        </p>
      </LegalSection>

      <LegalSection title="Children and age restriction">
        <p>
          TANVIONROYALE is intended for adults aged 18 or over. We do not knowingly collect information from
          children, and the platform is not directed to anyone under 18. If we learn that an account
          belongs to a person under 18, we will suspend or close it and take reasonable steps to delete
          the related personal information.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this Privacy Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes in the platform, our
          providers or the law. The “Last updated” date above shows the current version. If a change
          materially affects your rights, we will take reasonable steps to highlight it before it takes
          effect. Continuing to use the platform after an update means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        <p>
          Questions about this policy, or about how your information is handled, can be raised through
          the <LegalLink href="/support">Support</LegalLink> page. Privacy and data-protection enquiries
          are handled through the same channel.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}