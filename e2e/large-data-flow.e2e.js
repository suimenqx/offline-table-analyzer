import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {test,expect,chromium} from '@playwright/test';
import {createLargeTableData,createLargeCsv} from '../tests/helpers/large-data.mjs';
import {readSheet} from 'read-excel-file/node';

for(const rich of [false,true]) {
test(`native 100,000-row ${rich?'rich-text':'plain-text'} paste exports a complete Excel workbook without clicking parse`,async({page,context},testInfo)=>{
  test.setTimeout(90000);
  const fixture=createLargeTableData({rows:100000,variant:'unicode-crlf'});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  await page.goto('/index.html');
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(async({text,rich})=>{
    if(rich)await navigator.clipboard.write([new ClipboardItem({
      'text/plain':new Blob([text],{type:'text/plain'}),
      'text/html':new Blob(['<pre>copied CLI output</pre>'],{type:'text/html'})
    })]);
    else await navigator.clipboard.writeText(text);
  },{text:fixture.text,rich});
  await page.locator('#rawInput').click();await page.locator('#rawInput').press('Control+V');
  await expect(page.locator('#parseStatusText')).toContainText('全量 Excel');
  expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.getRaw().length)).toBe(0);
  const downloading=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  await expect(page.locator('#backgroundJob')).toBeVisible();
  // The page can handle another control while the background parse/export runs.
  await page.locator('#copySettingsBtn').click();await expect(page.locator('#copySettingsPopover')).toBeVisible();
  await page.locator('#copySettingsCloseBtn').click();
  const download=await downloading;const workbook=testInfo.outputPath('full-from-paste.xlsx');await download.saveAs(workbook);
  const rows=await readSheet(workbook,'Wide');
  expect(rows).toHaveLength(fixture.rows+1);expect(rows[0]).toEqual(fixture.headers);
  expect(rows[1]).toHaveLength(fixture.columns);expect(rows[1][1]).toBe(1);expect(rows[1][3]).toBe('值4');
  expect(rows[100000]).toHaveLength(fixture.columns);expect(rows[100000][1]).toBe(100000);expect(rows[100000][31]).toBe('值1');
  const lookup=await readSheet(workbook,'Lookup');expect(lookup).toHaveLength(fixture.lookupRows+1);
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
  expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.isBackground())).toBe(true);
  expect(await page.locator('#rawInput').evaluate(el=>el.value.length)).toBeLessThanOrEqual(10000);
  expect(errors).toEqual([]);
});
}

test('100,000-row CSV detection, Worker paging, off-page undo, copy, filtering and Excel readback',async({page,context},testInfo)=>{
  test.setTimeout(120000);
  const fixture=createLargeCsv();const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  await page.goto('/index.html');
  await page.evaluate(async text=>navigator.clipboard.writeText(text),fixture.text);
  await page.locator('#rawInput').click();await page.locator('#rawInput').press('Control+V');await page.locator('#parseBtn').click();
  const card=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})});
  await expect(card.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 100000',{timeout:30000});
  expect(await page.evaluate(()=>{
    const registry=OTA.require('table-registry').TableRegistry;
    return {format:registry.getFormat(),rows:registry.getRaw()[0].rows.length,total:registry.getRaw()[0].rowCount};
  })).toEqual({format:'csv',rows:0,total:100000});
  await card.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(card.locator('tbody tr').first().locator('td').first()).toHaveText('000101');
  const cell=card.locator('tbody tr').first().locator('td').nth(31);
  await cell.dblclick();await cell.locator('textarea').fill('changed\nsecond line');await cell.locator('textarea').press('Enter');
  await expect(card.locator('tbody tr').first().locator('td').nth(31)).toHaveText('changed\nsecond line');
  await card.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(card.locator('tbody tr').first().locator('td').first()).toHaveText('000201');
  await page.keyboard.press('Control+Z');
  await expect.poll(()=>page.evaluate(()=>OTA.require('store').Store.getDocument().ui.cellEdits['$CSV Table 1']?.['100']?.['31'])).toBe(fixture.note);
  await card.getByRole('button',{name:'上一页',exact:true}).click();
  await expect(card.locator('tbody tr').first().locator('td').nth(31)).toHaveText(fixture.note);
  await page.keyboard.press('Control+Y');
  await expect(card.locator('tbody tr').first().locator('td').nth(31)).toHaveText('changed\nsecond line');
  await card.locator('tbody tr').first().locator('td').first().click();await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());expect(copied).toContain('000101');expect(copied).toContain('changed');
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportFullBtn').click();
  const workbook=testInfo.outputPath('complete-csv.xlsx');await (await downloadPromise).saveAs(workbook);
  const rows=await readSheet(workbook,'CSV Table 1');
  expect(rows).toHaveLength(100001);expect(rows[0]).toEqual(fixture.headers);expect(rows[1][0]).toBe('000001');
  expect(rows[101][31]).toBe('changed\nsecond line');expect(rows[100000][0]).toBe(100000);expect(rows[100000][31]).toBe(fixture.note);
  await page.locator('#sidebarConfigTabBtn').click();await page.locator('.acc-item[data-acc="rules"] .acc-head').click();
  await page.locator('#globalFilter').fill('ID<=125');
  await expect(card.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 125');
  const filteredPromise=page.waitForEvent('download');await page.locator('#exportPrevBtn').click();
  const filteredFile=testInfo.outputPath('filtered-csv.xlsx');await (await filteredPromise).saveAs(filteredFile);
  const filtered=await readSheet(filteredFile,'CSV Table 1');expect(filtered).toHaveLength(126);expect(filtered[101][31]).toBe('changed\nsecond line');
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
  expect(errors).toEqual([]);
});

