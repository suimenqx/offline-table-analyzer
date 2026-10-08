import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {test,expect,chromium} from '@playwright/test';
import {createLargeTableData} from '../tests/helpers/large-data.mjs';
import {readSheet} from 'read-excel-file/node';

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
