'use strict';

/**
 * REAL-BROWSER verification that the ONE shared user navigation
 * (`components/navigation/user-nav.ts` -> `userNavSections`) is what the
 * MOBILE hamburger menu and the DESKTOP left sidebar actually paint.
 *
 * WHY THIS EXISTS
 * ---------------
 * The static guard in `test-affiliate-flow.cjs` can only read source. It
 * cannot tell a section that was never rendered from one that WAS rendered
 * and then pushed off the screen. The mobile menu lives inside
 *
 *     <header className="fixed inset-x-0 top-0 ...">
 *
 * and a `position: fixed` box does not travel with the document, so a menu
 * taller than the viewport silently loses its tail - the last section
 * (PERSONAL -> the affiliate entry + Settings) and the login/register row
 * simply disappear with no error anywhere. Only a real layout measurement
 * catches that, so this script measures boxes and hit-tests pixels.
 *
 * WHAT IT PROVES
 * --------------
 *   mobile (< md):  all four sections render; the menu is ONE scroll
 *                   container; the affiliate entry and Settings sit inside the
 *                   viewport and are hit-testable (NOT covered by the fixed
 *                   bottom nav); the close X still works; clicking the
 *                   affiliate entry really navigates to /affiliate.
 *   tablet (>= md): the pre-existing `md:hidden` breakpoint is unchanged.
 *   desktop (>=lg): the left sidebar shows PERSONAL + affiliate + Settings,
 *                   and is still absent on non-user routes.
 *   regression sim: the same page is measured again with the height cap
 *                   stripped, reproducing the pre-fix clipping so the numbers
 *                   below are not just an assertion.
 *
 * It runs the PRODUCTION build (`next start`) in headless Chrome, so it
 * measures the exact CSS that would be deployed, not a dev overlay.
 *
 * Run:  node scripts/verify-mobile-nav-browser.cjs
 * Env:  CHROME_PATH to override the browser binary.
 *
 * IMPORTANT — the build it runs against
 * -------------------------------------
 * The logout checks need a real /auth/logout request to reach the wire, and
 * `getApiBaseUrl()` (lib/api/client.ts) THROWS in a production build when
 * NEXT_PUBLIC_API_URL is absent, so apiFetch would fail before ever calling
 * fetch(). NEXT_PUBLIC_* is inlined at BUILD time, so build the app pointed at
 * this script's stub first:
 *
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:4599/api/v1  npx next build
 *   node scripts/verify-mobile-nav-browser.cjs
 *
 * The script preflights the built bundle and says so explicitly if the API URL
 * was not compiled in, rather than failing with a misleading zero.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const web = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'tanvion-mobile-nav-verify');
fs.rmSync(out, { recursive: true, force: true, maxRetries: 3 });
fs.mkdirSync(out, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Menu entries that must be reachable, in the order the spec requires. */
const REQUIRED_ITEMS = [
  'Home',
  'Dashboard',
  'BIG SPORT',
  'BIG CASINO',
  'BIG LIVE CASINO',
  'ROYALE PLAY',
  'Notification',
  'Deposit',
  'Withdraw',
  'Wallet',
  'Saved Favourite',
  'Support',
  'Live Chat',
  'Report a Problem',
  'Affiliate With Us',
  'Settings',
];
const REQUIRED_SECTIONS = ['MAIN', 'ACCOUNT', 'SERVICE', 'PERSONAL'];

/**
 * In-page probe: returns geometry + hit-test facts and changes nothing.
 * `window.__strip` (opt-in) removes the height cap to reproduce the old
 * markup and prove the regression is real.
 *
 * It is built by a function, not a bare template, so the Node-side
 * `REQUIRED_SECTIONS` / `REQUIRED_ITEMS` are inlined into the page instead of
 * resolving to an undefined variable over there.
 */
