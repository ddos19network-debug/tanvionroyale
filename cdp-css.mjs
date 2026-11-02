// Verify the royale-ace CSS layer + card art + animations loaded.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const url = process.argv[2];
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'cdpc-'));
const port = 9020 + Math.floor(Math.random() * 40);
let chrome, ws;
const cleanup=(c)=>{try{ws&&ws.close();}catch{}try{chrome&&chrome.kill();}catch{}try{rmSync(profile,{recursive:true,force:true});}catch{}process.exit(c);};
setTimeout(()=>cleanup(2),40000);
chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-dev-shm-usage','--mute-audio',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
async function wsUrl(){for(let i=0;i<80;i++){try{const j=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();if(j.webSocketDebuggerUrl)return j.webSocketDebuggerUrl;}catch{}await sleep(250);}throw new Error('no cdp');}
const pending=new Map(),errors=[];
const onMsg=(m)=>{if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);return;}if(m.method==='Runtime.exceptionThrown')errors.push((m.params.exceptionDetails.exception?.description||'exc').split('\n')[0]);};
async function main(){
  ws=new WebSocket(await wsUrl());
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  ws.addEventListener('message',(ev)=>onMsg(JSON.parse(ev.data)));
  const send=(method,params={},sessionId)=>new Promise((res)=>{const id=Math.floor(Math.random()*1e9);pending.set(id,res);const msg={id,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));});
  const t=await send('Target.createTarget',{url:'about:blank'});
  const att=await send('Target.attachToTarget',{targetId:t.result.targetId,flatten:true});
  const s=att.result.sessionId;
  await send('Runtime.enable',{},s);await send('Page.enable',{},s);
  await send('Page.navigate',{url},s);
  await sleep(12000);
  const r=await send('Runtime.evaluate',{expression:`(()=>{
    const hasRule=(sel)=>{try{return Array.from(document.styleSheets).some(ss=>{try{return Array.from(ss.cssRules).some(r=>r.cssText&&r.cssText.includes(sel));}catch{return false;}});}catch{return false;}};
    const sheetCount=document.styleSheets.length;
    const root=document.documentElement;
    const bodyBg=getComputedStyle(document.body).backgroundColor;
    const mainBg=document.querySelector('main')?getComputedStyle(document.querySelector('main')).backgroundColor:null;
    return JSON.stringify({sheetCount,aceStreakRule:hasRule('ace-reel-streak'),aceDropRule:hasRule('ace-drop-in'),aceBurstRule:hasRule('ace-burst'),aceGoldenRule:hasRule('ace-golden'),bodyBg,mainBg});
  })()`,returnByValue:true},s);
  console.log('CSS',r.result.result.value);
  console.log('EXCEPTIONS',errors.length);errors.slice(0,10).forEach(e=>console.log('  '+e));
  cleanup(0);
}
main().catch((e)=>{console.log('ERR',e.message);cleanup(1);});
