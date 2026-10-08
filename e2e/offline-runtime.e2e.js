import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { test, expect, chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { MODULES } = require('../tools/build-release.cjs');
const pureFiles = MODULES.map(([file]) => file).filter(file =>
  file === 'core/module-loader.js' || file === 'core/runtime.js' || file === 'core/table-utils.js' ||
  file === 'core/filter-engine.js' || file.startsWith('parsing/') || file === 'transform/joiner.js' || file === 'core/query-service.js');

async function probeHtml() {
  const bundle = (await Promise.all(pureFiles.map(file => fs.readFile(path.join('src', file), 'utf8')))).join('\n');
  const worker = `${bundle}\nself.onmessage=e=>{const {kind,value}=e.data;if(kind==='busy'){while(true){}}else if(kind==='buffer'){self.postMessage({length:value.byteLength},[value]);}else if(kind==='parse'){const r=OTA.require('import-engine').ImportEngine.parse(value,{});self.postMessage({format:r.format,rows:r.tables[0].rows,domParser:typeof DOMParser});}};self.postMessage({ready:1});`;
  return `<!doctype html><meta charset="utf-8"><title>isolated offline probe</title><script>
  window.workerSource=${JSON.stringify(worker).replaceAll('<', '\\u003c')};
  window.openProbeDb=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ota-isolated-mechanism-probe',1);r.onupgradeneeded=()=>r.result.createObjectStore('raw');r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});
  window.writeRaw=async()=>{const db=await openProbeDb();const value='离线 source\\r\\n'.repeat(2000000)+'END';await new Promise((resolve,reject)=>{const tx=db.transaction('raw','readwrite');tx.objectStore('raw').put(value,'sample');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};});db.close();return {length:value.length,end:value.slice(-3)};};
  window.readRaw=async()=>{const db=await openProbeDb();const value=await new Promise((resolve,reject)=>{const r=db.transaction('raw').objectStore('raw').get('sample');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return value?{length:value.length,end:value.slice(-3)}:null;};
  window.opfsProbe=async()=>{try{const root=await navigator.storage.getDirectory();const h=await root.getFileHandle('isolated-probe',{create:true});const w=await h.createWritable();await w.write('offline');await w.close();const value=await (await h.getFile()).text();await root.removeEntry('isolated-probe');return {ok:value==='offline'};}catch(e){return {ok:false,error:e.name,message:e.message};}};
  <\/script>`;
}

test('file:// offline Worker and persistent large raw storage', async ({ browser }, testInfo) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ota-offline-probe-'));
  const filename = path.join(directory, 'index.html');
  const profile = path.join(directory, 'profile');
  const html = await probeHtml();
  await fs.writeFile(filename, html);
  let context;
  const report = { browser: browser.version(), commit: process.env.GITHUB_SHA, origin: 'file://', networkRequests: [] };
  const open = async file => {
    context = await chromium.launchPersistentContext(profile, { headless: true });
    await context.setOffline(true);
    const page = context.pages()[0];
    page.on('request', request => { if (/^https?:/.test(request.url())) report.networkRequests.push(request.url()); });
    await page.goto(pathToFileURL(file).href);
    return page;
  };
  try {
    let page = await open(filename);
    report.worker = await page.evaluate(async () => {
      const create = () => {
        const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
        const worker=new Worker(url);URL.revokeObjectURL(url);return worker;
      };
      const receive = worker => new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));});
      let worker=create();const ready=await receive(worker);
      const parsed=receive(worker);worker.postMessage({kind:'parse',value:'table-data T\nvalidflag ID\n1 001\n1 002'});const result=await parsed;
      const buffer=new ArrayBuffer(1024);const received=receive(worker);worker.postMessage({kind:'buffer',value:buffer},[buffer]);const detached=buffer.byteLength;const transfer=await received;
      worker.postMessage({kind:'busy'});worker.terminate();worker=create();const rebuilt=await receive(worker);worker.terminate();
      return {ready,result,detached,transfer,rebuilt};
    });
    expect(report.worker.ready).toEqual({ready:1});
    expect(report.worker.result.rows).toEqual([['1','001'],['1','002']]);
    expect(report.worker.result.domParser).toBe('undefined');
    expect(report.worker.detached).toBe(0);
    expect(report.worker.transfer.length).toBe(1024);
    expect(report.worker.rebuilt).toEqual({ready:1});
    report.secureContext=await page.evaluate(()=>isSecureContext);
    report.saved=await page.evaluate(()=>writeRaw());
    report.opfs=await page.evaluate(()=>opfsProbe());
    await context.close();context=null;
    page=await open(filename);
    report.reopened=await page.evaluate(()=>readRaw());
    expect(report.reopened).toEqual(report.saved);
    await context.close();context=null;
    await fs.writeFile(filename,html.replace('isolated offline probe','replacement offline probe'));
    page=await open(filename);
    report.replaced=await page.evaluate(()=>readRaw());
    expect(report.replaced).toEqual(report.saved);
    await context.close();context=null;
    const renamed=path.join(directory,'renamed.html');await fs.rename(filename,renamed);
    page=await open(renamed);report.renamed=await page.evaluate(()=>readRaw());
    await context.close();context=null;
    const moved=path.join(directory,'moved');await fs.mkdir(moved);await fs.rename(renamed,path.join(moved,'index.html'));
    page=await open(path.join(moved,'index.html'));report.moved=await page.evaluate(()=>readRaw());
    expect(report.networkRequests).toEqual([]);
  } finally {
    if(context) await context.close();
    await testInfo.attach('offline-mechanisms',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    await fs.rm(directory,{recursive:true,force:true});
  }
});

test('file:// private contexts do not promise recovery after closing', async ({ browser },testInfo) => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ota-private-probe-'));
  const filename=path.join(directory,'index.html');await fs.writeFile(filename,await probeHtml());
  let context=await browser.newContext();
  const report={browser:browser.version(),commit:process.env.GITHUB_SHA,private:true};
  try {
    await context.setOffline(true);let page=await context.newPage();await page.goto(pathToFileURL(filename).href);
    report.saved=await page.evaluate(()=>writeRaw());expect(await page.evaluate(()=>readRaw())).toEqual(report.saved);
    await context.close();context=await browser.newContext();await context.setOffline(true);page=await context.newPage();await page.goto(pathToFileURL(filename).href);
    report.reopened=await page.evaluate(()=>readRaw());expect(report.reopened).toBeNull();
  } finally {
    await context.close();await testInfo.attach('offline-private-mechanisms',{body:JSON.stringify(report,null,2),contentType:'application/json'});
    await fs.rm(directory,{recursive:true,force:true});
  }
});
