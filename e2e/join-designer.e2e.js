import { expect, test } from '@playwright/test';

const source = [
  'table-data Customers',
  'validflag ID Name',
  '1         1  Alice',
  '1         2  Sam',
  '',
  'table-data Orders',
  'validflag ID Amount',
  '1         1  20',
  '1         3  40',
].join('\n');

test('design a JOIN from the sidebar and inspect the effect before saving', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.getByRole('button', {name:'新建 JOIN 视图'}).click();
  const editor = page.getByRole('dialog', {name:'新建 JOIN 视图'});
  const name = editor.getByLabel('视图名称');
  await expect(name).toBeFocused();
  await name.fill('CustomerOrders');
  await expect(editor.getByLabel('左表', {exact:true})).toHaveValue('Customers');
  await expect(editor.getByLabel('右表', {exact:true})).toHaveValue('Orders');
  await expect(editor.locator('.je-rel-l')).toHaveValue('');
  await editor.getByRole('button', {name:'添加条件'}).press('Enter');
  await expect(editor.locator('.je-rel-l')).toHaveCount(2);
  await editor.locator('#jeLList input[value="Name"]').check();
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await editor.getByRole('button', {name:'匹配同名字段'}).click();
  await expect(editor.locator('#jePreview')).toContainText('输出行数');
  await expect(editor.locator('#jePreview dd').first()).toHaveText('1');
  await editor.getByLabel('连接方式').selectOption('full');
  await expect(editor.locator('#jePreview dd').first()).toHaveText('3');
  const search = editor.getByLabel('搜索右表字段');
  await search.fill('Amount');
  await editor.locator('#jeRList input[value="Amount"]').check();
  await expect(editor.locator('#jeRCount')).toHaveText('1/3');
  await editor.locator('.join-alias').last().fill('Total');
  const amount = editor.locator('.join-chip').filter({hasText:'Amount'});
  await amount.press('Alt+ArrowUp');
  await expect(editor.locator('.join-chip').first()).toBeFocused();
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
  await expect(page.locator('#previewArea')).toContainText('JOIN:CustomerOrders');
  await expect(page.locator('#previewArea')).toContainText('Total');
  await page.locator('#manageViewsBtn').click();
  await page.locator('#jeEdit_0').click();
  await expect(page.locator('#jeRSearch')).toHaveValue('');
  await expect(page.locator('.join-alias').first()).toHaveValue('Total');
  await page.keyboard.press('Escape');
  await expect(page.locator('#manageViewsBtn')).toBeFocused();
});

test('save a disabled view and enable it later at a narrow width', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#viewsTrigger').click();
  await page.setViewportSize({width:390, height:744});
  const editor = page.getByRole('dialog', {name:'新建 JOIN 视图'});
  // The view shares a name with a checked output field in the closed editor.
  await editor.getByLabel('视图名称').fill('Name');
  await editor.getByLabel('条件 1 左表字段').selectOption('ID');
  await editor.getByLabel('条件 1 右表字段').selectOption('ID');
  const field = editor.locator('#jeLList').getByLabel('Name');
  await field.check();
  await editor.locator('#jeLOnlySel').check();
  await field.press('Space');
  await expect(field).toHaveCount(0);
  await expect(editor.getByLabel('搜索左表字段')).toBeFocused();
  await expect(editor.locator('#jeLList')).toContainText('没有符合条件的字段');
  await expect(editor.locator('#jeLCount')).toHaveText('0/3');
  await editor.locator('#jeLOnlySel').uncheck();
  await field.check();
  await editor.getByLabel('在当前工程启用').uncheck();
  expect(await editor.locator('.join-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await editor.getByLabel('视图名称').press('Control+Enter');
  await expect(editor).toBeHidden();
  await page.setViewportSize({width:1280, height:720});
  await expect(page.locator('#viewsTrigger')).not.toContainText('Name');
  await page.locator('#viewsTrigger').click();
  await page.locator('#modalOverlay input[value="Name"]').check();
  await page.locator('#saveMod').click();
  await expect(page.locator('#previewArea')).toContainText('JOIN:Name');
  await page.locator('#viewsTrigger').click();
  await page.locator('#modalOverlay input[value="Name"]').uncheck();
  await page.locator('#saveMod').click();
  await expect(page.locator('#viewsTrigger')).not.toContainText('Name');
  await expect(page.locator('#previewArea')).not.toContainText('JOIN:Name');
});

test('manage saved views with search, copy and inline delete controls', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  const library = page.getByRole('dialog', {name:'管理 JOIN 视图'});
  await expect(library.getByRole('button', {name:'新建视图'})).toBeVisible();
  await library.getByText('从 JSON 导入视图').click();
  await library.getByLabel('视图 JSON 配置').fill(JSON.stringify({
    view:'Summary', left:'Orders', right:'Products', type:'left', on:'sku=sku', select:'left.sku',
  }));
  await library.getByRole('button', {name:'导入配置'}).click();
  await library.getByRole('button', {name:'复制'}).click();
  await library.getByLabel('搜索视图').fill('_copy');
  await expect(library.locator('.view-item')).toHaveCount(1);
  await expect(library.locator('.view-item')).toContainText('Summary_copy');
  await library.getByLabel('全选当前列表').check();
  await expect(library.getByRole('button', {name:'导出所选'})).toBeEnabled();
  await library.getByRole('button', {name:'删除',exact:true}).click();
  await library.getByRole('button', {name:'取消'}).press('Enter');
  await expect(library.getByRole('button', {name:'删除',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#manageViewsBtn')).toBeFocused();
});
