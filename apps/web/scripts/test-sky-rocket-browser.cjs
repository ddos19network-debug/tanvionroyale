'use strict';
/**
 * Sky Rocket (crash) scene — real-browser validation.
 *
 * Renders the REAL `CrashRocketScene` React component (transpiled from source)
 * against the REAL compiled Tailwind/CSS bundle in the installed Chrome, then
 * checks what unit tests cannot see: layout containment on every common
 * viewport, anchor↔plane alignment in real pixels, the pitch band, monotonic
 * flight, the plane-size clamp, and the crash lifecycle (the plane disappears
 * the instant the SERVER reports CRASHED, the explosion beat plays once, the
 * frozen aftermath never replays, a new round restores the plane).
 * Screenshots are written to the OS temp dir, never into the repository.
 *
 * Run: node scripts/test-sky-rocket-browser.cjs  (set CHROME_PATH to override)
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const web = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'tanvion-sky-rocket-browser');
fs.rmSync(out, { recursive: true, force: true, maxRetries: 3 });
fs.mkdirSync(out, { recursive: true });

const ts = require(path.join(web, 'node_modules/typescript'));
const code = ts.transpileModule(fs.readFileSync(path.join(web, 'components/games/crash-rocket.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  fileName: 'scene.tsx',
}).outputText;

const cssDir = path.join(web, '.next/static/css');
if (!fs.existsSync(cssDir)) {
  throw new Error(
    'Compiled CSS not found in apps/web/.next/static/css.\n'
    + 'Run a production build first:  pnpm --filter @tanvion-royale/web build',
  );
}
const css = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n')
  + fs.readFileSync(path.join(web, 'app/sky-rocket-phase2.css'), 'utf8');

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script src="/react.js"></script><script src="/dom.js"></script><script>window.exports={};window.process={env:{NODE_ENV:'development'}};window.require=()=>React;</script><script src="/scene.js"></script><script>
window.root=ReactDOM.createRoot(document.getElementById('root'));
window.props={displayMultiplier:1,crashMultiplier:null,roundId:'boot',phase:'BETTING',bettingCloseAtMs:null};
window.show=(patch,remount=false)=>{if(remount){root.unmount();root=ReactDOM.createRoot(document.getElementById('root'));}props={...props,...patch};ReactDOM.flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(exports.CrashRocketScene,props))));};
show({});
</script></body></html>`;

const files = {
  '/react.js': 'node_modules/react/umd/react.development.js',
  '/dom.js': 'node_modules/react-dom/umd/react-dom.development.js',
  '/sky-rocket-plane-trim.png': 'public/sky-rocket-plane-trim.png',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Content-Type', url.endsWith('.js') ? 'text/javascript' : url.endsWith('.css') ? 'text/css'
    : url.endsWith('.png') ? 'image/png' : url.endsWith('.jpg') ? 'image/jpeg' : 'text/html');
  res.end(url === '/scene.js' ? code : url === '/test.css' ? css
    : files[url] ? fs.readFileSync(path.join(web, files[url])) : html);
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
void (async () => {
  const pagePort = await freePort();
  const debugPort = await freePort();
  await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(out, 'chrome-profile')}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let pages;
    for (let i = 0; i < 100; i++) {
      try {
        pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        if (pages.length) break;
      } catch { /* Chrome not listening yet */ }
      await delay(100);
    }
    assert.ok(pages && pages.length, 'Chrome failed to start');
    ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

    let id = 0;
    const pending = new Map();
    const pageErrors = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      const entry = msg.id && pending.get(msg.id);
      if (entry) { pending.delete(msg.id); msg.error ? entry.j(msg.error) : entry.r(msg.result); }
    };
    const send = (method, params = {}) => new Promise((r, j) => {
      const n = ++id;
      pending.set(n, { r, j });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const ev = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const show = async (patch, remount = false) => {
      await ev(`show(${JSON.stringify(patch)},${remount})`);
      await delay(140);
    };
    const size = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await delay(90);
    };
    const shot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.data, 'base64'));
    };
    const probe = () => ev('__probe()');
    const ok = (cond, msg) => { assert.ok(cond, msg); console.log(`PASS: ${msg}`); };
    // Installed per page load: Page.navigate creates a fresh JS context.
    const installProbe = () => ev(`window.__probe = () => {
      const rect = (el) => { const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height,
          cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
      const count = (sel) => document.querySelectorAll(sel).length;
      const scene = document.querySelector('.sr-scene');
      const layer = document.querySelector('[data-flight-position]');
      const img = document.querySelector('.sr-plane');
      const move = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform) : null;
      const pitchNode = layer && layer.firstElementChild ? layer.firstElementChild.firstElementChild : null;
      const pitch = pitchNode ? new DOMMatrixReadOnly(getComputedStyle(pitchNode).transform) : null;
      return {
        scene: rect(scene),
        layerBox: layer ? { w: layer.offsetWidth, h: layer.offsetHeight } : null,
        img: img ? rect(img) : null,
        anchor: move ? { x: move.e, y: move.f } : null,
        pitch: pitch ? (Math.atan2(pitch.b, pitch.a) * 180) / Math.PI : null,
        natural: img ? { w: img.naturalWidth, h: img.naturalHeight, loaded: img.complete && img.naturalWidth > 0 } : null,
        layoutW: img ? img.offsetWidth : null,
        hud: (document.querySelector('.sr-scene .tabular-nums') || {}).textContent || null,
        counts: { plane: count('.sr-plane'), star: count('.sr-star'), sun: count('[data-sr-sun]'),
          cloud: count('.sr-cloud'), dust: count('.sr-dust'),
          trail: count('.sr-trail'), puff: count('.sr-puff'), spark: count('.sr-spark'), smoke: count('.sr-smoke'),
          debris: count('.sr-debris'), blob: count('.sr-fire-blob'), ring: count('.sr-ring'), ring2: count('.sr-ring-2'),
          ring3: count('.sr-ring-3'), flash: count('.sr-flash'), glow: count('.sr-aftermath-glow'),
          afterSmoke: count('[data-sr-aftermath-smoke]'), afterDebris: count('[data-sr-aftermath-debris]') },
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        aria: scene.getAttribute('aria-label'),
      };
    }`);

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${pagePort}/` });
    await delay(900);
    await installProbe();
    assert.equal((await probe()).counts.plane, 1, 'initial BETTING render must show the plane');

    // ---------------------------------------------------------------------
    // 1. Responsive geometry: every common viewport × every phase multiplier
    // ---------------------------------------------------------------------
    // Freeze CSS animations so positions/pitches are measured deterministically
    // (idle bob / engine vibration would otherwise nudge the plane's centre).
    await ev(`(() => {
      const style = document.createElement('style');
      style.id = '__freeze';
      style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
      document.head.appendChild(style);
    })()`);

    const VIEWPORTS = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [430, 932], [390, 844], [375, 667], [320, 568]];
    const MULTIPLIERS = [1, 1.2, 3, 10, 100];
    for (const [w, h] of VIEWPORTS) {
      await size(w, h);
      const failures = [];
      const check = (cond, reason) => { if (!cond) failures.push(`${reason}`); };
      let prevX = -Infinity;
      let prevY = Infinity;
      for (const [idx, m] of MULTIPLIERS.entries()) {
        await show({
          phase: m === 1 ? 'BETTING' : 'RUNNING', displayMultiplier: m, targetMultiplier: m + 0.1,
          crashMultiplier: null, roundId: 'geometry', bettingCloseAtMs: null,
        });
        const s = await probe();
        const detail = JSON.stringify({ m, scene: s.scene, img: s.img, anchor: s.anchor, pitch: s.pitch });
        check(s.natural && s.natural.loaded, `${m}x plane asset not decoded`);
        check(s.scene.h >= 360, `${m}x scene height ${Math.round(s.scene.h)}px < 360px`);
        check(s.overflowX <= 0, `${m}x horizontal overflow ${s.overflowX}px`);
        check(s.img && s.img.x >= s.scene.x - 1 && s.img.right <= s.scene.right + 1
          && s.img.y >= s.scene.y - 1 && s.img.bottom <= s.scene.bottom + 1, `${m}x plane outside scene ${detail}`);
        const aspect = s.img.h > 0 ? s.img.w / s.img.h : 0;
        check(aspect >= 1.7 && aspect <= 2.9, `${m}x rendered aspect ${aspect.toFixed(3)} implausible for the asset`);
        const expectedW = Math.min(260, Math.max(96, 0.18 * w));
        check(s.layoutW != null && Math.abs(s.layoutW - expectedW) <= 1,
          `${m}x plane width ${s.layoutW}px != clamp(96px,18vw,260px)=${expectedW.toFixed(1)}px`);
        check(Math.abs(s.scene.x + s.anchor.x - s.img.cx) <= 2.5 && Math.abs(s.scene.y + s.anchor.y - s.img.cy) <= 2.5,
          `${m}x anchor off plane centre: anchor ${s.anchor.x.toFixed(1)},${s.anchor.y.toFixed(1)} vs centre ${(s.img.cx - s.scene.x).toFixed(1)},${(s.img.cy - s.scene.y).toFixed(1)}`);
        // Horizontal travel must climb while the curve is unclamped; from 10× on
        // a very narrow board the containment guard pins the anchor at the safe
        // right edge (plateau), which is still contained and still passes below.
        // A 1px tolerance is allowed because that guard boundary tracks the REAL
        // rotated artwork extent, which grows slightly with the curve pitch — so
        // the pinned edge can shift left by a fraction of a pixel while the plane
        // is still visibly climbing and never pokes out of the scene.
        check(idx < 2 ? s.anchor.x > prevX + 0.5 : s.anchor.x >= prevX - 1.01,
          `${m}x left not climbing (${prevX.toFixed(1)} → ${s.anchor.x.toFixed(1)})`);
        check(s.anchor.y < prevY - 0.5, `${m}x top not descending (${prevY.toFixed(1)} → ${s.anchor.y.toFixed(1)})`);
        prevX = s.anchor.x;
        prevY = s.anchor.y;
        check(s.hud === `${m.toFixed(2)}×`, `${m}x HUD "${String(s.hud).trim()}" != "${m.toFixed(2)}×"`);
        if (m === 1) {
          check(Math.abs(s.pitch) < 0.01, `${m}x pitch ${s.pitch} must be level on the pad`);
          // The anchor is `translate3d(left%, top%, 0)` on an `inset-0` layer, so
          // percentages resolve against the LAYER box (scene minus its 1px border).
          check(Math.abs(s.anchor.x - 0.16 * s.layerBox.w) <= 1.5 && Math.abs(s.anchor.y - 0.8 * s.layerBox.h) <= 1.5,
            `${m}x anchor ${s.anchor.x.toFixed(1)},${s.anchor.y.toFixed(1)}px != pad 16%,80% of the ${s.layerBox.w}×${s.layerBox.h} scene`);
          // Reference day-sky layers: one sun glow, 12 clouds (6 far + 3 mid +
          // 3 near), 8 dust motes — and no night-sky star field any more.
          check(s.counts.sun === 1 && s.counts.cloud === 12 && s.counts.dust === 8, `${m}x sky layers ${JSON.stringify(s.counts)}`);
          check(s.counts.star === 0, `${m}x night-sky star layer must be gone`);
          check(s.counts.trail === 0 && s.counts.puff === 0, `${m}x thrust effects visible while betting`);
        } else {
          check(s.pitch < -5.5 && s.pitch > -14.5, `${m}x pitch ${s.pitch && s.pitch.toFixed(2)}° outside the 6–14° nose-up band`);
          check(s.counts.trail === 5 && s.counts.puff > 0, `${m}x exhaust trail missing ${JSON.stringify(s.counts)}`);
        }
        if (w === 1280 && m === 3) await shot('flight-1280x720-3x');
        if (w === 390 && m === 3) await shot('flight-390x844-3x');
      }
      ok(failures.length === 0,
        `${w}x${h} — ${MULTIPLIERS.length} multipliers: plane inside scene, anchor-centred, pitch band, monotonic climb, size clamp, HUD text${failures.length ? ` :: ${failures.join(' | ')}` : ''}`);
    }

    // ---------------------------------------------------------------------
    // 2. Crash lifecycle — LIVE crash (same mount, the round we watched fly)
    // ---------------------------------------------------------------------
    await ev(`document.getElementById('__freeze')?.remove()`);
    await size(390, 844);
    await show({ phase: 'BETTING', displayMultiplier: 1, crashMultiplier: null, roundId: 'live-1', bettingCloseAtMs: null }, true);
    await shot('betting-390x844');
    await show({ phase: 'RUNNING', displayMultiplier: 1.2, crashMultiplier: null, roundId: 'live-1' });
    await shot('flight-390x844-1.2x');
    const flying = await probe();
    ok(flying.counts.plane === 1 && flying.counts.trail === 5,
      'RUNNING at 1.20× renders one plane with its 5 exhaust puffs');

    await show({ phase: 'CRASHED', displayMultiplier: 1.35, crashMultiplier: 1.35, roundId: 'live-1' });
    const boom = await probe();
    ok(boom.counts.plane === 0, 'CRASHED removes the plane on the very first crashed render (no wreckage, no delay)');
    ok(boom.counts.flash === 1 && boom.counts.ring === 1 && boom.counts.ring2 === 2 && boom.counts.ring3 === 1,
      'crash plays the detonation flash + the 3-ring shockwave once');
    ok(boom.counts.spark === 18 && boom.counts.smoke === 8 && boom.counts.debris === 10 && boom.counts.blob === 6,
      `crash renders 18 fire particles, 8 smoke plumes, 10 debris bits, 6 fire fragments (got ${JSON.stringify(boom.counts)})`);
    ok(boom.counts.glow === 0, 'the frozen aftermath glow is NOT shown during the explosion beat');
    ok(String(boom.hud).trim() === '1.35×' && /crashed/i.test(boom.aria || ''),
      'CRASHED freezes the HUD at the server crash multiplier 1.35× and announces "crashed"');
    await shot('crash-390x844-1.35x');

    await delay(2900);
    const aftermath = await probe();
    ok(aftermath.counts.plane === 0 && aftermath.counts.flash === 0 && aftermath.counts.spark === 0 && aftermath.counts.smoke === 0,
      '~2.6s after impact the explosion layers are gone and NO plane is rendered');
    ok(aftermath.counts.glow === 3 && aftermath.counts.debris === 0 && aftermath.counts.afterDebris === 8
      && aftermath.counts.afterSmoke === 6,
      'the frozen aftermath keeps the smouldering glow, static plumes and 8 generic debris bits — and no animation layers');
    await shot('aftermath-390x844-1.35x');

    // Remount while the round is already crashed (refresh / reconnect / route change).
    await show({ phase: 'CRASHED', displayMultiplier: 1.35, crashMultiplier: 1.35, roundId: 'live-1' }, true);
    const reload = await probe();
    ok(reload.counts.plane === 0 && reload.counts.flash === 0 && reload.counts.glow === 3 && reload.counts.afterDebris === 8,
      'mounting into an already-crashed round shows the aftermath immediately — the explosion never replays');
    await size(1280, 720);
    await shot('aftermath-1280x720-1.35x');

    // A NEW round must restore the plane at the launch pad.
    await show({ phase: 'BETTING', displayMultiplier: 1, crashMultiplier: null, roundId: 'live-2', bettingCloseAtMs: null }, true);
    const nextRound = await probe();
    ok(nextRound.counts.plane === 1 && nextRound.counts.flash === 0
      && Math.abs(nextRound.anchor.x - 0.16 * nextRound.layerBox.w) <= 1.5
      && Math.abs(nextRound.anchor.y - 0.8 * nextRound.layerBox.h) <= 1.5,
      'a new round id restores the plane at the 16%/80% launch pad');

    // CASHED_OUT is still a flight (the player rode the plane out).
    await show({ phase: 'CASHED_OUT', displayMultiplier: 1.8, crashMultiplier: null, roundId: 'live-2' });
    const cashed = await probe();
    ok(cashed.counts.plane === 1 && cashed.anchor.x > nextRound.anchor.x,
      'CASHED_OUT keeps the plane flying at the served multiplier');

    // ---------------------------------------------------------------------
    // 3. prefers-reduced-motion — same guarantees, no animation dependency
    // ---------------------------------------------------------------------
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await show({ phase: 'RUNNING', displayMultiplier: 2, crashMultiplier: null, roundId: 'rm-1' }, true);
    const reducedFlight = await probe();
    ok(reducedFlight.counts.plane === 1 && reducedFlight.counts.trail === 5 && reducedFlight.pitch < -5.5,
      'reduced motion still flies: plane, trail and pitch are position-only (no animation required)');
    await show({ phase: 'CRASHED', displayMultiplier: 2, crashMultiplier: 2, roundId: 'rm-1' }, true);
    const reducedCrash = await probe();
    ok(reducedCrash.counts.plane === 0 && reducedCrash.counts.flash === 0 && reducedCrash.counts.glow > 0,
      'reduced motion into a crashed round: no plane, no explosion replay, aftermath only');
    await send('Emulation.setEmulatedMedia', { features: [] });

    ok(pageErrors.length === 0, `no page exceptions or console errors${pageErrors.length ? ` :: ${pageErrors.join(' | ')}` : ''}`);
    console.log(`\nSky Rocket browser checks passed — screenshots: ${out}`);
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