test('offline workspace retains BOM and lone surrogates across a browser restart',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ota-source-units-'));
  const filename=path.join(directory,'index.html');await fs.copyFile('index.html',filename);
  const profile=path.join(directory,'profile');
  const raw='\uFEFFtable-data Original\r\nvalidflag ID Value\r\n1 001 \uD800X\uDC00\r\n'+'1 002 kept\r\n'.repeat(15000);
  let context;
  const open=async()=>{
    context=await chromium.launchPersistentContext(profile,{headless:true});await context.setOffline(true);
    const page=context.pages()[0];await page.goto(pathToFileURL(filename).href);return page;
  };
  try {
    let page=await open();
    expect(await page.evaluate(async text=>{
      const {Store}=OTA.require('store');Store.transition('ui:autoParse',{enabled:false});
      Store.transition('source:replace',{text});
      const saved=await Store.save();await Store.cleanupPromise;return saved;
    },raw)).toBe(true);
    await context.close();context=null;
    page=await open();
    await expect.poll(()=>page.evaluate(()=>OTA.require('store').Store.restoring)).toBe(false);
    expect(await page.evaluate(()=>OTA.require('store').Store.loadFailed)).toBe(false);
    expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(raw);
  } finally {if(context)await context.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('cancelling direct export retains the large source and a replacement can be exported',async({page,context},testInfo)=>{
  const fixture=createLargeTableData();
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  await page.goto('/index.html');
  const downloads=[];page.on('download',download=>downloads.push(download));
  await page.evaluate(async text=>navigator.clipboard.writeText(text),fixture.text);
  await page.locator('#rawInput').click();await page.locator('#rawInput').press('Control+V');
  await page.locator('#exportFullBtn').click();await expect(page.locator('#backgroundJob')).toBeVisible();
  await page.locator('#cancelJobBtn').click();await expect(page.locator('#backgroundJob')).toBeHidden();
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
  expect(downloads).toHaveLength(0);
  const replacement='table-data Replacement\nvalidflag ID\n1 009';
  await page.evaluate(async text=>navigator.clipboard.writeText(text),replacement);
  await page.locator('#rawInput').click();await page.locator('#rawInput').press('Control+V');
  const downloading=page.waitForEvent('download');await page.locator('#exportFullBtn').click();
  const download=await downloading;const workbook=testInfo.outputPath('replacement.xlsx');await download.saveAs(workbook);
  expect(await readSheet(workbook,'Replacement')).toEqual([['validflag','ID'],[1,'009']]);
  await page.waitForTimeout(600);expect(downloads).toHaveLength(1);
});

test('offline release preserves large original, corrections, export and browser restart recovery',async({},testInfo)=>{
  test.setTimeout(90000);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ota-large-release-'));
  const filename=path.join(directory,'index.html');await fs.copyFile('index.html',filename);
  const profile=path.join(directory,'profile');const fixture=createLargeTableData({rows:100000,variant:'unicode-crlf'});
  const inputFile=path.join(directory,'wide.txt');await fs.writeFile(inputFile,fixture.text);
  let context;
  const open=async()=>{
    context=await chromium.launchPersistentContext(profile,{headless:true});await context.setOffline(true);
    const page=context.pages()[0];await page.goto(pathToFileURL(filename).href);return page;
  };
  const wide=page=>page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^Wide$/})});
  const waitRows=(page,count)=>expect(wide(page).locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText(`Show: ${count}`,{timeout:30000});
  try {
    let page=await open();
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.locator('#sourceFileInput').setInputFiles(inputFile);
    await waitRows(page,fixture.rows);
    expect(await page.locator('#rawInput').evaluate(el=>({readonly:el.readOnly,length:el.value.length}))).toMatchObject({readonly:true});
    expect(await page.locator('#rawInput').evaluate(el=>el.value.length)).toBeLessThanOrEqual(10000);
    expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
    const cell=wide(page).locator('tbody tr').first().locator('td').nth(3);
    await cell.dblclick();await cell.locator('textarea').fill('修正值');await cell.locator('textarea').press('Enter');
    await expect(wide(page).locator('tbody tr').first().locator('td').nth(3)).toHaveText('修正值');
    await expect.poll(()=>page.evaluate(()=>{const {Store,STORE_KEY}=OTA.require('store');const json=JSON.parse(localStorage.getItem(STORE_KEY));const saved=json.docs.find(doc=>doc.id===Store.getDocument().id);return {saving:Store.saving,rawReference:!!json.rawExternal,edits:saved.ui.cellEdits,currentEdits:Store.getDocument().ui.cellEdits,error:Store.lastSaveError};}),{timeout:10000}).toMatchObject({saving:false,rawReference:true,edits:{$Wide:{0:{3:'修正值'}}}});
    const pending=page.waitForEvent('download');await page.locator('#exportSourceBtn').click();const source=await pending;
    const sourcePath=testInfo.outputPath('original.txt');await source.saveAs(sourcePath);expect(await fs.readFile(sourcePath,'utf8')).toBe(fixture.text);
    await context.close();context=null;
    page=await open();await waitRows(page,fixture.rows);expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
    await expect(wide(page).locator('tbody tr').first().locator('td').nth(3)).toHaveText('修正值');
    await page.locator('#sidebarConfigTabBtn').click();await page.locator('.acc-item[data-acc="rules"] .acc-head').click();await page.locator('#globalFilter').fill('ID<=100');await waitRows(page,100);
    const downloading=page.waitForEvent('download');await page.locator('#exportPrevBtn').click();const download=await downloading;const workbook=testInfo.outputPath('corrected.xlsx');await download.saveAs(workbook);
    const rows=await readSheet(workbook,'Wide');expect(rows).toHaveLength(101);expect(rows[1][3]).toBe('修正值');expect(rows[100][1]).toBe(100);
    await page.locator('#sidebarDataTabBtn').click();await page.locator('#persistRawToggle').uncheck();
    expect(await page.evaluate(()=>OTA.require('store').Store.getState().persistRaw)).toBe(false);
    await expect.poll(()=>page.evaluate(()=>OTA.require('store').Store.cleaning),{timeout:30000}).toBe(false);
    await context.close();context=null;page=await open();
    await expect(page.locator('#rawInput')).toHaveValue('');expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe('');
    expect(errors).toEqual([]);
  } finally {if(context)await context.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('large parse cancellation and replacing its source cannot publish stale results',async({page})=>{
  const fixture=createLargeTableData();await page.goto('/index.html');
  await page.locator('#sourceFileInput').setInputFiles({name:'wide.txt',mimeType:'text/plain',buffer:Buffer.from(fixture.text)});
  await expect(page.locator('#backgroundJob')).toBeVisible();await page.locator('#cancelJobBtn').click();
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toBe(fixture.text);
  await page.locator('#parseBtn').click();
  await page.locator('#sourceFileInput').setInputFiles({name:'small.txt',mimeType:'text/plain',buffer:Buffer.from('table-data Replacement\nvalidflag ID\n1 009')});
  await expect(page.locator('.table-title')).toHaveText('Replacement');
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.getRaw().map(table=>({name:table.name,rows:table.rows})))).toEqual([{name:'Replacement',rows:[['1','009']]}]);
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw)).toContain('Replacement');
});
