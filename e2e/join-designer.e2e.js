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

async function editSavedView(page, fields, otherViews = []) {
  await page.goto('/index.html');
  await page.locator('#rawInput').fill(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  const library = page.locator('#modalContent');
  await library.getByText('从 JSON 导入视图').click();
  const view = {view:'Report',type:'inner',left:'Customers',right:'Orders',on:'ID=ID',...fields};
  await library.getByLabel('视图 JSON 配置').fill(JSON.stringify([view,...otherViews]));
  await library.getByRole('button',{name:'导入配置'}).click();
  await library.locator('#jeEdit_0').click();
  return page.locator('#joinModal');
}

test('repair missing sources one side at a time without losing saved keys, order or aliases', async ({page}) => {
  const select = 'right.Amount as Total,left.Name as Customer,left.ID';
  const editor = await editSavedView(page,{left:'Old customers',right:'Old orders',select:select+',left.LegacyName'});
  const left = editor.getByLabel('左表',{exact:true});
  const right = editor.getByLabel('右表',{exact:true});
  await expect(left).toHaveValue('Old customers');
  await expect(right).toHaveValue('Old orders');
  await expect(editor.locator('#jeWarn')).toContainText('Old customers');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await expect(editor.locator('#jeDirty')).toBeHidden();
  await left.selectOption('Orders'); // Default dialog dismissal cancels the loss of Name.
  await expect(left).toHaveValue('Old customers');
  let impact;
  page.once('dialog',async dialog => {
    impact = dialog.message();
    await dialog.accept();
  });
  await left.selectOption('Customers');
  expect(impact).toContain('LegacyName');
  expect(impact).not.toContain('Amount');
  await expect(editor.getByLabel('条件 1 右表字段')).toHaveValue('ID');
  await expect(editor.getByLabel('Old orders.Amount 的输出别名')).toHaveValue('Total');
  await expect(editor.locator('#jeWarn')).toContainText('Old orders');
  await right.selectOption('Orders');
  await expect(editor.locator('#jeSample thead th')).toHaveText(['匹配情况','Total','Customer','ID']);
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ota_v21_workspace')).projects[0].views[0]))
    .toMatchObject({left:'Customers',right:'Orders',on:'ID=ID',select});
});

test('repair missing fields after a source schema change', async ({page}) => {
  const editor = await editSavedView(page,{on:'FormerID=ID',select:'left.Name,right.Retired as OldTotal'});
  const key = editor.getByLabel('条件 1 左表字段');
  await expect(key).toHaveValue('FormerID');
  await expect(key.locator('option:checked')).toContainText('字段缺失');
  await expect(editor.locator('#jeDirty')).toBeHidden();
  await key.selectOption('ID');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await expect(editor.locator('#jeWarn')).toContainText('Orders.Retired');
  await expect(editor.locator('.join-chip').filter({hasText:'Retired'})).toContainText('字段缺失');
  await editor.getByRole('button',{name:'移除 Orders.Retired'}).click();
  await editor.locator('#jeRList input[value="Amount"]').check();
  await expect(editor.locator('#jeSample')).toContainText('20');
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
});

test('an unavailable upstream view identifies its missing source and preserves downstream fields', async ({page}) => {
  const upstream = {view:'Lookup',left:'Old customers',right:'Orders',type:'left',on:'ID=ID',select:'left.ID,left.Name'};
  const editor = await editSavedView(page,{select:'left.Name as Customer'},[upstream]);
  await editor.getByLabel('左表',{exact:true}).selectOption('Lookup');
  await expect(editor.locator('#jeWarn')).toContainText('Old customers');
  await expect(editor.getByLabel('条件 1 左表字段')).toHaveValue('ID');
  await expect(editor.getByLabel('Lookup.Name 的输出别名')).toHaveValue('Customer');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await editor.getByLabel('左表',{exact:true}).selectOption('Customers');
  await expect(editor.locator('#jeSample thead th').last()).toHaveText('Customer');
  await expect(editor.locator('#jeSave')).toBeEnabled();
});

test('an ambiguous alias is identified in place and correcting it restores the sample', async ({page}) => {
  const editor = await editSavedView(page,{select:'right.Amount as 金额，含税'});
  const alias = editor.getByLabel('Orders.Amount 的输出别名');
  await expect(editor.locator('#jeSample thead th').last()).toHaveText('金额，含税');
  await alias.fill('金额,含税');
  await expect(alias).toHaveAttribute('aria-invalid','true');
  await expect(alias).toHaveAccessibleDescription(/英文逗号/);
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await expect(editor.locator('#jeSize')).toContainText('1 行 × 1 列');
  await expect(editor.locator('#jeSample table')).toHaveCount(0);
  await alias.press('Control+Enter');
  await expect(alias).toBeFocused();
  await alias.fill('金额，含税');
  await expect(editor.locator('#jeSample thead th').last()).toHaveText('金额，含税');
  await alias.press('Control+Enter');
  await expect(editor).toBeHidden();
});

test('a separator in a source field cannot silently change the saved condition or output', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#rawInput').fill(JSON.stringify([{id:1,'ref=code':7,'Net, USD':19,'Tax: USD':2}]));
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('1 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#newJoinBtn').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Totals');
  await editor.getByLabel('在当前工程启用').uncheck();
  const leftKey = editor.getByLabel('条件 1 左表字段');
  await leftKey.selectOption('ref=code');
  await editor.getByLabel('条件 1 右表字段').selectOption('id');
  await editor.locator('#jeLList input[value="id"]').check();
  await expect(editor.locator('#jeWarn')).toContainText('ref=code');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await leftKey.selectOption('id');
  for(const name of ['Net, USD','Tax: USD']) {
    const field = editor.locator('#jeLList').getByRole('checkbox',{name,exact:true});
    await field.check();
    await expect(editor.locator('#jeWarn')).toContainText(name);
    await expect(editor.locator('#jeSave')).toBeDisabled();
    await expect(editor.locator('#jeSample table')).toHaveCount(0);
    await field.uncheck();
  }
  await expect(editor.locator('#jeSave')).toBeEnabled();
  await expect(editor.locator('#jeSample thead th')).toHaveText(['匹配情况','id']);
});