const probeExpr = () => `
(() => {
  const SECTIONS = ${JSON.stringify(REQUIRED_SECTIONS)};
  const ITEMS = ${JSON.stringify(REQUIRED_ITEMS)};
  const mainNav = document.querySelector('nav[aria-label="Mobile MAIN navigation"]');
  const panel = mainNav ? mainNav.parentElement.parentElement : null;

  if (window.__strip && panel) {
    panel.style.maxHeight = 'none';
    panel.style.overflowY = 'visible';
  }

  const rect = panel ? panel.getBoundingClientRect() : null;
  const cs = panel ? getComputedStyle(panel) : null;

  // Items are looked up INSIDE the mobile panel on purpose: the desktop
  // UserSidebar keeps the same links mounted at display:none below lg, and
  // querying the whole document would measure those 0x0 boxes instead.
  const scope = panel || document;

  const describe = (text) => {
    const el = Array.from(scope.querySelectorAll('a[href]'))
      .find((n) => (n.textContent || '').trim() === text) || null;
    if (!el) return { text, found: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      text,
      found: true,
      href: el.getAttribute('href'),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      // A hit test on the centre pixel: if the fixed bottom nav (or anything
      // else) is painted over the link, the tap would never reach it.
      clickable: !!hit && (hit === el || el.contains(hit)),
    };
  };

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bottomNav: (() => {
      const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
      if (!nav) return null;
      const r = nav.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    })(),
    panel: panel
      ? {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
          maxHeight: cs.maxHeight,
          overflowY: cs.overflowY,
          scrollable: panel.scrollHeight > panel.clientHeight + 1,
          scrollTop: Math.round(panel.scrollTop),
        }
      : null,
    sections: SECTIONS.map((t) => ({
      title: t,
      found: !!Array.from(scope.querySelectorAll('p'))
        .find((p) => (p.textContent || '').trim() === t),
    })),
    // The account-action row that closes the menu. It sits below the last
    // section, so it is the first thing to disappear when the menu overflows.
    login: describe('Login'),
    items: ITEMS.map(describe),
    closeButton: (() => {
      const b = document.querySelector('button[aria-label="Close menu"]');
      if (!b) return { found: false };
      const r = b.getBoundingClientRect();
      return {
        found: true,
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
      };
    })(),
  };
})()
`;

/** Fixed port for the stub API (baked into the build as NEXT_PUBLIC_API_URL). */
const STUB_API_PORT = 4599;
const STUB_API_ORIGIN = `http://127.0.0.1:${STUB_API_PORT}`;
const STUB_API_BASE = `${STUB_API_ORIGIN}/api/v1`;

