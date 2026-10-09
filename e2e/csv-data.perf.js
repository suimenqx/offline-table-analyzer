import fs from 'node:fs/promises';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {test,expect} from '@playwright/test';
import {readSheet} from 'read-excel-file/node';
import {createLargeCsv} from '../tests/helpers/large-data.mjs';
import {installLargeDataProbe} from './helpers/large-data-probe.mjs';

for(const multiline of [false,true])test(`100k x 32 CSV ${multiline?'multiline quotes':'mixed punctuation'}`,async({page,context,browser},testInfo)=>{
  const fixture=createLargeCsv({multiline});
  const report={schemaVersion:1,case:{variant:multiline?'csv-multiline':'csv',rows:fixture.rows,columns:fixture.columns,method:'clipboard',run:1,textCharacters:fixture.text.length,utf8Bytes:Buffer.byteLength(fixture.text),estimatedTextBytes:fixture.text.length*2},
    environment:{commit:process.env.GITHUB_SHA,browserVersion:browser.version(),platform:process.platform,architecture:process.arch,nodeVersion:process.version,logicalCpus:os.cpus().length,hostMemoryBytes:os.totalmem()},status:'running',phases:[]};
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(new URL(request.url()).origin!=='http://127.0.0.1:4173')requests.push(request.url());});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(item=>['JSHeapUsedSize','JSHeapTotalSize','Nodes'].includes(item.name)).map(item=>[item.name,item.value]));
  const phase=async(name,action)=>{
    await page.waitForTimeout(400);const before=await metrics();await page.evaluate(name=>window.__otaLargeDataProbe.start(name),name);
    const started=performance.now();let failed=true,actionWallMs;
    try {await action();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));actionWallMs=performance.now()-started;failed=false;}
    finally {await page.waitForTimeout(400);report.phases.push({name,failed,actionWallMs:actionWallMs ?? performance.now()-started,before,after:await metrics(),...await page.evaluate(()=>window.__otaLargeDataProbe.stop())});}
  };
  try {
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
    await page.goto('/index.html');await page.locator('#autoParseToggle').uncheck();await page.evaluate(installLargeDataProbe);
    await page.evaluate(async text=>navigator.clipboard.writeText(text),fixture.text);await page.locator('#rawInput').click();
    await phase('paste',()=>page.locator('#rawInput').press('Control+V'));
    const card=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})});
    await phase('parse-and-preview',async()=>{await page.locator('#parseBtn').click();await expect(card.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 100000');});
    expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.getRaw()[0].rows.length)).toBe(0);
    expect(await card.locator('tbody tr').count()).toBe(100);
    for(const number of [2,3])await phase(`page-${number}`,async()=>{
      await card.getByRole('button',{name:'下一页',exact:true}).click();
      await expect(card.locator('tbody tr').first().locator('td').first()).toHaveText(String((number-1)*100+1).padStart(6,'0'));
    });
    let workbook;
    await phase('full-xlsx-export',async()=>{const pending=page.waitForEvent('download');await page.locator('#exportFullBtn').click();workbook=testInfo.outputPath('complete.xlsx');await (await pending).saveAs(workbook);});
    const rows=await readSheet(workbook,'CSV Table 1');expect(rows).toHaveLength(100001);expect(rows[0]).toEqual(fixture.headers);
    expect(rows[1][0]).toBe('000001');expect(rows[100000][0]).toBe(100000);expect(rows[100000][31]).toBe(fixture.note);
    await fs.unlink(workbook);
    for(const item of report.phases){expect(item.longestTaskMs,`${item.name}: main thread`).toBeLessThan(500);expect(item.maxTimerDelayMs,`${item.name}: heartbeat`).toBeLessThan(500);}
    expect(errors).toEqual([]);expect(requests).toEqual([]);report.status='passed';
  } finally {
    await cdp.detach();if(report.status!=='passed')report.status='failed';
    await fs.mkdir(testInfo.outputDir,{recursive:true});await fs.writeFile(testInfo.outputPath('baseline.json'),JSON.stringify(report,null,2));
  }
});
