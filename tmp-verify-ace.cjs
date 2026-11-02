'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const http = require('http');
const WebSocket = require('ws');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(os.tmpdir(), 'tanvion-ace-verify');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [320,360,375,390,430,600,768,900,1024,1366,1440,1920];

(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--remote-debugging-port=9222','--no-sandbox','--disable-gpu','--user-data-dir='+path.join(os.tmpdir(),'ace-cdpprof')], { detached: true, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3000));
  const targets = await new Promise((resolve,reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)));
    }).on('error',reject);
  });
  const target = targets[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej) => { ws.on('open',res); ws.on('error',rej); });
  let id = 0;
  const send = (method, params={}) => new Promise((resolve) => {
    const mid = ++id;
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === mid) { ws.off('message', handler); resolve(msg.result); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name+'.png'), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const results = [];
  for (const w of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
    await send('Page.navigate', { url: 'http://127.0.0.1:3100/games/play/royale-ace' });
    await new Promise(r => setTimeout(r, 2500));
    const overflow = await evalJs('document.documentElement.scrollWidth > document.documentElement.clientWidth + 2');
    const hasBanner = await evalJs('!!document.querySelector("[data-testid=ace-banner]")');
    const hasGame = await evalJs('!!document.querySelector("[data-testid=ace-game]")');
    const hasHeader = await evalJs('!!document.querySelector("[data-testid=ace-header]")');
    const hasMults = await evalJs('!!document.querySelector("[data-testid=ace-multipliers]")');
    const multCount = await evalJs('document.querySelectorAll("[data-testid^=ace-multiplier-]").length');
    const hasBet = await evalJs('!!document.querySelector("[data-testid=ace-bet-value]")');
    const hasWin = await evalJs('!!document.querySelector("[data-testid=ace-win-value]")');
    const hasSettings = await evalJs('!!document.querySelector("[data-testid=ace-settings]")');
    const hasSpin = await evalJs('!!document.querySelector("[data-testid=ace-spin]")');
    const hasTurbo = await evalJs('!!document.querySelector("[data-testid=ace-turbo]")');
    const backRect = await evalJs('(() => { const e=document.querySelector("[data-testid=ace-header] button"); if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,width:r.width}; })()');
    const titleRect = await evalJs('(() => { const e=document.querySelector("[data-testid=ace-header] h1"); if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,width:r.width,center:r.left+r.width/2}; })()');
    const balRect = await evalJs('(() => { const e=document.querySelector("[data-testid=header-balance]"); if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width}; })()');
    const containerW = await evalJs('document.documentElement.clientWidth');
    const titleCenterOk = titleRect ? Math.abs(titleRect.center - containerW/2) < 60 : false;
    await shot('vp-'+w);
    const row = { w, overflow, hasBanner, hasGame, hasHeader, hasMults, multCount, hasBet, hasWin, hasSettings, hasSpin, hasTurbo, titleCenterOk };
    console.log(JSON.stringify(row));
    results.push(row);
  }
  // light theme check at 375
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:3100/games/play/royale-ace' });
  await new Promise(r => setTimeout(r, 2500));
  await evalJs('document.documentElement.classList.add("light")');
  await new Promise(r => setTimeout(r, 500));
  const lightOverflow = await evalJs('document.documentElement.scrollWidth > document.documentElement.clientWidth + 2');
  console.log('light-375-overflow:', lightOverflow);
  await shot('light-375');

  console.log('\nSUMMARY:');
  for (const r of results) console.log(r.w, 'overflow=' + r.overflow, 'banner=' + r.hasBanner, 'titleCentered=' + r.titleCenterOk, 'mults=' + r.multCount, 'controls=' + (r.hasSettings&&r.hasSpin&&r.hasTurbo));
  console.log('light overflow:', lightOverflow);
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