test('an outer join preset follows the join type and preserves the right-only identifier', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#rawInput').fill(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#newJoinBtn').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Outer');
  await editor.getByRole('button',{name:'匹配同名字段'}).click();
  await editor.locator('#jePresetEnrich').click();
  const id = editor.locator('#jeRList input[value="ID"]');
  await expect(id).not.toBeChecked();
  for (const type of ['right','full']) {
    await editor.getByLabel('连接方式').selectOption(type);
    await expect(id).toBeChecked();
    await expect(editor.locator('#jeRList input[value="validflag"]')).toBeChecked();
    await expect(editor.locator('#jeSample tr').filter({hasText:'仅右表'}).getByRole('cell',{name:'3',exact:true})).toBeVisible();
  }
  await id.uncheck();
  await editor.getByLabel('连接方式').selectOption('right');
  await expect(id).not.toBeChecked();
  await editor.locator('#jePresetEnrich').click();
  await editor.locator('#jeSave').click();
  await expect(page.getByRole('table',{name:'JOIN:Outer 列表头预览'}).getByRole('cell',{name:'3',exact:true})).toHaveCount(1);
});

test('save a four-million-row Worker JOIN disabled, then tighten it and enable it', async ({page}) => {
  const rows = Array.from({length:2000}, (_,i) => ({id:String(i), group:'same', note:'source row for the scale check'}));
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(JSON.stringify({L:rows,R:rows}));
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#newJoinBtn').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Fanout');
  await editor.getByLabel('条件 1 左表字段').selectOption('group');
  await editor.getByLabel('条件 1 右表字段').selectOption('group');
  await editor.locator('#jeLList input[value="id"]').check();
  await expect(editor.locator('#jeSize')).toContainText('4,000,000 行 × 1 列');
  await expect(editor.locator('#jeWarn')).toContainText('1,000,000 行');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await expect(editor.locator('#jeSample tbody tr')).toHaveCount(5);
  await editor.getByLabel('在当前工程启用').uncheck();
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
  await page.locator('#viewsTrigger').click();
  await page.locator('#modalContent input[value="Fanout"]').check();
  await page.locator('#saveMod').click();
  await expect(page.locator('#viewBudgetStatus')).toContainText('4,000,000 行');
  await expect(page.locator('#viewsTrigger')).not.toContainText('Fanout');
  await page.keyboard.press('Escape');
  await page.locator('#manageViewsBtn').click();
  await page.locator('#jeEdit_0').click();
  await editor.getByLabel('条件 1 左表字段').selectOption('id');
  await editor.getByLabel('条件 1 右表字段').selectOption('id');
  await expect(editor.locator('#jeSize')).toContainText('2,000 行 × 1 列');
  await editor.getByLabel('在当前工程启用').check();
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
  await expect(page.locator('#viewsTrigger')).toContainText('Fanout');
});

