import {test, expect} from '@playwright/test';
import {readSheet} from 'read-excel-file/node';
import fs from 'node:fs/promises';

const cards = page => page.locator('#cardList .data-card');
const source = name => JSON.stringify([{id:'1',name},{id:'2',name}]);
async function parse(page, text) {
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(page.locator('.data-card.active')).toHaveAttribute('data-parse-state','ready');
}

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('默认界面只显示卡片、原文和解析控件，成功摘要只出现一次', async ({page}) => {
  await expect(page.locator('#cardCount')).toHaveText('1');
  await expect(page.locator('#sampleBtn')).toBeVisible();
  await expect(page.locator('#sourcePreviewNotice')).toBeHidden();
  await expect(page.locator('#sidebar')).not.toContainText('参与分析');
  await parse(page, source('A'));
  await expect(cards(page).first().locator('.data-card-summary')).toContainText('2 行');
  await expect(cards(page).first().locator('.card-status-label')).toBeHidden();
  await expect(page.locator('#parseStatus')).toBeHidden();
  await expect(page.locator('#sampleBtn')).toBeHidden();
  await expect(page.locator('#sourceEditorLabel')).toHaveText('原文 · 数据段 1');
  await page.locator('#sourceTools summary').click();
  await expect(page.locator('#sourceDiagnosticsBtn')).toBeEnabled();
  await expect(page.locator('#sampleLink')).toBeVisible();
  await expect(page.locator('#exportSourceBtn')).toBeVisible();
});

test('眼睛按钮可通过键盘切换，隐藏弱化保留选中和焦点，结果范围随之变化', async ({page}) => {
  await parse(page, source('A'));
  await page.locator('#addCardBtn').click();
  await parse(page, source('B'));
  const card = cards(page).last(), eye = card.locator('.card-visibility');
  const normalColor = await card.locator('.data-card-title').evaluate(node => getComputedStyle(node).color);
  await eye.focus();
  await eye.press('Space');
  await expect(eye).toBeFocused();
  await expect(eye).toHaveAttribute('aria-pressed','false');
  await expect(eye.locator('.eye-slash')).toBeVisible();
  await expect(card).toHaveClass(/active.*excluded-card/);
  await expect(card.locator('.data-card-title')).not.toHaveCSS('color',normalColor);
  await expect(page.locator('#rawInput')).toHaveValue(source('B'));
  await expect(page.locator('#rawInput')).toBeEnabled();
  await expect(page.locator('#datasetSummary')).toContainText('显示 1/2 张卡片 · 1 表 · 2 行');
  await expect(page.locator('#previewArea tbody')).not.toContainText('B');
  await eye.press('Enter');
  await expect(eye).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#datasetSummary')).toContainText('显示 2/2 张卡片 · 1 表 · 4 行');
});

test('工具菜单支持键盘、Escape 和外部点击，详情关闭后焦点恢复到可见入口', async ({page}) => {
  await parse(page, source('A'));
  const trigger = page.locator('#sourceTools summary');
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.locator('#sourceTools')).toHaveAttribute('open','');
  await page.locator('#sourceDiagnosticsBtn').focus();
  await page.locator('#sourceDiagnosticsBtn').press('Enter');
  await expect(page.getByRole('dialog',{name:'解析详情'})).toBeVisible();
  await expect(page.locator('#sourceTools')).not.toHaveAttribute('open');
  await page.locator('#modalCloseBtn').click();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.locator('#exportSourceBtn').focus();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('#sourceTools')).not.toHaveAttribute('open');
  await trigger.click();
  // The disclosure overlays the editor's center; its left edge is a real
  // outside target, so pointer hit testing remains part of this check.
  await page.locator('#rawInput').click({position:{x:12,y:12}});
  await expect(page.locator('#sourceTools')).not.toHaveAttribute('open');
  await expect(page.locator('#rawInput')).toBeFocused();
});

test('原始 Excel 和备份入口属于工作区菜单，下载保留实际内容', async ({page}) => {
  await parse(page, source('A'));
  await page.locator('#workspaceTools summary').click();
  const workbook = page.waitForEvent('download');
  await page.locator('#exportRawBtn').click();
  const rows = await readSheet(await (await workbook).path(),'JSON Table 1');
  expect(rows).toEqual([['id','name'],[1,'A'],[2,'A']]);
  await expect(page.locator('#workspaceTools')).not.toHaveAttribute('open');
  await page.locator('#workspaceTools summary').click();
  const backup = page.waitForEvent('download');
  await page.locator('#exportTabBtn').click();
  const data = JSON.parse(await fs.readFile(await (await backup).path(),'utf8'));
  expect(data.docs[0].raw).toBe(source('A'));
  expect(data.projects).toHaveLength(1);
});

test('保存偏好作用于工作区，公式防护在复制设置中通过命令生效', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  await parse(page,'[{"id":"1","name":"=1+1"},{"id":"2","name":"Alice"}]');
  await page.locator('#workspaceTools summary').click();
  await page.locator('#persistRawToggle').uncheck();
  await expect(page.locator('#workspaceTools')).toHaveAttribute('open','');
  await expect(page.locator('#storageStatus')).toContainText('原文仅保留在当前页面');
  expect(await page.evaluate(() => OTA.require('store').Store.getState().persistRaw)).toBe(false);
  await page.locator('#copySettingsBtn').click();
  await expect(page.locator('#workspaceTools')).not.toHaveAttribute('open');
  await page.locator('label').filter({has:page.locator('#checkFormulaSafe')}).click();
  await expect(page.locator('#checkFormulaSafe')).not.toBeChecked();
  expect(await page.evaluate(() => OTA.require('store').Store.getState().spreadsheetSafe)).toBe(false);
  await page.locator('#copySettingsCloseBtn').click();
  await page.locator('#previewArea tbody td').first().click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('\t=1+1');
  await page.locator('#copySettingsBtn').click();
  await page.locator('label').filter({has:page.locator('#checkFormulaSafe')}).click();
  await expect(page.locator('#checkFormulaSafe')).toBeChecked();
  await page.locator('#copySettingsCloseBtn').click();
  await page.locator('#previewArea tbody td').first().click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("\t'=1+1");
});

test('规则面板用语精简，共用语法入口支持键盘并恢复焦点', async ({page}) => {
  await parse(page, source('A'));
  await page.locator('#sidebarConfigTabBtn').click();
  const rules = page.locator('[data-acc="rules"] .acc-head');
  await rules.focus(); await rules.press('Enter');
  await expect(rules).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#toggleHlRow')).toHaveText('高亮');
  await expect(page.locator('#toggleOnlyHlRow')).toHaveText('仅看高亮行');
  await page.locator('#ruleHelpBtn').click();
  await expect(page.getByRole('dialog',{name:'规则语法'})).toContainText('全局过滤作用于所有表');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ruleHelpBtn')).toBeFocused();
});