const STUB_USER = {
  id: 'u-test',
  username: 'tester',
  email: 'tester@example.com',
  phone: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
  phoneVerified: true,
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Minimal stub of the two auth endpoints the logout path touches.
 *
 * WHY IT IS NEEDED
 * ----------------
 * `getApiBaseUrl()` (lib/api/client.ts) THROWS in a production build when
 * NEXT_PUBLIC_API_URL is missing, so `apiFetch` would fail before issuing any
 * request and the logout POST would never reach the wire — which makes the
 * "one request per tap burst" claim untestable. The web build is therefore
 * compiled with NEXT_PUBLIC_API_URL pointed here, and this stub answers:
 *
 *   GET  /api/v1/auth/me      -> the user, so the header renders signed in
 *   POST /api/v1/auth/logout  -> 200, so the request is real and parkable
 *   anything else            -> 404, so unrelated pages show their empty state
 *
 * Every response carries permissive CORS headers (the app is a different
 * origin) and answers OPTIONS, so the preflight never turns a POST into a
 * two-request artefact in the tally.
 */
function startStubApi() {
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,content-type',
      'Access-Control-Max-Age': '600',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = (req.url || '').split('?')[0];
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/v1/auth/me' && req.method === 'GET') {
      res.writeHead(200, cors);
      res.end(JSON.stringify(STUB_USER));
      return;
    }
    if (url === '/api/v1/auth/logout' && req.method === 'POST') {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, cors);
    res.end(JSON.stringify({ statusCode: 404, message: 'stub: not implemented' }));
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(STUB_API_PORT, '127.0.0.1', () => resolve(server));
  });
}
/** Boots the production build + headless Chrome and hands a CDP session to fn. */
async function withBrowser(fn) {
  const port = await freePort();
  const debugPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;

  // Spawned through the current node binary (not a shell) so it works on
  // Windows without `shell: true`.
  const nextBin = require.resolve('next/dist/bin/next', { paths: [web] });
  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: web,
    stdio: 'ignore',
  });
  const chrome = spawn(
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(out, 'chrome-profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws = null;

  const shutdown = () => {
    // The CDP socket is an open handle too: without closing it the process
    // never exits, and the next run cannot rebind the stub API port.
    try { if (ws) ws.close(); } catch { /* already closed */ }
    try { chrome.kill(); } catch { /* gone */ }
    try { server.kill(); } catch { /* gone */ }
    try {
      // close() alone only stops NEW connections: the browser's keep-alive
      // socket to the stub would keep the event loop alive and this script
      // would never exit. closeAllConnections() drops them.
      stub.closeAllConnections();
      stub.close();
    } catch { /* gone */ }
  };

  try {
    const stub = await startStubApi();
    console.log('  stub API on ' + STUB_API_BASE + ' (auth/me + auth/logout)');
    let up = false;
    for (let i = 0; i < 180; i++) {
      try {
        const res = await fetch(origin + '/');
        if (res.status > 0) { up = true; break; }
      } catch { /* not up yet */ }
      await delay(500);
    }
    assert.ok(up, 'the web production build never became reachable at ' + origin);

    /*
     * Preflight: the logout request can only be observed if NEXT_PUBLIC_API_URL
     * was compiled into this build. Without it getApiBaseUrl() throws first and
     * every network-based logout check would fail for the wrong reason.
     */
    const apiBaked = await (async () => {
      const dir = path.join(web, '.next', 'static', 'chunks');
      if (!fs.existsSync(dir)) return false;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        if (src.indexOf(STUB_API_BASE) !== -1) return true;
      }
      return false;
    })();
    if (!apiBaked) {
      console.log(
        '\n  WARNING: this build was made WITHOUT ' +
          'NEXT_PUBLIC_API_URL=' + STUB_API_BASE +
          '\n           The logout network checks (one request per tap burst, ' +
          'in-flight busy state)\n           cannot be exercised and will fail. ' +
          'Rebuild with that variable set to run the full suite.',
      );
    } else {
      console.log('  build preflight OK: NEXT_PUBLIC_API_URL is compiled in');
    }

    let pages;
    for (let i = 0; i < 120; i++) {
      try {
        pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        if (pages && pages.length) break;
      } catch { /* not listening yet */ }
      await delay(100);
    }
    assert.ok(pages && pages.length, 'Chrome failed to start');

    ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];

    /*
     * Request accounting.
     *
     * Counting in the page does NOT work here: the App Router installs its own
     * `fetch` wrapper at startup and keeps a direct reference to it, so
     * monkey-patching `window.fetch` from the test never sees the app's calls.
     * The browser's own network events are the only trustworthy source, so the
     * tally comes from CDP.
     *
     * `Fetch` is enabled for the logout call so the request can be held open
     * (paused) while the test inspects the in-flight UI. Pausing is also what
     * makes the "a burst of taps issues one request" claim observable: taps 2
     * and 3 are attempted while request 1 is still parked.
     */
    const networkLog = [];
    const pausedRequests = [];
    let fetchEnabled = false;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Network.requestWillBeSent') {
        networkLog.push({
          url: msg.params.request.url,
          method: msg.params.request.method,
        });
      }
      if (msg.method === 'Fetch.requestPaused') {
        // Park the actual POST but let the CORS preflight straight through, so
        // the tally counts one logout request and not a preflight + request.
        if (msg.params.request.method === 'POST') {
          pausedRequests.push({
            requestId: msg.params.requestId,
            url: msg.params.request.url,
          });
        } else {
          try { send('Fetch.continueRequest', { requestId: msg.params.requestId }); }
          catch { /* ignore */ }
        }
      }
      const entry = msg.id && pending.get(msg.id);
      if (entry) { pending.delete(msg.id); msg.error ? entry.j(msg.error) : entry.r(msg.result); }
    };

    const send = (method, params = {}) =>
      new Promise((r, j) => {
        const n = ++id;
        pending.set(n, { r, j });
        ws.send(JSON.stringify({ id: n, method, params }));
      });

    await send('Page.enable');
    await send('Runtime.enable');

    /** Evaluates an expression in the page and returns its value. */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    };

    /** Loads a route and waits for the shared header to mount. */
    const visit = async (route) => {
      await send('Page.navigate', { url: origin + route });
      for (let i = 0; i < 80; i++) {
        const ready = await ev(
          `document.readyState === 'complete' && !!document.querySelector('header')`,
        ).catch(() => false);
        if (ready) break;
        await delay(250);
      }
      // The header renders nothing until the auth state resolves, so wait for
      // the hamburger itself before anyone tries to click it.
      for (let i = 0; i < 40; i++) {
        const hasButton = await ev(`!!document.querySelector('button[aria-label="Open menu"]')`)
          .catch(() => false);
        if (hasButton) break;
        await delay(250);
      }
      await delay(400);
      return origin + route;
    };

    /**
     * Seeds the real session-store keys the app itself writes
     * (lib/auth/session.ts: ng.access / ng.refresh / ng.user) so the menu
     * renders its SIGNED-IN state. <AuthProvider> seeds `user` from these on
     * mount; the /auth/me revalidation then fails with the API absent, which
     * the provider deliberately treats as TRANSIENT and does NOT clear on.
     * Nothing here bypasses the auth code path - it is the same path a real
     * signed-in browser takes.
     */
    const seedSession = async () => {
      await send('Page.navigate', { url: origin + '/login' });
      await delay(600);
      await ev(
        `(() => {
          localStorage.setItem('ng.access', 'test-access-token');
          localStorage.setItem('ng.refresh', 'test-refresh-token');
          localStorage.setItem('ng.user', JSON.stringify({
            id: 'u-test', username: 'tester', email: 't@e.st',
            phoneVerified: true, emailVerified: true, role: 'CUSTOMER',
            status: 'ACTIVE', createdAt: new Date(0).toISOString(),
          }));
          return true;
        })()`,
      );
      await delay(200);
    };

    /** Reads the canonical session keys + the current pathname. */
    const sessionState = async () =>
      JSON.parse(
        await ev(
          `JSON.stringify({
            access: !!localStorage.getItem('ng.access'),
            refresh: !!localStorage.getItem('ng.refresh'),
            user: !!localStorage.getItem('ng.user'),
            path: location.pathname,
          })`,
        ),
      );

    /** Drops the seeded keys so the next scenario starts signed out again. */
    const clearSeededSession = async () => {
      await ev(
        `(() => { ['ng.access','ng.refresh','ng.user'].forEach((k) => localStorage.removeItem(k));
          return true; })()`,
      );
    };

    /** Emulates a viewport (device pixel ratio 1 keeps the px maths stable). */
    const viewport = async (width, height, mobile) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      });
    };

    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    };

    /**
     * Starts parking every request whose URL matches `pattern` at the request
     * stage, so the page sits "in flight" until releasePaused() is called.
     */
    const pauseRequests = async (pattern) => {
      await send('Network.enable');
      await send('Fetch.enable', {
        patterns: [{ urlPattern: pattern, requestStage: 'Request' }],
      });
      fetchEnabled = true;
    };

    /** Releases every parked request and stops intercepting. */
    const releasePaused = async () => {
      for (const p of pausedRequests.splice(0)) {
        try {
          await send('Fetch.continueRequest', { requestId: p.requestId });
        } catch { /* already gone */ }
      }
      if (fetchEnabled) {
        fetchEnabled = false;
        try { await send('Fetch.disable'); } catch { /* ignore */ }
      }
    };

    /** POST requests matching `needle`, parked and total. */
    const requests = (needle) => ({
      paused: pausedRequests.filter((p) => p.url.includes(needle)).length,
      all: networkLog.filter((r) => r.url.includes(needle) && r.method === 'POST').length,
    });

    return await fn({
      ev, visit, viewport, shot, origin, consoleErrors,
      seedSession, sessionState, clearSeededSession,
      pauseRequests, releasePaused, requests,
    });
  } finally {
    shutdown();
  }
}

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  \u2713 ' + msg);
  else { failures += 1; console.error('  \u2718 FAILED: ' + msg); }
};