test('the designer includes displayed source cells when a JOIN alone fits exactly', async ({page}) => {
  const row = {id:'x',a:'a',b:'b',c:'c',d:'d',e:'e',f:'f',g:'g'};
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(JSON.stringify({Source:Array(1000).fill(row)}));
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('1 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#newJoinBtn').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Exact');
  await editor.getByLabel('条件 1 左表字段').selectOption('id');
  await editor.getByLabel('条件 1 右表字段').selectOption('id');
  await editor.locator('#jePresetLeft').click();
  await expect(editor.locator('#jeSize')).toContainText('8,000,000 个单元格');
  await editor.locator('#jeSave').click();
  await expect(editor.locator('#jeWarn')).toContainText('8,008,000 个单元格');
  await editor.getByLabel('在当前工程启用').uncheck();
  await editor.locator('#jeSave').click();
  await expect(editor).toBeHidden();
  await expect(page.locator('#viewsTrigger')).not.toContainText('Exact');
});

test('rename and delete sources with visible downstream impact across a saved chain', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#rawInput').fill(source);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  const library = page.locator('#modalContent');
  const base = {view:'Base',left:'Customers',right:'Orders',type:'left',on:'ID=ID',select:'left.ID,left.Name'};
  await library.getByText('从 JSON 导入视图').click();
  await library.getByLabel('视图 JSON 配置').fill(JSON.stringify([base,{...base,view:'Middle',left:'Base'},{...base,view:'Final',left:'Middle'}]));
  await library.getByRole('button',{name:'导入配置'}).click();
  await page.keyboard.press('Escape');
  await page.locator('#viewsTrigger').click();
  await library.locator('input[value="Final"]').check();
  await library.locator('#saveMod').click();
  await expect(page.getByRole('table',{name:'JOIN:Final 列表头预览'})).toContainText('Alice');
  await page.locator('#manageViewsBtn').click();
  await library.locator('#jeEdit_0').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Renamed');
  await expect(editor.locator('#jeRenameImpact')).toContainText('Middle、Final');
  await editor.getByLabel('左表',{exact:true}).selectOption('Final');
  await expect(editor.locator('#jeWarn')).toContainText('循环');
  await expect(editor.locator('#jeSave')).toBeDisabled();
  await editor.getByLabel('左表',{exact:true}).selectOption('Customers');
  await expect(editor.getByLabel('视图名称')).toHaveValue('Renamed');
  await page.evaluate(() => new Promise(held => {
    navigator.locks.request('ota_v21_workspace', () => new Promise(release => {
      window.releaseJoinSave = release;
      held(true);
    }));
  }));
  await editor.locator('#jeSave').click();
  await expect(editor.locator('#jeWarn')).toContainText('正在保存到此设备');
  await page.evaluate(() => window.releaseJoinSave());
  await expect(editor).toBeHidden();
  await expect(page.locator('#targetTableSelect option[value="JOIN:Renamed"]')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ota_v21_workspace')).projects[0].views[0].view)).toBe('Renamed');
  await page.reload();
  await expect(page.getByRole('table',{name:'JOIN:Final 列表头预览'})).toContainText('Alice');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  await library.locator('#jeDel_0').click();
  await expect(library.locator('#jeDelImpact_0')).toContainText('Middle、Final');
  await library.locator('#jeDelCancel_0').click();
  await library.getByLabel('选择 Renamed').check();
  await library.getByLabel('选择 Middle').check();
  await library.getByRole('button',{name:'删除所选',exact:true}).click();
  await expect(library.locator('#jeBatchImpact')).toContainText('Final');
  await expect(library.locator('#jeBatchImpact')).not.toContainText('Middle');
  await library.getByRole('button',{name:'确认删除所选'}).click();
  await expect(library.locator('.view-item')).toHaveCount(1);
  await expect(library.locator('.view-item')).toContainText('Final');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewsTrigger')).not.toContainText('Final');
});

