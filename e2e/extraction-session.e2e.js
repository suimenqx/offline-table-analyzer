import {test,expect} from '@playwright/test';
import readExcelFile from 'read-excel-file/node';

const source='[{"id":"001","name":"Alice"},{"id":"002","name":"Bob"}]';
const card=page=>page.locator('.data-card.active');

test.beforeEach(async({page})=>{
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.evaluate(()=>{
    const {BackgroundService}=OTA.require('background-service');
    const parse=BackgroundService.parse.bind(BackgroundService);
    // Hold only completion delivery; the real embedded Worker still parses the source.
    window.extractionProbe={calls:0,release:[],diagnostics:null};
    BackgroundService.THRESHOLD=1;
    BackgroundService.parse=async payload=>{
      window.extractionProbe.calls++;
      const result=await parse(payload);
      await new Promise(resolve=>window.extractionProbe.release.push(resolve));
      return result;
    };
  });
  await page.locator('#rawInput').fill(source);
});

const requestDiagnostics=page=>page.evaluate(()=>{
  const {Store}=OTA.require('store');
  OTA.require('app').App.showCardDiagnostics(Store.curr().id).then(opened=>{window.extractionProbe.diagnostics=opened;});
});
const release=page=>page.evaluate(()=>window.extractionProbe.release.shift()());
const readyToRelease=(page,count=1)=>expect.poll(()=>page.evaluate(()=>window.extractionProbe.release.length)).toBe(count);

test('export and diagnostics share one real Worker extraction and retain complete workbook records',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.locator('#parseBtn').click();
  await expect(card(page)).toHaveAttribute('data-parse-state','parsing');
  await readyToRelease(page);
  const downloading=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  await requestDiagnostics(page);
  expect(await page.evaluate(()=>window.extractionProbe.calls)).toBe(1);
  await release(page);
  const download=await downloading;
  expect(await readExcelFile(await download.path())).toEqual([
    {sheet:'JSON Table 1',data:[['id','name'],['001','Alice'],['002','Bob']]},
  ]);
  await expect(page.getByRole('dialog',{name:'解析详情'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.extractionProbe.diagnostics)).toBe(true);
  await expect(card(page)).toHaveAttribute('aria-busy','false');
  expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.getRaw()[0].rows.length)).toBe(0);
  await expect(page.locator('#rawInput')).toHaveValue(source);
  expect(errors).toEqual([]);
});

test('cancel releases waiting consumers and a late completion cannot clear the retry busy state',async({page})=>{
  const downloads=[],errors=[];
  page.on('download',download=>downloads.push(download));page.on('pageerror',error=>errors.push(String(error)));
  await page.locator('#exportFullBtn').click();
  await readyToRelease(page);
  await requestDiagnostics(page);
  await page.locator('#cancelJobBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.extractionProbe.diagnostics)).toBe(false);
  await expect(card(page)).toHaveAttribute('data-parse-state','pending');
  await expect(card(page)).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#backgroundJob')).toBeHidden();
  await expect(page.getByRole('dialog',{name:'解析详情'})).toBeHidden();
  expect(downloads).toHaveLength(0);
  await page.locator('#parseBtn').click();
  await readyToRelease(page,2);
  await release(page);
  await expect(card(page)).toHaveAttribute('data-parse-state','parsing');
  await expect(page.locator('#previewArea')).toHaveAttribute('aria-busy','true');
  await release(page);
  await expect(card(page)).toHaveAttribute('data-parse-state','ready');
  await expect(card(page)).toHaveAttribute('aria-busy','false');
  const downloading=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  const download=await downloading;
  expect((await readExcelFile(await download.path()))[0].data).toEqual([['id','name'],['001','Alice'],['002','Bob']]);
  expect(await page.evaluate(()=>window.extractionProbe.calls)).toBe(2);
  await expect(page.locator('#rawInput')).toHaveValue(source);
  expect(errors).toEqual([]);
});