const banner = (title) => {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + title);
  console.log('='.repeat(72));
};

const MOBILE = [
  { label: 'small android 360x800', w: 360, h: 800 },
  { label: 'iphone 12/13   390x844', w: 390, h: 844 },
  { label: 'pixel 7        412x915', w: 412, h: 915 },
  // Deliberately short viewports. A 4-section menu needs ~640px of vertical
  // room, so these are the sizes where the OLD uncapped container pushed the
  // tail of the menu under the fixed bottom nav / off the screen.
  { label: 'short viewport 360x620', w: 360, h: 620 },
  { label: 'very short     360x560', w: 360, h: 560 },
];

/** Opens the hamburger, waits for the panel, returns the probe result. */
const openMenu = async (ev, strip) => {
  await ev(`document.querySelector('button[aria-label="Open menu"]').click()`);
  await ev(
    `!!document.querySelector('nav[aria-label="Mobile MAIN navigation"]') || true`,
  );
  await delay(500);
  if (strip) await ev(`window.__strip = true`);
  return ev(probeExpr());
};

/** Scrolls the menu panel to its end so the last section is on screen. */
const scrollMenuToEnd = async (ev) => {
  await ev(
    `(() => { const n = document.querySelector('nav[aria-label="Mobile MAIN navigation"]');
      const p = n.parentElement.parentElement; p.scrollTop = p.scrollHeight; return p.scrollTop; })()`,
  );
  await delay(400);
};

