import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import readExcelFile from 'read-excel-file/node';

test('paste, parse, filter, join, copy, and export the offline release', async ({ page, context }, testInfo) => {
  const unexpectedRequests = [];
  const allowedOrigin = 'http://127.0.0.1:4173';
  page.on('request', request => {
    if (new URL(request.url()).origin !== allowedOrigin) unexpectedRequests.push(request.url());
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: allowedOrigin });
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/Offline Table Analyzer/);
  await page.locator('#autoParseToggle').uncheck();

  const source = [
    'table-data Products',
    'validflag ID     Product',
    '1        101    Widget_A',
    '1        102    Widget_B',
    '',
    'table-data Orders',
    'validflag OrderID ProdID Qty Status',
    '1        5001    101    2   shipped',
    '1        5002    102    1   pending',
  ].join('\n');

  await page.evaluate(async value => navigator.clipboard.writeText(value), source);
  await page.locator('#rawInput').click();
  await page.locator('#rawInput').press('Control+V');
  await expect(page.locator('#rawInput')).toHaveValue(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');

  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  await page.locator('#jeAddNew').click();
  await page.locator('#jeName').fill('OrderProducts');
  await page.locator('#jeLeftTable').selectOption('Orders');
  await page.locator('#jeRightTable').selectOption('Products');
  await page.locator('.je-rel-l').selectOption('ProdID');
  await page.locator('.je-rel-r').selectOption('ID');
  await page.locator('#jeLList input[value="OrderID"]').check();
  await page.locator('#jeLList input[value="Status"]').check();
  await page.locator('#jeRList input[value="Product"]').check();
  await page.locator('#jeSave').click();
  await expect(page.locator('#joinModal')).toHaveClass(/hidden/);

  await page.locator('#viewsTrigger').click();
  await page.locator('#modalOverlay .checkbox-row input[value="OrderProducts"]').check();
  await page.locator('#saveMod').click();
  await page.locator('.acc-item[data-acc="rules"] .acc-head').click();
  await expect(page.locator('#globalFilter')).toBeVisible();
  await page.locator('#globalFilter').fill('Status=shipped');

  const joinedTable = page.locator('#previewArea .table-container').filter({ hasText: 'JOIN:OrderProducts' });
  await expect(joinedTable).toContainText('Widget_A');
  await expect(joinedTable).not.toContainText('Widget_B');

  await joinedTable.locator('tbody td').first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await expect(page.locator('#toast')).toContainText('已复制');
  const copiedText = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedText).toContain('OrderID\tStatus\tProduct');
  expect(copiedText).toContain('5001\tshipped\tWidget_A');

  const downloadWait = page.waitForEvent('download');
  await page.locator('#exportPrevBtn').click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const exportPath = testInfo.outputPath('preview.xlsx');
  await download.saveAs(exportPath);

  const sheets = await readExcelFile(await fs.readFile(exportPath));
  const joinedSheet = sheets.find(sheet => sheet.sheet === 'JOIN_OrderProducts');
  expect(joinedSheet).toBeDefined();
  expect(joinedSheet.data[0]).toEqual(['OrderID', 'Status', 'Product']);
  expect(joinedSheet.data.slice(1)).toEqual([[5001, 'shipped', 'Widget_A']]);
  expect(unexpectedRequests).toEqual([]);
});

test('parse JSON records and copy both JSON layouts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin:'http://127.0.0.1:4173' });
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill('[{"id":"001","name":"Alice"},{"id":"002","name":"Bob"}]');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#parseStatusText')).toContainText('JSON 表格');
  await expect(page.locator('#previewArea')).toContainText('Alice');

  await page.locator('#copySettingsBtn').click();
  await page.locator('#copyFormatSelect').selectOption('json-expanded');
  await page.locator('#copySettingsCloseBtn').click();
  await page.locator('#previewArea tbody td').first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual([
    { id:'001', name:'Alice' }, { id:'002', name:'Bob' },
  ]);
  expect(copied).toContain('    "id": "001"');

  await page.locator('#copySettingsBtn').click();
  await page.locator('#copyFormatSelect').selectOption('json-inline');
  await page.locator('#copySettingsCloseBtn').click();
  await page.locator('#previewArea tbody td').first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  const inline = await page.evaluate(() => navigator.clipboard.readText());
  expect(inline).toBe('[\n  {"id":"001","name":"Alice"},\n  {"id":"002","name":"Bob"}\n]');
});
