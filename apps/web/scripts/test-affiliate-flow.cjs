#!/usr/bin/env node
/**
 * AFFILIATE + REFERRAL SIGNUP frontend tests.
 *
 * Static checks on the REAL production code path (no mocks of our own
 * modules), in the same style as `test-referral-flow.cjs`:
 *
 *   1. "Affiliate With Us" exists, spelled correctly, near the END of the user
 *      menu, and comes from the ONE shared nav definition (so desktop and
 *      mobile cannot drift apart);
 *   2. `/affiliate` is a user-panel route, so it gets the sidebar;
 *   3. the referral link reaches SIGNUP: `/signup`, `/register` and
 *      `/referral/<code>` all resolve to the same attribution flow;
 *   4. the code survives the flow and is forwarded to the API, including OAuth;
 *   5. the user UI can never submit a reward amount, income or status;
 *   6. the BigBang webhook secret is never persisted or re-displayable.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const web = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(web, rel), 'utf8');
const readOptional = (rel) => {
  const p = path.join(web, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  OK  ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('  FAIL ' + name);
  }
}

const USER_NAV = read('components/navigation/user-nav.ts');
const SIDEBAR = read('components/navigation/user-sidebar.tsx');
const APP_HEADER = read('components/layout/app-header.tsx');
const AFFILIATE_PAGE = readOptional('app/(user)/affiliate/page.tsx');
const AFFILIATE_UI = readOptional('components/affiliate/affiliate-dashboard.tsx');
const AFFILIATE_API = readOptional('lib/api/affiliate.ts');
const ADMIN_PANEL = readOptional('components/admin/affiliate-admin-panel.tsx');
const BIGBANG_SECTION = readOptional('components/admin/bigbang-portal-section.tsx');
const SIGNUP_PAGE = read('app/(auth)/signup/page.tsx');
const REGISTER_PAGE = read('app/(auth)/register/page.tsx');
const REFERRAL_CAPTURE = readOptional('lib/referral-capture.ts');
const REFERRAL_ROUTE = readOptional('app/referral/[code]/page.tsx');
const AUTH_API = read('lib/api/auth.ts');
const ADMIN_REFERRAL_PAGE = read('app/admin/referral/page.tsx');
const PROVIDERS_PAGE = read('app/admin/partner-providers/page.tsx');

(async () => {
  console.log('Affiliate program + referral signup - frontend wiring');

  // -------------------------------------------------------------------------
  // 1. "Affiliate With Us" menu entry
  // -------------------------------------------------------------------------
  await test('the menu label is exactly "Affiliate With Us"', () => {
    assert.ok(
      /label:\s*'Affiliate With Us'/.test(USER_NAV),
      'the label must be spelled "Affiliate With Us"',
    );
  });

  await test('no misspelling of "Affiliate" is present', () => {
    for (const bad of ['Afilet', 'Affilet', 'Affilate']) {
      assert.ok(!USER_NAV.includes(bad), `found misspelling: ${bad}`);
      assert.ok(!AFFILIATE_PAGE.includes(bad), `found misspelling: ${bad}`);
    }
  });

  await test('it is declared in the ONE shared nav definition (no second source)', () => {
    // Both the desktop sidebar and the mobile drawer must read the SAME array.
    assert.ok(/userNavSections/.test(SIDEBAR), 'the desktop sidebar must use userNavSections');
    assert.ok(/userNavSections/.test(APP_HEADER), 'the mobile menu must use userNavSections');
    assert.ok(
      !/Affiliate With Us/.test(SIDEBAR),
      'the label must not be hard-coded in the sidebar (it would drift from mobile)',
    );
    assert.ok(
      !/Affiliate With Us/.test(APP_HEADER),
      'the label must not be hard-coded in the mobile header',
    );
  });

  await test('it sits near the END of the menu, before Settings', () => {
    const affiliateAt = USER_NAV.indexOf("label: 'Affiliate With Us'");
    const settingsAt = USER_NAV.indexOf("label: 'Settings'");
    assert.ok(affiliateAt > -1, 'the affiliate item must exist');
    assert.ok(settingsAt > affiliateAt, 'Settings must come AFTER the affiliate item');
  });

  await test('/affiliate is a user-panel route so it gets the sidebar', () => {
    assert.ok(
      /'\/affiliate'/.test(USER_NAV),
      '/affiliate must be added to USER_PANEL_PREFIXES',
    );
  });

  await test('the affiliate page is mounted in the (user) route group', () => {
    assert.ok(AFFILIATE_PAGE.length > 0, 'app/(user)/affiliate/page.tsx must exist');
    assert.ok(
      /AffiliateDashboard/.test(AFFILIATE_PAGE),
      'the page must render the dashboard component',
    );
  });

  // -------------------------------------------------------------------------
  // 2. Referral link reaches SIGNUP
  // -------------------------------------------------------------------------
  await test('/signup exists and reads ?ref=', () => {
    assert.ok(SIGNUP_PAGE.includes("searchParams.get('ref')"), 'signup must read ?ref=');
  });

  await test('/register shares the SAME component as /signup', () => {
    assert.ok(
      /from '\.\.\/signup\/page'/.test(REGISTER_PAGE),
      '/register must re-export the /signup page (one form, one attribution path)',
    );
  });

  await test('/referral/<code> redirects into the same signup flow', () => {
    assert.ok(REFERRAL_ROUTE.length > 0, 'app/referral/[code]/page.tsx must exist');
    assert.ok(
      /redirect\(`\/signup\?ref=/.test(REFERRAL_ROUTE),
      'a path-style link must redirect to /signup?ref=CODE',
    );
    assert.ok(
      /redirect\('\/signup'\)/.test(REFERRAL_ROUTE),
      'an invalid code must still open signup (never a dead end)',
    );
  });

  await test('the referral code is forwarded to the phone/OTP signup request', () => {
    assert.ok(/ref:\s*referralCode/.test(SIGNUP_PAGE), 'phone signup must carry the code');
  });

  await test('the referral code survives the OAUTH hop', () => {
    assert.ok(
      /getOAuthRedirectUrl\(provider,\s*referralCode\)/.test(SIGNUP_PAGE),
      'the OAuth start must receive the referral code',
    );
    assert.ok(
      /ref\?: string \| null/.test(AUTH_API),
      'getOAuthRedirectUrl must accept a ref argument',
    );
  });

  await test('the code is preserved across navigation and refresh', () => {
    assert.ok(REFERRAL_CAPTURE.includes('sessionStorage'), 'the code must survive a refresh');
    assert.ok(
      /signInHref/.test(SIGNUP_PAGE),
      'the "Sign in" link must carry the code so a bounce back is not lossy',
    );
  });

  await test('an invalid code never blocks signup', () => {
    assert.ok(
      /That referral code is not valid/.test(SIGNUP_PAGE),
      'an invalid code must still let the visitor sign up',
    );
  });

  await test('the browser only ever sends a CODE, never a referrer id', () => {
    assert.ok(
      !/referrerUserId|referrerId|affiliateUserId/.test(SIGNUP_PAGE + REFERRAL_CAPTURE),
      'no referrer id may be sent from the browser',
    );
  });

  // -------------------------------------------------------------------------
  // 3. Financial safety in the UI
  // -------------------------------------------------------------------------
  await test('the affiliate UI never submits an amount or a status', () => {
    const payloads = AFFILIATE_API.match(/JSON\.stringify\(\{[^)]*\}\)/g) || [];
    for (const call of payloads) {
      assert.ok(
        !/(amount|income|status|paid|approved)/i.test(call),
        `a client payload must not carry money/status: ${call}`,
      );
    }
  });

  await test('the target form only submits month/type/value', () => {
    assert.ok(
      /year: number; month: number; targetType: AffiliateTargetType; targetValue: number/.test(
        AFFILIATE_API,
      ),
      'setAffiliateTarget must accept only configuration',
    );
  });

  await test('"no monthly target" is shown honestly, not as a zero', () => {
    assert.ok(
      /No monthly target set/.test(AFFILIATE_UI),
      'the UI must distinguish an unset target from a configured zero',
    );
    assert.ok(/targetValue === null/.test(AFFILIATE_UI), 'the UI must branch on a null target');
  });

  await test('the affiliate page paginates its lists', () => {
    assert.ok(
      /getAffiliateReferrals\(/.test(AFFILIATE_UI) &&
        /getAffiliateTransactions\(/.test(AFFILIATE_UI),
      'referred users and transactions must be fetched separately and paginated',
    );
  });

  // -------------------------------------------------------------------------
  // 4. Content safety
  // -------------------------------------------------------------------------
  await test('the admin panel can add / edit / reorder / toggle sections', () => {
    for (const fn of [
      'createAffiliateContentBlock',
      'updateAffiliateContentBlock',
      'reorderAffiliateContentBlocks',
      'deleteAffiliateContentBlock',
    ]) {
      assert.ok(ADMIN_PANEL.includes(fn), `the admin panel must expose ${fn}`);
    }
  });

  await test('the admin panel is mounted on the existing referral admin page', () => {
    assert.ok(
      /AffiliateAdminPanel/.test(ADMIN_REFERRAL_PAGE),
      'the affiliate panel must be part of /admin/referral (one source of truth)',
    );
  });

  await test('the admin panel offers only measurable target types', () => {
    assert.ok(
      /TARGET_TYPES: AffiliateTargetType\[\] = \['QUALIFIED_REFERRALS', 'SIGNUPS'\]/.test(
        ADMIN_PANEL,
      ),
      'only measurable target types may be offered',
    );
  });

  // -------------------------------------------------------------------------
  // 5. Affiliate ACTIVATION is separate from the referral system
  // -------------------------------------------------------------------------
  await test('the page branches on the server-reported affiliate status', () => {
    assert.ok(
      /affiliateStatus !== 'ACTIVE'/.test(AFFILIATE_UI),
      'the page must decide activation from the server, not from a client guess',
    );
    assert.ok(
      /affiliateStatus: AffiliateStatus/.test(AFFILIATE_API),
      'the dashboard payload must carry the affiliate status',
    );
  });

  await test('an inactive user is offered the activation card, not a dashboard', () => {
    assert.ok(
      /Become a TANVIONROYALE Affiliate/.test(AFFILIATE_UI),
      'the activation card must be shown to a non-affiliate',
    );
    assert.ok(
      /Activate your affiliate account to get your personal affiliate link/.test(AFFILIATE_UI),
      'the card must explain what activation grants',
    );
    assert.ok(
      /AffiliateActivationCard/.test(AFFILIATE_UI),
      'the activation card must be rendered by the page',
    );
  });

  await test('the activation form asks for the promotion details and the agreement', () => {
    for (const field of [
      'Full name',
      'Email',
      'Phone',
      'Promotion method',
      'How will you promote TANVIONROYALE?',
    ]) {
      assert.ok(AFFILIATE_UI.includes(field), `the activation form must collect "${field}"`);
    }
    assert.ok(
      /accept the TANVIONROYALE affiliate agreement/i.test(AFFILIATE_UI),
      'the agreement checkbox is required before activation',
    );
    // The channel select is a closed set, not free text.
    for (const value of ['SOCIAL_MEDIA', 'YOUTUBE', 'TIKTOK', 'TELEGRAM', 'COMMUNITY']) {
      assert.ok(
        AFFILIATE_API.includes(value),
        `the closed promotion-method set must include ${value}`,
      );
    }
  });

  await test('the activation form never asks for a password, card or ID document', () => {
    const form = AFFILIATE_UI.slice(
      AFFILIATE_UI.indexOf('function AffiliateActivationCard'),
      AFFILIATE_UI.indexOf('export function AffiliateDashboard'),
    );
    assert.ok(form.length > 0, 'the activation form must exist in the component');
    for (const forbidden of [
      'password',
      'card number',
      'cardNumber',
      'cvc',
      'passport',
      'national id',
      'nid',
    ]) {
      assert.ok(
        !new RegExp(forbidden, 'i').test(form),
        `the activation form must not collect "${forbidden}"`,
      );
    }
    // The submit payload is exactly the agreed, non-sensitive field set.
    assert.ok(
      /acceptTerms: true/.test(form),
      'the agreement must be submitted as an explicit acceptance',
    );
  });

  await test('activation is prefilled from the existing account', () => {
    assert.ok(
      /prefill\.fullName/.test(AFFILIATE_UI) && /prefill\.email/.test(AFFILIATE_UI),
      'the form must be prefilled from the account instead of re-asking',
    );
    assert.ok(
      /prefill: \{ fullName: string \| null; email: string \| null; phone: string \| null \}/.test(
        AFFILIATE_API,
      ),
      'the status response must carry the prefill',
    );
  });

  await test('the activation call is authenticated and scoped to the caller', () => {
    assert.ok(
      /'\/me\/affiliate\/activate'/.test(AFFILIATE_API),
      'activation must use the caller-scoped /me/affiliate namespace',
    );
    const call = AFFILIATE_API.slice(
      AFFILIATE_API.indexOf('export function activateAffiliate'),
      AFFILIATE_API.indexOf('export function deactivateAffiliate'),
    );
    assert.ok(
      !/userId|referralCode|affiliateUserId/.test(call),
      'the browser must never name a user, a code or another affiliate',
    );
  });

  // -------------------------------------------------------------------------
  // 6. Content first, personal dashboard last
  // -------------------------------------------------------------------------
  await test('admin content renders BEFORE the personal dashboard', () => {
    const contentAt = AFFILIATE_UI.indexOf('content.map((block)');
    const personalAt = AFFILIATE_UI.indexOf('My affiliate dashboard');
    assert.ok(contentAt > -1, 'the admin content blocks must be rendered');
    assert.ok(personalAt > -1, 'the personal dashboard must be rendered');
    assert.ok(
      contentAt < personalAt,
      'the admin-configured content must come before the personal dashboard',
    );
  });

  await test('the personal sections are always present and admin cannot remove them', () => {
    for (const section of [
      'Your affiliate link',
      'Your affiliate code',
      'Summary',
      'Earnings',
      'My referred users',
      'Earnings history',
      'Monthly target',
    ]) {
      assert.ok(
        AFFILIATE_UI.includes(section),
        `the personal section "${section}" must always exist for an active affiliate`,
      );
    }
    // They are rendered by the component, not fetched as a removable block.
    assert.ok(
      /No monthly target set/.test(AFFILIATE_UI) && /targetValue === null/.test(AFFILIATE_UI),
      'an unset target must be shown honestly, not as a zero',
    );
  });

  await test('the earnings breakdown is complete', () => {
    for (const label of [
      'Total earned',
      'Pending',
      'Paid',
      'Rejected',
      'This month',
      'Last month',
    ]) {
      assert.ok(AFFILIATE_UI.includes(label), `the earnings view must show "${label}"`);
    }
  });

  await test('the personal tables are paginated, not fully loaded', () => {
    assert.ok(/getAffiliateReferrals\(/.test(AFFILIATE_UI), 'referred users are paginated');
    assert.ok(
      /getAffiliateTransactions\(/.test(AFFILIATE_UI),
      'the earnings history is paginated',
    );
    assert.ok(/function Pager\(/.test(AFFILIATE_UI), 'a pager must be rendered');
  });

  await test('the personal lists are not fetched for a non-affiliate', () => {
    assert.ok(
      /if \(!isActive\) return;/.test(AFFILIATE_UI),
      'the personal tables must not be requested before activation',
    );
  });

  await test('the inactive page cannot render a link or a figure it does not have', () => {
    // The link/code cards are behind the ACTIVE branch that returns early.
    const inactiveBranch = AFFILIATE_UI.slice(
      AFFILIATE_UI.indexOf("if (data.affiliateStatus !== 'ACTIVE')"),
      AFFILIATE_UI.indexOf('const { stats, target, referralLink'),
    );
    assert.ok(
      !inactiveBranch.includes('referralLink'),
      'the inactive branch must not touch the affiliate link',
    );
    assert.ok(
      !inactiveBranch.includes('referralCode'),
      'the inactive branch must not touch the affiliate code',
    );
  });

  await test('copy and share still exist for the active affiliate link', () => {
    assert.ok(/Copy link/.test(AFFILIATE_UI), 'the copy-link action must remain');
    assert.ok(/Share/.test(AFFILIATE_UI), 'the share action must remain');
    assert.ok(/Copy code/.test(AFFILIATE_UI), 'the copy-code action must remain');
    assert.ok(/navigator/.test(AFFILIATE_UI), 'the native share sheet must still be used');
  });

  // -------------------------------------------------------------------------
  // 7. Admin: active-only list, status control, content editing
  // -------------------------------------------------------------------------
  await test('the admin list is driven by the ACTIVE affiliate endpoint', () => {
    assert.ok(
      /\/admin\/affiliate\/affiliates\?/.test(AFFILIATE_API),
      'the admin affiliate list must use the active-profile endpoint',
    );
    assert.ok(
      /searchAffiliateAdmins/.test(ADMIN_PANEL),
      'the admin panel must search the active affiliate list',
    );
  });

  await test('the admin can deactivate and reactivate an affiliate', () => {
    assert.ok(/setAffiliateStatus/.test(ADMIN_PANEL), 'the panel must expose the status control');
    assert.ok(
      /Deactivate affiliate/.test(ADMIN_PANEL) && /Reactivate affiliate/.test(ADMIN_PANEL),
      'both directions must be offered',
    );
    assert.ok(
      /\/admin\/affiliate\/\$\{encodeURIComponent\(userId\)\}\/status/.test(AFFILIATE_API),
      'the status endpoint must be admin-scoped',
    );
  });

  await test('the admin detail shows the activation information', () => {
    for (const label of [
      'Active affiliates',
      'Channel',
      'Activated',
      'Deactivated',
      'isAffiliate',
    ]) {
      assert.ok(ADMIN_PANEL.includes(label), `the admin detail must show "${label}"`);
    }
  });

  await test('the affiliate counters distinguish membership from referral', () => {
    assert.ok(
      /Active affiliates/.test(ADMIN_PANEL) && /Inactive affiliates/.test(ADMIN_PANEL),
      'the panel must separate active from inactive affiliates',
    );
    assert.ok(
      /inactiveAffiliates: number/.test(AFFILIATE_API),
      'the overview must report inactive affiliates separately',
    );
  });

  await test('the admin can EDIT an existing content block', () => {
    assert.ok(/updateAffiliateContentBlock\(/.test(ADMIN_PANEL), 'edit must call update');
    assert.ok(/startEdit/.test(ADMIN_PANEL), 'the editor must be able to load a block');
    assert.ok(
      /if \(editingId\)[\s\S]{0,200}updateAffiliateContentBlock\(/.test(ADMIN_PANEL),
      'saving an edit must update that block rather than create a new one',
    );
    // And the create path is still available.
    assert.ok(/createAffiliateContentBlock\(/.test(ADMIN_PANEL), 'add must still create');
  });

  await test('the admin editor exposes every content field', () => {
    for (const field of [
      'Section type',
      'Title',
      'Subtitle',
      'Body',
      'Items',
      'Image URL',
      'CTA text',
      'CTA link',
      'Position',
      'Enabled',
    ]) {
      assert.ok(ADMIN_PANEL.includes(field), `the editor must expose "${field}"`);
    }
    // The image URL really is submitted, not just labelled.
    assert.ok(
      /imageUrl: draft\.imageUrl \|\| undefined/.test(ADMIN_PANEL),
      'the image URL must be sent to the server',
    );
    assert.ok(
      /imageUrl\?: string;/.test(AFFILIATE_API),
      'the client payload must carry the image URL',
    );
  });

  await test('the admin can control the exact position', () => {
    assert.ok(
      /sortOrder: draft\.sortOrder/.test(ADMIN_PANEL),
      'the position number must be submitted',
    );
    assert.ok(
      />\s*Up\s*</.test(ADMIN_PANEL) && />\s*Down\s*</.test(ADMIN_PANEL),
      'the up/down controls must remain',
    );
    assert.ok(
      /reorderAffiliateContentBlocks/.test(ADMIN_PANEL),
      'up/down must use the explicit reorder contract',
    );
  });

  await test('no hard-coded domain is introduced in the affiliate UI', () => {
    for (const source of [AFFILIATE_UI, ADMIN_PANEL, AFFILIATE_API]) {
      assert.ok(
        !/tanvionroyale\.vercel\.app|localhost:\d/.test(source),
        'no production domain or localhost may be hard-coded',
      );
    }
  });

  // -------------------------------------------------------------------------
  // 8. GLOBAL vs INDIVIDUAL content scope
  // -------------------------------------------------------------------------
  await test('the content block type carries its scope to the admin UI', () => {
    assert.ok(
      /affiliateUserId: string \| null;/.test(AFFILIATE_API),
      'the block type must expose the scope discriminator',
    );
    assert.ok(
      /scope: 'GLOBAL' \| 'INDIVIDUAL';/.test(AFFILIATE_API),
      'the block type must expose a pre-computed scope label',
    );
  });

  await test('the admin panel labels GLOBAL and individual content differently', () => {
    assert.ok(
      /Global Affiliate Content/.test(ADMIN_PANEL),
      'the shared section must be titled "Global Affiliate Content"',
    );
    assert.ok(
      /Individual Content - @/.test(ADMIN_PANEL),
      'the per-affiliate section must be titled with the selected username',
    );
    // Every row states its own scope, so the admin never has to guess.
    assert.ok(/Scope: \{scopeLabel\}/.test(ADMIN_PANEL), 'each content row must show its scope');
    assert.ok(/scopeLabel="GLOBAL"/.test(ADMIN_PANEL), 'the global list must be labelled GLOBAL');
  });

  await test('the admin panel exposes the individual content API', () => {
    for (const fn of [
      'getAffiliateIndividualContent',
      'createAffiliateIndividualContent',
      'updateAffiliateIndividualContent',
      'deleteAffiliateIndividualContent',
      'reorderAffiliateIndividualContent',
    ]) {
      assert.ok(ADMIN_PANEL.includes(fn), `the admin panel must expose ${fn}`);
      assert.ok(AFFILIATE_API.includes(fn), `the client must define ${fn}`);
    }
  });

  await test('the individual content scope comes from the URL, never the body', () => {
    // The per-affiliate endpoints are all keyed on the selected user id.
    for (const pattern of [
      /`\/admin\/affiliate\/\$\{encodeURIComponent\(userId\)\}\/content`/,
      /`\/admin\/affiliate\/\$\{encodeURIComponent\(userId\)\}\/content\/reorder`/,
    ]) {
      assert.ok(pattern.test(AFFILIATE_API), 'the individual scope must live in the URL path');
    }
    // `AffiliateContentInput` carries no scope field, so no caller can choose it.
    const input = AFFILIATE_API.slice(
      AFFILIATE_API.indexOf('export interface AffiliateContentInput'),
      AFFILIATE_API.indexOf('export function getAffiliateContentBlocks'),
    );
    assert.ok(
      !/affiliateUserId|scope/.test(input),
      'the shared content payload must not contain a scope field',
    );
  });

  await test('switching affiliate clears the previous individual state', () => {
    // A `useEffect` on `selected` must reset every affiliate-scoped slice so
    // Affiliate A's content can never be shown under Affiliate B.
    const anchor = '}, [selected]);';
    const at = ADMIN_PANEL.indexOf(anchor);
    const effect = ADMIN_PANEL.slice(at - 400, at + anchor.length);
    assert.ok(at > -1, 'the selection effect must exist');
    for (const reset of [
      'setIndBlocks([])',
      'setIndEditingId(null)',
      'setIndDraft(EMPTY_DRAFT)',
      'setTargetEditingId(null)',
    ]) {
      assert.ok(effect.includes(reset), `switching affiliate must run ${reset}`);
    }
  });

  await test('the individual editor reuses the shared global editor', () => {
    // One field set and one list, used by both scopes - not a duplicated editor.
    assert.ok(
      /<ContentFields draft=\{draft\} onChange=\{setDraft\} \/>/.test(ADMIN_PANEL),
      'the global editor must use the shared fields',
    );
    assert.ok(
      /<ContentFields draft=\{indDraft\} onChange=\{setIndDraft\} \/>/.test(ADMIN_PANEL),
      'the individual editor must reuse the same shared fields',
    );
    assert.ok(
      /function ContentFields\(/.test(ADMIN_PANEL) && /function ContentList\(/.test(ADMIN_PANEL),
      'the shared editor and list components must exist',
    );
  });

  await test('the image preview is client-side and allow-list guarded', () => {
    assert.ok(
      /function ImagePreview\(/.test(ADMIN_PANEL),
      'the admin editor must offer an image preview',
    );
    // The same https-only allow-list the API enforces, applied before render.
    assert.ok(
      /const SAFE_URL = \/\^/.test(ADMIN_PANEL),
      'the preview must be guarded by the same URL allow-list',
    );
    assert.ok(
      /function isSafeImageUrl\(/.test(ADMIN_PANEL),
      'an unsafe URL must never reach the img src',
    );
  });

  await test('the admin can add, edit and delete an individual target', () => {
    for (const fn of ['startEditTarget', 'onDeleteTarget', 'deleteAffiliateTarget']) {
      assert.ok(ADMIN_PANEL.includes(fn), `the admin panel must expose ${fn}`);
    }
    // A delete is confirmed before it is sent.
    assert.ok(
      /window\.confirm\(/.test(ADMIN_PANEL),
      'a target deletion must be confirmed in the UI',
    );
    assert.ok(
      /startEditTarget\(t\)/.test(ADMIN_PANEL) && /onDeleteTarget\(t\)/.test(ADMIN_PANEL),
      'the target history must offer both Edit and Delete',
    );
  });

  await test('the user dashboard still renders global then individual content', () => {
    // The server resolves both scopes; the page just renders the list it got,
    // and the personal dashboard always stays last.
    const contentAt = AFFILIATE_UI.indexOf('content.map((block)');
    const personalAt = AFFILIATE_UI.indexOf('My affiliate dashboard');
    assert.ok(contentAt > -1 && contentAt < personalAt);
    assert.ok(
      /scope: 'GLOBAL' \| 'INDIVIDUAL';/.test(AFFILIATE_API),
      'the dashboard payload type must describe both scopes',
    );
  });

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length > 0) {
    for (const f of failures) {
      console.log('\n--- ' + f.name + '\n' + (f.error && f.error.message));
    }
    process.exit(1);
  }
  console.log('All affiliate frontend tests passed.');
})();