withBrowser(async (ctx) => {
  const { ev, visit, viewport, shot, consoleErrors,
    seedSession, sessionState, clearSeededSession,
    pauseRequests, releasePaused, requests } = ctx;
  // =====================================================================
  banner('1. MOBILE - every section of userNavSections is rendered');
  // =====================================================================
  for (const vp of MOBILE) {
    console.log('\n  -- ' + vp.label + ' --');
    await viewport(vp.w, vp.h, true);
    await visit('/');
    const m = await openMenu(ev, false);

    const missingSections = m.sections.filter((s) => !s.found).map((s) => s.title);
    check(
      missingSections.length === 0,
      'all four sections render: ' + REQUIRED_SECTIONS.join(' / ') +
        (missingSections.length ? ' (missing: ' + missingSections.join(', ') + ')' : ''),
    );

    const notRendered = m.items.filter((i) => !i.found).map((i) => i.text);
    check(
      notRendered.length === 0,
      'all ' + REQUIRED_ITEMS.length + ' entries are in the DOM' +
        (notRendered.length ? ' (missing: ' + notRendered.join(', ') + ')' : ''),
    );

    const affiliate = m.items.find((i) => i.text === 'Affiliate With Us');
    check(!!affiliate && affiliate.href === '/affiliate',
      '"Affiliate With Us" points at /affiliate (got ' + (affiliate && affiliate.href) + ')');
    const settings = m.items.find((i) => i.text === 'Settings');
    check(!!settings && settings.href === '/settings',
      '"Settings" points at /settings (got ' + (settings && settings.href) + ')');

    // --- the panel is a real scroll container -------------------------
    console.log('     panel: max-height=' + m.panel.maxHeight + ' overflow-y=' + m.panel.overflowY +
      ' client=' + m.panel.clientHeight + ' scroll=' + m.panel.scrollHeight +
      ' bottom=' + m.panel.bottom + ' viewportH=' + m.viewport.h);
    check(m.panel.overflowY === 'auto', 'the menu is a vertical scroll container');
    check(m.panel.maxHeight !== 'none', 'the menu has a viewport-relative height cap');
    check(
      m.panel.bottom <= m.viewport.h,
      'the menu never extends past the bottom of the screen (' +
        m.panel.bottom + ' <= ' + m.viewport.h + ')',
    );
    check(!!m.bottomNav, 'the mobile bottom nav is present for the coverage test');
    check(
      !m.bottomNav || m.panel.bottom <= m.bottomNav.top,
      'the menu stops above the fixed bottom nav (' + m.panel.bottom +
        ' <= ' + (m.bottomNav && m.bottomNav.top) + ')',
    );
    check(m.closeButton.found && m.closeButton.inViewport, 'the close X stays on screen');
    await shot('mobile-' + vp.w + 'x' + vp.h);
  }

  // =====================================================================
  banner('2. MOBILE - the last section is REACHABLE by scrolling');
  // =====================================================================
  for (const vp of MOBILE) {
    console.log('\n  -- ' + vp.label + ' --');
    await viewport(vp.w, vp.h, true);
    await visit('/');
    await openMenu(ev, false);
    await scrollMenuToEnd(ev);
    const m = await ev(probeExpr());

    const tail = m.items.filter((i) => ['Report a Problem', 'Affiliate With Us', 'Settings'].includes(i.text));
    for (const t of tail) {
      const item = tail.find((i) => i.text === t.text);
      check(item.found && item.inViewport,
        '"' + t.text + '" is inside the viewport after scrolling (top=' +
          t.top + ' bottom=' + t.bottom + ' vh=' + m.viewport.h + ')');
      check(item.clickable, '"' + t.text + '" is hit-testable (nothing painted over it)');
    }
    check(m.panel.scrollTop > 0 || !m.panel.scrollable,
      'the panel scrolled' + (m.panel.scrollable ? '' : ' (tall enough that no scroll was needed)'));
    await shot('mobile-scrolled-' + vp.w + 'x' + vp.h);
  }

  // =====================================================================
  banner('3. MOBILE - the affiliate link really opens /affiliate');
  // =====================================================================
  await viewport(390, 844, true);
  await visit('/');
  await openMenu(ev, false);
  await ev(
    `(() => { const n = document.querySelector('nav[aria-label="Mobile MAIN navigation"]');
      const p = n.parentElement.parentElement;
      Array.from(p.querySelectorAll('a[href]'))
        .find((a) => (a.textContent || '').trim() === 'Affiliate With Us').click();
      return true; })()`,
  );
  for (let i = 0; i < 40; i++) {
    if ((await ev(`location.pathname`)) === '/affiliate') break;
    await delay(250);
  }
  const after = await ev(`JSON.stringify({
    path: location.pathname,
    alert: !!document.querySelector('[role="alert"]'),
    main: !!document.querySelector('main'),
    menuClosed: !document.querySelector('nav[aria-label="Mobile MAIN navigation"]'),
  })`);
  const state = JSON.parse(after);
  check(state.path === '/affiliate', 'clicking it navigates to /affiliate (got ' + state.path + ')');
  check(state.main, 'the affiliate page mounted its <main> (not a 404)');
  check(state.menuClosed, 'the mobile menu closed after navigating');
  await shot('affiliate-page-390x844');

  // =====================================================================
  banner('4. MOBILE - the close X still closes the menu');
  // =====================================================================
  await viewport(360, 620, true);
  await visit('/');
  await openMenu(ev, false);
  await ev(`document.querySelector('button[aria-label="Close menu"]').click()`);
  await delay(400);
  const closed = await ev(
    `JSON.stringify({ gone: !document.querySelector('nav[aria-label="Mobile MAIN navigation"]'),
      back: !!document.querySelector('button[aria-label="Open menu"]') })`,
  );
  const closedState = JSON.parse(closed);
  check(closedState.gone, 'the menu panel is removed');
  check(closedState.back, 'the hamburger reverts to "Open menu"');

  // =====================================================================
  banner('5. MOBILE - the Logout action (signed in)');
  // =====================================================================
  for (const vp of MOBILE) {
    console.log('\n  -- ' + vp.label + ' --');
    await seedSession();
    await viewport(vp.w, vp.h, true);
    await visit('/');
    const signedIn = await openMenu(ev, false);

    // Signed in == the session actions are Profile + Logout, so there must be
    // NO "Login" link in the menu (that pair is the signed-out state).
    check(!signedIn.login.found,
      'the menu is in its signed-in state (Logout offered, no Login/Register pair)');
    const lo = JSON.parse(await ev(
      `(() => { const n = document.querySelector('nav[aria-label="Mobile MAIN navigation"]');
        const p = n.parentElement.parentElement;
        const b = Array.from(p.querySelectorAll('button'))
          .find((x) => /Logout|Logging out/.test(x.textContent || ''));
        if (!b) return JSON.stringify({ found: false });
        p.scrollTop = p.scrollHeight;
        const r2 = b.getBoundingClientRect();
        const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return JSON.stringify({ found: true, tag: b.tagName, type: b.type,
          label: (b.textContent || '').trim(), disabled: b.disabled,
          hasIcon: !!b.querySelector('svg'),
          inViewport: r2.top >= 0 && r2.bottom <= window.innerHeight,
          clickable: !!hit && (hit === b || b.contains(hit)) }); })()`,
    ));
    check(lo.found, 'a "Logout" control exists in the menu');
    check(lo.tag === 'BUTTON' && lo.type === 'button',
      'it is a real <button type="button">, NOT a link/route');
    check(lo.hasIcon, 'it carries a sign-out icon, like every other menu row');
    check(lo.inViewport && lo.clickable,
      'it is reachable by scrolling to the bottom and hit-testable');
    check(!lo.disabled, 'it is enabled while idle');
    await shot('logout-' + vp.w + 'x' + vp.h);
  }

  // --- the actual logout ------------------------------------------------
  await seedSession();
  await viewport(390, 844, true);
  await visit('/');
  const loBefore = await sessionState();
  check(loBefore.access && loBefore.refresh && loBefore.user,
    'a session is stored before tapping (ng.access / ng.refresh / ng.user)');

  await openMenu(ev, false);

  /*
   * Park the real /auth/logout request at the CDP Request stage. That does two
   * things at once:
   *   - the page is genuinely mid-request, so the busy UI is observable
   *     (offline it would otherwise complete in a couple of ms);
   *   - taps 2 and 3 are attempted while request 1 is still parked, so the
   *     single-flight claim is testable instead of theoretical.
   */
  await pauseRequests('*auth/logout*');

  // Fire the tap three times back to back, exactly like an impatient user.
  await ev(
    `(() => { const n = document.querySelector('nav[aria-label="Mobile MAIN navigation"]');
      const p = n.parentElement.parentElement;
      const b = Array.from(p.querySelectorAll('button'))
        .find((x) => /Logout|Logging out/.test(x.textContent || ''));
      b.click(); b.click(); b.click();
      return true; })()`,
  );

  // Wait for the parked request to show up (i.e. the tap really fired).
  for (let i = 0; i < 40 && requests('/auth/logout').paused === 0; i++) await delay(100);
  const inFlight = requests('/auth/logout');
  check(inFlight.paused === 1,
    'a burst of 3 taps puts exactly ONE /auth/logout request on the wire (got ' +
      inFlight.paused + ')');

  const busy = JSON.parse(await ev(
    `JSON.stringify((() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => /Logging out|Logout/.test(x.textContent || ''));
      if (!b) return { none: true };
      return { label: (b.textContent || '').trim(), disabled: b.disabled,
               busy: b.getAttribute('aria-busy') };
    })())`,
  ));
  check(busy.none !== true && busy.disabled === true && busy.busy === 'true',
    'while that request is parked the control is disabled + aria-busy and reads ' +
      JSON.stringify(busy.label) + ' (' + JSON.stringify(busy) + ')');

  // Let the request finish and the app complete its transition.
  await releasePaused();
  for (let i = 0; i < 40; i++) {
    if ((await sessionState()).path === '/login') break;
    await delay(250);
  }
  await delay(500);
  const loAfter = await sessionState();
  const total = requests('/auth/logout').all;
  console.log('     /auth/logout requests issued for a 3x tap burst: ' + total);
  check(total === 1,
    'the whole burst still only ever issued ONE /auth/logout request (got ' + total + ')');
  check(!loAfter.access && !loAfter.refresh && !loAfter.user,
    'the stored session is fully cleared (ng.access / ng.refresh / ng.user all gone)');
  check(loAfter.path === '/login',
    'the user lands on the canonical logged-out route /login (got ' + loAfter.path + ')');
  const menuGone = await ev(
    `!document.querySelector('nav[aria-label="Mobile MAIN navigation"]')`,
  );
  check(menuGone, 'the mobile menu closed after logging out');
  await shot('after-logout-390x844');

  // =====================================================================
  banner('5b. DESKTOP - the header logout is still there, and is not duplicated');
  // =====================================================================
  await seedSession();
  await viewport(1280, 900, false);
  await visit('/');
  const deskLo = JSON.parse(await ev(
    `JSON.stringify((() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => (x.textContent || '').trim() === 'Log out');
      return b ? { found: true, visible: b.getBoundingClientRect().width > 0,
                   disabled: b.disabled } : { found: false };
    })())`,
  ));
  check(deskLo.found && deskLo.visible,
    'the desktop header "Log out" button is still present and visible');
  check(deskLo.disabled === false, 'it is enabled while idle');
  const noDup = JSON.parse(await ev(
    `JSON.stringify({ matched: Array.from(
       document.querySelectorAll('aside[aria-label="User navigation"] button'))
       .map((b) => (b.textContent || '').trim())
       .filter((t) => /log ?out/i.test(t)) })`,
  ));
  check(noDup.matched.length === 0,
    'no second logout control was added to the desktop sidebar' +
      (noDup.matched.length ? ' (found: ' + noDup.matched.join(', ') + ')' : ''));

  // Section 7 measures the SIGNED-OUT menu, so drop the seeded session first.
  await clearSeededSession();

  // =====================================================================
  banner('6. TABLET 768x1024 - the pre-existing md:hidden breakpoint');
  // =====================================================================
  await viewport(768, 1024, true);
  await visit('/');
  const tablet = await ev(
    `JSON.stringify({
      hamburger: (() => { const b = document.querySelector('button[aria-label="Open menu"]');
        return b ? getComputedStyle(b).display : null; })(),
      aside: (() => { const a = document.querySelector('aside[aria-label="User navigation"]');
        return a ? getComputedStyle(a).display : 'absent'; })(),
      header: !!document.querySelector('header'),
    })`,
  );
  const tab = JSON.parse(tablet);
  check(tab.header, 'the shared header still renders at 768px');
  check(tab.hamburger === 'none',
    'the hamburger is still hidden at md+ (unchanged breakpoint, was ' + tab.hamburger + ')');
  check(tab.aside === 'none' || tab.aside === 'absent',
    'the lg-only sidebar is not shown below 1024px (display: ' + tab.aside + ')');
  await shot('tablet-768x1024');

  // =====================================================================
  banner('6. DESKTOP 1280x900 - the shared sidebar shows PERSONAL too');
  // =====================================================================
  await viewport(1280, 900, false);
  await visit('/');
  const desk = await ev(
    `(() => {
      const aside = document.querySelector('aside[aria-label="User navigation"]');
      if (!aside) return JSON.stringify({ found: false });
      const vis = getComputedStyle(aside).display !== 'none';
      const titles = Array.from(aside.querySelectorAll('p'))
        .map((p) => (p.textContent || '').trim())
        .filter((t) => ['MAIN','ACCOUNT','SERVICE','PERSONAL'].includes(t));
      const links = Array.from(aside.querySelectorAll('a[href]')).map((a) => ({
        text: (a.textContent || '').trim(), href: a.getAttribute('href'),
      }));
      return JSON.stringify({ found: true, vis, titles, links });
    })()`,
  );
  const d = JSON.parse(desk);
  check(d.found && d.vis, 'the left UserSidebar is visible at lg+');
  check(
    d.titles.join('/') === 'MAIN/ACCOUNT/SERVICE/PERSONAL',
    'the sidebar renders all four sections (' + d.titles.join('/') + ')',
  );
  const deskAff = d.links.find((l) => l.text === 'Affiliate With Us');
  const deskSet = d.links.find((l) => l.text === 'Settings');
  check(!!deskAff && deskAff.href === '/affiliate', 'sidebar "Affiliate With Us" -> /affiliate');
  check(!!deskSet && deskSet.href === '/settings', 'sidebar "Settings" -> /settings');
  for (const keep of ['Home', 'Dashboard', 'Deposit', 'Withdraw', 'Wallet', 'Support']) {
    check(d.links.some((l) => l.text === keep), 'sidebar still has "' + keep + '"');
  }
  await shot('desktop-1280x900');

  // The sidebar must still stay off non-user routes (admin/auth).
  await visit('/login');
  const onLogin = await ev(`!!document.querySelector('aside[aria-label="User navigation"]')`);
  check(!onLogin, 'the user sidebar is still absent on /login (auth routes unaffected)');

  // =====================================================================
  banner('7. REGRESSION SIMULATION - the pre-fix container really clipped it');
  // =====================================================================
  // The cap is removed at RUNTIME, which reproduces the old markup exactly
  // without needing a second build: same DOM, same CSS, one declaration gone.
  for (const vp of MOBILE) {
    console.log('\n  -- ' + vp.label + ' (height cap removed at runtime) --');
    await viewport(vp.w, vp.h, true);
    await visit('/');
    const before = await openMenu(ev, true);
    const aff = before.items.find((i) => i.text === 'Affiliate With Us');
    // The lowest edge the menu may occupy: the bottom nav when it is on screen
    // (it is a sibling `fixed` bar at the same z-index), else the viewport.
    const limit = before.bottomNav ? before.bottomNav.top : before.viewport.h;
    const lost = Math.max(0, before.panel.bottom - limit);
    console.log('     panel: max-height=' + before.panel.maxHeight +
      ' content=' + before.panel.scrollHeight +
      ' bottom=' + before.panel.bottom + ' usableBottom=' + limit +
      ' viewportH=' + before.viewport.h + '  -> lost=' + lost + 'px');
    console.log('     Affiliate With Us: found=' + !!aff.found +
      ' top=' + (aff && aff.top) + ' bottom=' + (aff && aff.bottom) +
      ' inViewport=' + (aff && aff.inViewport) + ' clickable=' + (aff && aff.clickable));
    console.log('     closing Login row:   top=' + before.login.top +
      ' bottom=' + before.login.bottom +
      ' inViewport=' + before.login.inViewport + ' clickable=' + before.login.clickable);
    check(!!aff.found, 'the entry is in the DOM either way (it is clipped, not missing)');
    if (lost > 0) {
      check(before.panel.bottom > limit,
        'WITHOUT the cap the menu runs ' + lost + 'px past the usable bottom edge');
      check(!(before.login.inViewport && before.login.clickable),
        '... and the row that closes the menu (Login/Register) is genuinely unreachable');
    } else {
      check(aff.inViewport && aff.clickable && before.login.clickable,
        'at this height the old markup happened to fit (the bug is height-dependent)');
    }
    await shot('regression-sim-' + vp.w + 'x' + vp.h);
  }

  // =====================================================================
  banner('8. CONSOLE');
  // =====================================================================
  // The affiliate page fetches from the API, which is intentionally absent in
  // this harness; a failed network fetch is not a navigation defect.
  const real = consoleErrors.filter((e) => !/Failed to load resource|net::ERR/i.test(e));
  check(real.length === 0, 'no unexpected console errors' + (real.length ? ': ' + real.join(' | ') : ''));

  console.log('\n' + '='.repeat(72));
  if (failures > 0) {
    console.error('  ' + failures + ' mobile-nav browser check(s) FAILED.');
    process.exitCode = 1;
    return;
  }
  console.log('  ALL MOBILE NAVIGATION BROWSER CHECKS PASSED');
  console.log('  Screenshots: ' + out);
}).then(() => {
  /*
   * Explicit exit. Node's global fetch (undici) keeps POOLED keep-alive
   * sockets to the Next server and the Chrome debug port, which hold the
   * event loop open long after the last check has passed. Without this the
   * process lingers and the next run cannot rebind the stub API port.
   * `process.exitCode` is only set on failure, so the result is preserved.
   */
  process.exit(process.exitCode ?? 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
