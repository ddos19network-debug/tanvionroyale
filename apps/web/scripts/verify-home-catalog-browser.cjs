'use strict';

/**
 * REAL-BROWSER verification that the public Home / Games pages actually render
 * provider games.
 *
 * WHY THIS EXISTS
 * ---------------
 * The regression tests prove the data flow; they cannot prove that a browser
 * really issues the request and really paints the cards. This script runs the
 * PRODUCTION build (`next start`) in headless Chrome, points it at the REAL
 * deployed API, and reports the measured count for every layer of the chain.
 *
 * For `/` and `/games` it measures:
 *   - the catalog request that left the browser (method + full URL)
 *   - its HTTP status
 *   - how many games the API actually returned
 *   - how many game cards the DOM contains
 *   - the per-provider breakdown of the RENDERED cards
 *   - that the old placeholder tiles are gone
 *
 * `--disable-web-security` is passed ONLY so the local origin may call the
 * production API (the deployed CORS allowlist holds the Vercel origin, not
 * localhost). The request, the response and the rendering are all real.
 *
 * Run: `node scripts/verify-home-catalog-browser.cjs`
 * Env:  CHROME_PATH to override the browser binary.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const web = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'tanvion-home-catalog-verify');
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

/** Script installed BEFORE any page script runs. */
const INSTALL_PROBE = `
(() => {
  window.__catalogCalls = [];
  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const res = await nativeFetch.apply(this, arguments);
    if (url.indexOf('/casino/catalog') !== -1) {
      const record = { url, method: (init && init.method) || 'GET', status: res.status, body: null };
      window.__catalogCalls.push(record);
      try {
        res.clone().json().then((b) => { record.body = b; }).catch(() => {});
      } catch (e) { /* opaque body */ }
    }
    return res;
  };

  window.__probe = () => {
    // The public catalog section is the one carrying this heading id. Cards
    // inside it are provider catalog games; anything else on the page (e.g. the
    // in-house "Royale Play" free-play section) is counted separately so the
    // provider numbers stay exact.
    const section = document.querySelector('[aria-labelledby="casino-catalog-heading"]');
    // A CasinoGameCard is an <article> with an <h3> title AND a "studio ·
    // category" line. That marker distinguishes it from the nested ProviderCard
    // (which shows "N games") so provider cards are never counted as games.
    const isGameCard = (a) =>
      a.querySelector('h3') &&
      Array.from(a.querySelectorAll('p')).some(
        (p) => (p.textContent || '').indexOf('\\u00b7') >= 0,
      );
    const readCards = (root) =>
      Array.from(root.querySelectorAll('article'))
        .filter(isGameCard)
        .map((c) => {
          const h3 = c.querySelector('h3');
          const meta = Array.from(c.querySelectorAll('p'))
            .map((p) => p.textContent || '')
            .find((t) => t.indexOf('\\u00b7') >= 0) || '';
          const img = c.querySelector('img');
          return {
            title: ((h3 && h3.textContent) || '').trim(),
            provider: meta.split('\\u00b7')[0].trim(),
            hasImage: Boolean(img && img.getAttribute('src')),
            playable: Boolean(c.querySelector('a[href*="product="]')),
          };
        });

    const games = section ? readCards(section) : [];
    const select = document.querySelector('select[aria-label="Filter by studio"]');
    return {
      games,
      cardCount: games.length,
      otherCardCount: readCards(document.body).length - games.length,
      providerSelectValue: select ? select.value : null,
      providerOptions: select
        ? Array.from(select.options).map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
        : [],
      bodyText: (document.body.innerText || '').slice(0, 4000),
    };
  };
})();
`;

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
      '--disable-web-security', // local origin -> production API (CORS allowlist)
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(out, 'chrome-profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const shutdown = () => {
    try { chrome.kill(); } catch { /* gone */ }
    try { server.kill(); } catch { /* gone */ }
  };

  try {
    // Wait for `next start`.
    let up = false;
    for (let i = 0; i < 180; i++) {
      try {
        const res = await fetch(origin + '/health');
        if (res.status > 0) { up = true; break; }
      } catch { /* not up yet */ }
      await delay(500);
    }
    assert.ok(up, 'the web production build never became reachable at ' + origin);

    // Wait for Chrome.
    let pages;
    for (let i = 0; i < 120; i++) {
      try {
        pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        if (pages && pages.length) break;
      } catch { /* not listening yet */ }
      await delay(100);
    }
    assert.ok(pages && pages.length, 'Chrome failed to start');

    const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const consoleErrors = [];

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
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

    const ev = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTALL_PROBE });

    /** Loads a route, waits for the catalog response, returns what happened. */
    const visit = async (route, waitMs = 6000) => {
      await send('Page.navigate', { url: origin + route });
      await delay(1200);
      // Poll until the catalog call carries its parsed body.
      for (let i = 0; i < 40; i++) {
        const ready = await ev(
          '!!(window.__catalogCalls && window.__catalogCalls[0] && window.__catalogCalls[0].body)',
        );
        if (ready) break;
        await delay(250);
      }
      await delay(waitMs);
      const calls = await ev('JSON.stringify(window.__catalogCalls)');
      const probe = await ev('JSON.stringify(window.__probe())');
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = path.join(out, `${route.replace(/[^\w]+/g, '_') || 'root'}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return { calls: JSON.parse(calls), probe: JSON.parse(probe), screenshot: file };
    };

    return await fn({ ev, visit, origin, consoleErrors, out });
  } finally {
    shutdown();
  }
}


/**
 * Prints the per-provider diagnostic table.
 *
 * The API reports providers as PartnerProvider ROWS (`providers[]`, e.g. the
 * configured BigBang integration) while each game carries the studio that
 * supplies it (`game.provider`, e.g. EGTDigital). Both identities are printed
 * so the layers line up.
 */
function reportTable(label, probe, apiProviders) {
  const rows = [];
  for (const p of apiProviders || []) {
    rows.push({ name: p.name, kind: 'provider row', api: p.gameCount });
  }
  const byStudio = {};
  for (const g of probe.games) byStudio[g.provider] = (byStudio[g.provider] || 0) + 1;
  for (const [name, count] of Object.entries(byStudio)) {
    rows.push({ name, kind: 'studio (cards)', api: 0, rendered: count });
  }

  console.log('\n  ' + label + ' — provider diagnostics');
  console.log('  ' + '-'.repeat(64));
  console.log('  ' + 'name'.padEnd(24) + 'kind'.padEnd(18) + 'API total'.padStart(11) + 'cards'.padStart(8));
  if (rows.length === 0) console.log('  (none)');
  for (const r of rows) {
    console.log(
      '  ' + String(r.name).slice(0, 23).padEnd(24) + r.kind.padEnd(18) +
      String(r.api ?? 0).padStart(11) + String(r.rendered ?? 0).padStart(8),
    );
  }
}

withBrowser(async ({ ev, visit, consoleErrors }) => {
  let failures = 0;
  const check = (cond, msg) => {
    if (cond) console.log('  \u2713 ' + msg);
    else { failures += 1; console.error('  \u2716 ' + msg); }
  };

  for (const route of ['/', '/games']) {
    console.log('\n' + '='.repeat(70));
    console.log('  REAL BROWSER: ' + origin_label(route));
    console.log('='.repeat(70));

    const { calls, probe, screenshot } = await visit(route);

    // --- request layer -------------------------------------------------
    const catalog = calls.find((c) => c.url.includes('/casino/catalog'));
    check(!!catalog, route + ': the browser issued a /casino/catalog request');
    if (!catalog) continue;

    console.log('  request : ' + catalog.method + ' ' + catalog.url);
    check(catalog.status === 200, route + ': catalog HTTP status = 200 (got ' + catalog.status + ')');
    check(
      !catalog.url.includes('/admin/'),
      route + ': the public page never calls an /admin/ endpoint',
    );
    check(
      new URL(catalog.url).searchParams.get('provider') === null,
      route + ': no provider filter is sent by default (= ALL active providers)',
    );
    check(
      catalog.url.includes('page=1'),
      route + ': pagination starts at page 1',
    );

    // --- response layer ------------------------------------------------
    const data = catalog.body && catalog.body.data ? catalog.body.data : null;
    check(!!data, route + ': the response uses the {success, data} envelope');
    if (!data) continue;

    const apiGames = data.games.items.length;
    const apiTotal = data.games.total;
    console.log('  API     : ' + apiGames + ' games on this page, total=' + apiTotal +
      ', providers=' + data.providers.length);

    check(data.available === true, route + ': the API reports games as available');
    check(data.configured === true, route + ': the provider integration is configured');
    check(apiGames > 0, route + ': the API returned at least one real provider game');

    // --- render layer --------------------------------------------------
    // Home shows a teaser row (limit 12); /games shows the whole page.
    const expected = route === '/' ? 12 : apiGames;
    console.log('  DOM     : ' + probe.cardCount + ' provider game cards rendered' +
      ' (+' + probe.otherCardCount + ' in-house Royale Play cards)');
    check(
      probe.cardCount > 0,
      route + ': provider game cards are rendered in the DOM',
    );
    check(
      probe.cardCount === expected,
      route + ': cards rendered (' + probe.cardCount + ') = expected provider games (' + expected + ')',
    );
    check(
      probe.cardCount > 0 && probe.games.every((g) => g.title.length > 0),
      route + ': every rendered card has a game name',
    );
    check(
      probe.cardCount > 0 && probe.games.every((g) => g.playable),
      route + ': every rendered card links into the real provider launch route',
    );
    check(
      probe.cardCount > 0 && probe.games.every((g) => g.provider.length > 0),
      route + ': every rendered card shows the provider that supplies it',
    );

    // Provider filter defaults to "all", never a single provider.
    check(
      probe.providerSelectValue === '',
      route + ': the provider filter defaults to "All providers" (value "")',
    );
    const allOpt = probe.providerOptions.find((o) => o.value === '');
    check(!!allOpt, route + ': an explicit "All providers" option exists');
    check(
      probe.providerOptions.length - 1 === data.providers.length,
      route + ': the filter lists every ACTIVE provider from the API (' +
        (probe.providerOptions.length - 1) + ')',
    );

    // The old placeholder catalog must be gone from these pages.
    check(
      !probe.bodyText.includes('Teal Fortune') && !probe.bodyText.includes('Provider One'),
      route + ': the hard-coded placeholder tiles are no longer rendered',
    );

    // Images: a broken remote thumbnail must never hide a card.
    const withImage = probe.games.filter((g) => g.hasImage).length;
    console.log('  images  : ' + withImage + '/' + probe.cardCount + ' cards carry a provider thumbnail');

    reportTable(route, probe, data.providers);
    console.log('  shot    : ' + screenshot);

    check(
      consoleErrors.filter((e) => !/favicon|ERR_/i.test(e)).length === 0,
      route + ': no uncaught page errors (errors: ' + consoleErrors.length + ')',
    );
  }

  // ------------------------------------------------------------------
  // Interactions on /games: provider filter, search and pagination.
  // ------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('  REAL BROWSER: /games interactions (filter / search / paging)');
  console.log('='.repeat(70));

  const reset = () => ev('JSON.stringify(window.__catalogCalls)').then(JSON.parse);
  void reset;

  const interactions = await visit('/games');
  const bigBangId = interactions.calls[0].body.data.providers[0].id;

  // --- provider filter ------------------------------------------------
  const beforeFilter = interactions.calls.length;
  await ev(`(() => {
    const s = document.querySelector('select[aria-label="Filter by studio"]');
    s.value = ${JSON.stringify(bigBangId)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(2500);
  const afterFilter = JSON.parse(await ev('JSON.stringify(window.__catalogCalls)'));
  const filteredCall = afterFilter[afterFilter.length - 1];
  const filteredProbe = JSON.parse(await ev('JSON.stringify(window.__probe())'));

  check(afterFilter.length > beforeFilter, '/games: changing the provider filter re-queries the API');
  check(
    new URL(filteredCall.url).searchParams.get('provider') === bigBangId,
    '/games: the selected provider is sent as ?provider=<row id>',
  );
  check(filteredCall.status === 200, '/games: the filtered request returns 200');
  check(
    filteredProbe.providerSelectValue === bigBangId,
    '/games: the filter keeps the selected provider',
  );
  check(
    filteredProbe.cardCount > 0,
    '/games: the provider-filtered view still renders games (' + filteredProbe.cardCount + ')',
  );
  check(
    filteredProbe.cardCount === filteredCall.body.data.games.items.length,
    '/games: filtered cards = filtered API games (' + filteredProbe.cardCount + ')',
  );

  // --- back to all providers ------------------------------------------
  await ev(`(() => {
    const s = document.querySelector('select[aria-label="Filter by studio"]');
    s.value = '';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(2500);
  const clearedCall = JSON.parse(await ev('JSON.stringify(window.__catalogCalls)')).pop();
  check(
    new URL(clearedCall.url).searchParams.get('provider') === null,
    '/games: clearing the filter returns to ALL providers (no provider param)',
  );
  const clearedProbe = JSON.parse(await ev('JSON.stringify(window.__probe())'));
  check(clearedProbe.cardCount > 0, '/games: the all-providers view renders games again');

  // --- search ----------------------------------------------------------
  // Target the CATALOG search box by its id (the header has its own search).
  await ev(`(() => {
    const i = document.getElementById('casino-catalog-search');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '10 Clover');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(2500);
  const searchCall = JSON.parse(await ev('JSON.stringify(window.__catalogCalls)')).pop();
  check(
    new URL(searchCall.url).searchParams.get('search') === '10 Clover',
    '/games: the typed search term is sent as ?search=',
  );
  const searchProbe = JSON.parse(await ev('JSON.stringify(window.__probe())'));
  check(
    searchProbe.cardCount > 0 &&
      searchProbe.games.every((g) => g.title.toLowerCase().includes('10 clover')),
    '/games: search results all match the term (' + searchProbe.cardCount + ' cards)',
  );

  // --- pagination ------------------------------------------------------
  await ev(`(() => {
    const i = document.getElementById('casino-catalog-search');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(2500);
  const page1 = JSON.parse(await ev('JSON.stringify(window.__probe())'));
  const callsBeforeMore = JSON.parse(await ev('JSON.stringify(window.__catalogCalls)')).length;

  const clicked = await ev(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => /load more games/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check(clicked, '/games: a "Load more games" control is offered while hasMore is true');
  await delay(3000);

  const afterMore = JSON.parse(await ev('JSON.stringify(window.__catalogCalls)'));
  const page2 = JSON.parse(await ev('JSON.stringify(window.__probe())'));
  check(
    afterMore.length > callsBeforeMore,
    '/games: loading more issues another request',
  );
  check(
    new URL(afterMore[afterMore.length - 1].url).searchParams.get('page') === '2',
    '/games: the next request asks for page=2 (never page=0)',
  );
  check(
    page2.cardCount > page1.cardCount,
    '/games: the next page is APPENDED (' + page1.cardCount + ' → ' + page2.cardCount + ' cards)',
  );
  check(
    new Set(page2.games.map((g) => g.title)).size >= page1.cardCount,
    '/games: appended cards do not replace the first page',
  );

  console.log('\n' + '='.repeat(70));
  if (failures > 0) {
    console.error('  ' + failures + ' browser verification check(s) FAILED.');
    process.exitCode = 1;
    return;
  }
  console.log('  ALL BROWSER VERIFICATION CHECKS PASSED');
  console.log('  Screenshots: ' + out);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

function origin_label(route) {
  return route === '/' ? 'HOME PAGE  /' : 'GAMES PAGE  ' + route;
}

