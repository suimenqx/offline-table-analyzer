import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill('[{"id":"001","name":"Alice"},{"id":"002","name":"Bob"}]');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea tbody tr')).toHaveCount(2);
});

test('apply and cancel column filters from the keyboard, then clear an empty result', async ({ page }) => {
  const header = page.locator('.filterable-th').filter({ hasText:'name' });
  const input = page.locator('#fpInput');
  await header.press('Enter');
  await expect(input).toBeFocused();
  await input.fill('missing');
  await input.press('Enter');
  await expect(page.locator('#filterPopover')).toBeHidden();
  await expect(page.getByText('没有符合筛选条件的行')).toBeVisible();
  await expect(header).toBeFocused();

  await page.keyboard.press('Space');
  await expect(input).toHaveValue('missing');
  await input.fill('Alice');
  await input.press('Escape');
  await expect(header).toBeFocused();
  await expect(page.locator('#previewArea tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name:'清除本表列筛选（1）' }).press('Enter');
  await expect(page.locator('#previewArea tbody tr')).toHaveCount(2);
  await expect(page.getByText('没有符合筛选条件的行')).toHaveCount(0);
});

test('copy filtered records with their original field names', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin:'http://127.0.0.1:4173' });
  await page.locator('.filterable-th').filter({ hasText:'name' }).click();
  await page.locator('#fpInput').fill('Alice');
  await page.locator('#fpApply').click();
  await expect(page.locator('#previewArea tbody tr')).toHaveCount(1);
  await page.locator('#previewArea tbody td').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n')))
    .toBe('id\tname\n001\tAlice');
});

test('keep the filter actions on screen for low row headers and respect IME composition', async ({ page }) => {
  await page.setViewportSize({ width:1100, height:560 });
  // Several short tables put the last field close to the bottom of the preview.
  await page.locator('#rawInput').fill(JSON.stringify({ A:[{ a:1 }], B:[{ b:2 }], C:[{ c:3 }] }));
  await page.locator('#parseBtn').click();
  const card = page.locator('.table-container').filter({ has:page.getByText('C', { exact:true }) });
  await card.getByRole('button', { name:'行表头' }).click();
  const header = card.locator('.row-header-cell');
  await header.click();
  const pop = page.locator('#filterPopover');
  const rect = await pop.boundingBox();
  expect(rect.y + rect.height).toBeLessThanOrEqual(560);
  const input = page.locator('#fpInput');
  await input.fill('输入');
  await input.dispatchEvent('keydown', { key:'Enter', isComposing:true });
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(header).toBeFocused();
});
