import type { Metadata } from 'next';
import {
  LegalDocument,
  LegalLink,
  LegalList,
  LegalSection,
} from '@/components/layout/legal-document';

export const metadata: Metadata = {
  title: 'Terms of Service | TANVIONROYALE',
  description:
    'The terms that govern your use of the TANVIONROYALE platform: acceptance, eligibility (18+), account registration and security, acceptable use, games and sports services, betting and wallet provisions, termination, liability and contact.',
};

const LAST_UPDATED = '4 September 2026';

/**
 * Public Terms of Service (/terms).
 *
 * Server-rendered and static-friendly: no API calls, no authentication and no
 * database access — the page renders even when the backend is unavailable.
 * Wording matches the platform as it exists: a branded games/sports front-end
 * whose regulated operations (where enabled) are handled by licensed partners.
 */
export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Terms of Service"
      updated={LAST_UPDATED}
      intro={
        <p>
          These Terms of Service (&quot;Terms&quot;) form an agreement between you and the operator of the
          TANVIONROYALE platform (&quot;TANVIONROYALE&quot;, &quot;we&quot;, &quot;us&quot;) and govern your access to and use of this
          website and the related platform services. By creating an account or using the platform you
          accept these Terms and our <LegalLink href="/privacy">Privacy Policy</LegalLink>. If you do not
          agree with them, please do not use the platform.
        </p>
      }
    >
      <LegalSection title="1. Acceptance of Terms">
        <p>
          By accessing this website, creating an account or using any feature of the platform, you confirm
          that you have read, understood and agree to be bound by these Terms and by any service rules we
          publish in the platform (including betting rules where they are enabled). If you do not agree
          with these Terms, you must stop using the platform.
        </p>
      </LegalSection>

      <LegalSection title="2. About TANVIONROYALE">
        <p>
          TANVIONROYALE is a branded web platform that brings games and sports content together in one place.
          Regulated activities — including betting acceptance, odds, settlement, deposits, withdrawals
          and identity verification where they apply — are provided through a licensed betting operator
          and licensed payment and verification partners integrated into the platform. Where the platform
          is operated in demonstration mode, no real-money transactions are processed and related
          features are simulated for evaluation purposes.
        </p>
      </LegalSection>

      <LegalSection title="3. Eligibility">
        <p>To use the platform you must:</p>
        <LegalList
          items={[
            'be at least 18 years old, or the legal gambling age in your jurisdiction if it is higher;',
            'register only one account and provide accurate, complete and current registration information;',
            'not be prohibited from using the platform by applicable law, sanctions, self-exclusion or a regulatory restriction;',
            'not have had a previous account suspended or closed for breach of these Terms.',
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Account registration and security">
        <p>
          Accounts are created with a verified phone number and a one-time SMS code, or by signing in
          with Google or Facebook where available. Email sign-in, password recovery and optional profile
          details are supported where the platform offers them. You are responsible for:
        </p>
        <LegalList
          items={[
            'keeping your password confidential and never sharing it with anyone;',
            'all activity that takes place in your account;',
            'telling us promptly through Support if you suspect unauthorised access or use of your account;',
            'enabling and using two-factor authentication where we make it available.',
          ]}
        />
        <p>
          We may suspend an account where we reasonably believe it has been compromised or is being used
          in breach of these Terms.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use and prohibited activities">
        <p>You may use the platform for personal, non-commercial entertainment only. You must not:</p>
        <LegalList
          items={[
            'use the platform if you are under 18 or otherwise ineligible;',
            'create multiple accounts or register with false or misleading details;',
            'interfere with, probe or attempt to circumvent security, authentication, rate limits or access controls;',
            'use automated tools, bots or scraping to access the platform or interact with it;',
            'use the platform for fraud, money laundering, terrorist financing or any unlawful activity;',
            'misuse payment flows, including chargeback abuse or funding an account with money you are not entitled to use;',
            'copy, resell or commercially exploit platform content without permission;',
            'attempt to bypass geographic, eligibility or self-exclusion restrictions.',
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Games, sports and content">
        <p>
          The games, sports, events and related information shown in the platform are provided for
          information and entertainment. Catalogue content, event schedules, live information and
          availability may change, be suspended or be withdrawn at any time. Links to partner events lead
          to destinations that are resolved and allowlisted server-side; once you leave the platform, the
          third party’s own terms apply and we are not responsible for their content or services.
        </p>
      </LegalSection>

      <LegalSection title="7. Betting provisions (where enabled)">
        <p>
          Where betting is enabled, the following applies in addition to any rules published by the
          licensed operator:
        </p>
        <LegalList
          items={[
            'a bet is a request; it becomes binding only once it is accepted and recorded by the platform or the operator;',
            'the odds snapshot stored at the moment of placement governs your potential payout, even if odds change later;',
            'bets are settled on official results; obvious errors, palpable mistakes or wrongly accepted bets may be corrected or voided;',
            'for events routed to a partner operator, that operator’s own terms also apply and settlement is performed by the operator;',
            'responsible-gambling controls and limits apply where they are offered, and we encourage you to use them;',
            'in demonstration mode no real-money bets are accepted and simulated outcomes have no monetary value.',
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Wallet and payment provisions (where enabled)">
        <p>Where wallet features are enabled:</p>
        <LegalList
          items={[
            'deposits and withdrawals are processed by third-party payment providers; TANVIONROYALE does not store card numbers or bank credentials;',
            'verification of identity or source of funds may be required before a withdrawal is processed;',
            'a payment may be delayed, limited or refused by a payment provider or by the operator for security, compliance or regulatory reasons;',
            'provider or network fees may apply and are shown to you before you confirm a transaction where practical;',
            'in demonstration mode, wallet balances and transactions are simulated and have no monetary value.',
          ]}
        />
      </LegalSection>

      <LegalSection title="9. Third-party services and websites">
        <p>
          The platform integrates third-party services, including website and API hosting, SMS and email
          delivery, payment processing, licensed betting operators and Google/Facebook sign-in. Those
          services are governed by their own terms and privacy policies, and their availability is not
          guaranteed. We are not liable for the acts or omissions of third parties except as required by
          law.
        </p>
      </LegalSection>

      <LegalSection title="10. Suspension, limitation and termination">
        <p>
          We may suspend, limit or close an account, and refuse or reverse transactions, where we
          reasonably believe it is necessary to comply with the law or a regulator instruction, to
          prevent fraud, abuse or security risks, to enforce these Terms, or to respond to a verified
          account compromise. You may stop using the platform and request account closure at any time
          through the <LegalLink href="/support">Support</LegalLink> page. Where funds remain in an
          enabled wallet, they are handled in line with the applicable verification, compliance and
          legal requirements.
        </p>
      </LegalSection>

      <LegalSection title="11. Intellectual property">
        <p>
          The TANVIONROYALE name, branding, software and content are owned by the operator or its licensors
          and are protected by intellectual-property laws. Third-party marks and content belong to their
          respective owners. We grant you a limited, revocable, non-exclusive licence to use the platform
          for its intended purpose; all other rights are reserved.
        </p>
      </LegalSection>

      <LegalSection title="12. Disclaimer">
        <p>
          The platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis. To the maximum extent
          permitted by law, we disclaim warranties that the platform will be uninterrupted, error-free or
          fit for a particular purpose, and we do not guarantee the accuracy or completeness of sports
          data, event information or catalogue content. Nothing in these Terms affects rights you have
          under the operator’s rules or mandatory law.
        </p>
      </LegalSection>

      <LegalSection title="13. Limitation of liability">
        <p>
          To the maximum extent permitted by law, neither TANVIONROYALE nor the operator is liable for
          indirect, incidental, special or consequential losses, or for loss of profits, data or
          goodwill, arising from your use of, or inability to use, the platform. Nothing in these Terms
          excludes or limits liability that cannot lawfully be excluded — including liability for death
          or personal injury caused by negligence, for fraud, or any liability owed to you under
          applicable gambling or consumer law.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes to these Terms">
        <p>
          We may update these Terms to reflect changes in the platform, our partners or the law. The
          “Last updated” date above shows the current version. Where a change is material, we will take
          reasonable steps to highlight it. Continuing to use the platform after changes take effect
          means you accept the updated Terms; if you do not accept them, you should stop using the
          platform.
        </p>
      </LegalSection>

      <LegalSection title="15. Governing law">
        <p>
          These Terms are governed by the laws applicable to the entity operating the platform, without
          prejudice to mandatory consumer-protection rights in your country of residence. Where
          regulated betting applies, the licence conditions of the licensed operator also govern the
          relevant services.
        </p>
      </LegalSection>

      <LegalSection title="16. Contact">
        <p>
          Questions, complaints and support requests can be raised through the{' '}
          <LegalLink href="/support">Support</LegalLink> page. Betting- and payment-specific complaints
          may be passed to the licensed operator responsible for those services.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}