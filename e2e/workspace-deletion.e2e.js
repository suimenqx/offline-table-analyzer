import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const tabs = page => page.locator('#tabsContainer .doc-tab');
const cards = page => page.locator('#cardList .data-card');
const shown = page => page.locator('.table-container .meta-tag').filter({ hasText:/^Show:/ }).first();
const source = name => JSON.stringify([{ id:'1', name }]);

async function parse(page, text) {
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#parseStatusText')).toContainText(/\d[\d,]* 行/);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#autoParseToggle').uncheck();
});

test('全部页签可删除：空状态刷新后保留，再新增从 Analysis 1 开始', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await parse(page, source('old'));
  await page.locator('#addTabBtn').click();
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).last().locator('.doc-tab-close').click();
  await expect(tabs(page)).toHaveCount(1);
  await tabs(page).first().locator('.doc-tab-close').click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#rawInput')).toHaveValue('');
  await expect(page.locator('#rawInput')).toBeDisabled();
  await expect(page.locator('#addTabBtn')).toBeFocused();
  await expect(page.locator('#previewArea')).toContainText('工作区为空');
  await page.keyboard.press('Control+s');
  await page.reload();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator('#previewArea')).toContainText('工作区为空');
  await page.locator('#addTabBtn').click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).locator('.doc-tab-title')).toHaveText('Analysis 1');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('#rawInput')).toBeEnabled();
  await expect(page.locator('#rawInput')).toHaveValue('');
  await expect(page.locator('.table-container')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('删除卡片释放其后台数据，最后一张也能删；刷新后可重新新增', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await parse(page, source('A'));
  await page.locator('#addCardBtn').click();
  await expect(cards(page)).toHaveCount(2);
  await parse(page, source('B'));
  await expect(shown(page)).toHaveText('Show: 2');
  await cards(page).first().click();
  await expect(page.locator('#rawInput')).toHaveValue(source('A'));
  await expect(shown(page)).toHaveText('Show: 2');
  const ids = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.cardId));
  await cards(page).last().locator('[data-card-act="remove"]').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(shown(page)).toHaveText('Show: 1');
  await expect.poll(() => page.evaluate(id => OTA.require('background-service').BackgroundService.hasDataset(id), ids[1])).toBe(false);
  expect(await page.evaluate(id => OTA.require('background-service').BackgroundService.hasDataset(id), ids[0])).toBe(true);
  await cards(page).first().locator('[data-card-act="remove"]').click();
  await expect(cards(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#rawInput')).toHaveValue('');
  await expect(page.locator('#rawInput')).toBeDisabled();
  await expect(page.locator('.table-container')).toHaveCount(0);
  await expect(page.locator('#poolCount')).toHaveText('表池 0 张卡片');
  await expect(page.locator('#addCardBtn')).toBeFocused();
  await page.reload();
  await expect(cards(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(1);
  await page.locator('#addCardBtn').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('#rawInput')).toHaveValue('');
  await expect(page.locator('#rawInput')).toBeEnabled();
  await parse(page, source('fresh'));
  await expect(shown(page)).toHaveText('Show: 1');
  expect(errors).toEqual([]);
});

test('无卡片工程与完全空工作区的备份均可恢复，不自动补建', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await cards(page).first().locator('[data-card-act="remove"]').click();
  await expect(cards(page)).toHaveCount(0);
  for (const projectCount of [1, 0]) {
    if (projectCount === 0) {
      await tabs(page).first().locator('.doc-tab-close').click();
      await expect(tabs(page)).toHaveCount(0);
    }
    const pending = page.waitForEvent('download');
    await page.locator('#exportTabBtn').click();
    const download = await pending;
    const buffer = await fs.readFile(await download.path());
    const payload = JSON.parse(buffer.toString());
    expect(payload.docs).toEqual([]);
    expect(payload.projects).toHaveLength(projectCount);
    await page.locator('#addTabBtn').click();
    await page.locator('#fileInputTab').setInputFiles({ name:'empty-workspace.json', mimeType:'application/json', buffer });
    await expect(tabs(page)).toHaveCount(projectCount);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('#rawInput')).toBeDisabled();
  }
  await page.locator('#addTabBtn').click();
  await expect(tabs(page).locator('.doc-tab-title')).toHaveText('Analysis 1');
  expect(errors).toEqual([]);
});
