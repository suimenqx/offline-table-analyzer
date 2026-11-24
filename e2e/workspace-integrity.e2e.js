import { test, expect } from '@playwright/test';

test('two offline windows saving from the same revision preserve one complete workspace and report the conflict', async ({page, context}) => {
  const url=new URL('../index.html',import.meta.url).href;
  await context.setOffline(true);
  await page.goto(url);
  const write = (tab, raw) => tab.evaluate(async text => {
    const {Store} = OTA.require('store');
    Store.transition('source:replace', {text});
    return await Store.transition('workspace:save');
  }, raw);
  expect(await write(page, 'initial source')).toBe(true);
  const head = tab=>tab.evaluate(()=>localStorage.getItem(OTA.require('store').STORE_KEY));
  const initial=await head(page);
  const other = await context.newPage();
  await other.goto(url);
  expect(await head(other)).toBe(initial);
  const sources = ['first window\n'.repeat(15000), 'second window\n'.repeat(15000)];
  const results = await Promise.all([write(page, sources[0]), write(other, sources[1])]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results.indexOf(true);
  const stale = [page, other][1 - winner];
  await expect(stale.locator('#storageStatus')).toContainText('其他窗口');
  expect(await stale.evaluate(()=>OTA.require('store').Store.curr().raw)).toBe(sources[1 - winner]);
  const reopen = await context.newPage();
  await reopen.goto(url);
  await expect.poll(()=>reopen.evaluate(()=>OTA.require('store').Store.restoring)).toBe(false);
  expect(await reopen.evaluate(()=>OTA.require('store').Store.curr().raw)).toBe(sources[winner]);
});

test('denied browser storage still allows editing and parsing in memory', async ({page}) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){
    throw new DOMException('Storage disabled','SecurityError');
  }}));
  await page.goto('/index.html');
  await page.locator('#rawInput').fill('id,name\n1,Alice');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea')).toContainText('Alice');
  await expect(page.locator('#storageStatus')).toContainText('Storage disabled');
  expect(errors).toEqual([]);
});