test('apply a suggested key and an output preset, then preview actual rows before saving', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(source.replace('ID Name','CustomerID Name'));
  await page.locator('#parseBtn').click();
  await expect(page.locator('#datasetSummary')).toContainText('2 表');
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#newJoinBtn').click();
  const editor = page.locator('#joinModal');
  await editor.getByLabel('视图名称').fill('Enriched');
  await editor.getByLabel('条件 1 左表字段').selectOption('validflag');
  await editor.getByLabel('条件 1 右表字段').selectOption('validflag');
  const candidate = editor.getByRole('button', {name:'采用 CustomerID = ID',exact:true});
  await candidate.click();
  await expect(candidate).toBeDisabled();
  await expect(editor.getByLabel('条件 1 左表字段')).toHaveValue('validflag');
  await expect(editor.getByLabel('条件 2 左表字段')).toHaveValue('CustomerID');
  await editor.getByLabel('连接方式').selectOption('left');
  await editor.getByRole('button', {name:'左表全部＋右表补充'}).click();
  await expect(editor.locator('#jeRList input[value="ID"]')).not.toBeChecked();
  await expect(editor.locator('#jeRList input[value="validflag"]')).not.toBeChecked();
  const sample = editor.getByRole('table', {name:'JOIN 结果样例'});
  await expect(sample.locator('tbody tr')).toHaveCount(2);
  await expect(sample.locator('tbody tr').first()).toContainText('Alice');
  await expect(sample.locator('tbody tr').last()).toContainText('仅左表');
  await expect(sample.locator('tbody tr').last().locator('td').last()).toHaveText('');
  await editor.getByLabel('Orders.Amount 的输出别名').fill('Total');
  await expect(sample.locator('thead th').last()).toHaveText('Total');
  await editor.getByRole('button', {name:'仅选右表'}).click();
  await expect(editor.locator('#jeLCount')).toHaveText('0/3');
  await expect(sample.locator('thead th').last()).toHaveText('Total');
  await editor.getByRole('button', {name:'左表全部＋右表补充'}).click();
  await editor.getByLabel('连接方式').selectOption('inner');
  await editor.getByLabel('条件 2 左表字段').selectOption('Name');
  await expect(editor.locator('#jeSample')).toContainText('没有输出行');
  await expect(sample).toHaveCount(0);
  await editor.getByLabel('条件 2 左表字段').selectOption('CustomerID');
  await editor.getByLabel('连接方式').selectOption('left');
  const expected = await sample.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td'), c => c.textContent)));
  await editor.locator('#jeSave').click();
  const saved = page.getByRole('table', {name:'JOIN:Enriched 列表头预览'});
  await expect(saved.locator('tbody tr')).toHaveCount(2);
  expect(await saved.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td'), c => c.textContent)))).toEqual(expected);
});

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
