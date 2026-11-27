import path from 'node:path';
import {test,expect} from '@playwright/test';
import {createLargeCsv} from '../tests/helpers/large-data.mjs';
import {readSheet} from 'read-excel-file/node';

/* 多卡片工作区 e2e（验收基线 docs/testing/multi-card-baseline.md 六场景）
   CI Chromium 运行；单文件离线产品，卡片 = 数据段（显隐控制表池 + 独立解析策略）。 */

const grant = async context => context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
const paste = async (page, text) => {
  await page.evaluate(async t=>navigator.clipboard.writeText(t), text);
  await page.locator('#rawInput').click();
  // Editable-source paste follows caret/selection semantics at every size; select all to replace.
  await page.locator('#rawInput').press('Control+A');
  await page.locator('#rawInput').press('Control+V');
};
const cardList = page => page.locator('.data-card');
const watchConsole = page => { page.on('console', m => { if(m.type()==='error') console.log('PAGE-CONSOLE-ERROR:', m.text()); }); };
const prepare = async page => { await page.locator('#autoParseToggle').uncheck(); watchConsole(page); };
const parse = async page => {
  // 固定格式与表头：小样本 CSV 的自动识别/表头证据不足会要求人工确认
  await page.locator('#formatSelect').selectOption('csv');
  await page.locator('#headerModeSelect').selectOption('first-row');
  await page.locator('#parseBtn').click();
  await expect(page.locator('.data-card.active .data-card-summary')).toContainText(/\d[\d,]* 行/, {timeout:60000});
};

test('场景1+2：两卡同名同结构 10 万行 CSV 拼接 20 万行、显隐回落、导出读回',async({page,context})=>{
  test.setTimeout(300000);
  const fixture=createLargeCsv();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await grant(context);await page.goto('/index.html');await prepare(page);
  // 卡 A：粘贴 + 解析
  await paste(page, fixture.text);await parse(page);
  const tableA=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})});
  await expect(tableA.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 100000',{timeout:30000});
  // 新增卡片 B：粘贴 + 解析（独立解析策略）
  await page.locator('#addCardBtn').click();
  await expect(cardList(page)).toHaveCount(2);
  await paste(page, fixture.text);await parse(page);
  // 表池 = 拼接 20 万行（同名同结构直接拼接，不去重）
  await expect(tableA.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 200000',{timeout:30000});
  await expect(page.locator('#datasetSummary')).toContainText('显示 2/2 张卡片');
  // 导出全量 Excel 读回 20 万行 + 表头
  const downloading=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  const download=await downloading;
  const wb=test.info().outputPath('concat.xlsx');await download.saveAs(wb);
  const rows=await readSheet(wb,'CSV Table 1');
  expect(rows).toHaveLength(200001);
  // 场景 2：隐藏卡 B → 表池回落 10 万行
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(tableA.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 100000',{timeout:30000});
  await expect(page.locator('#datasetSummary')).toContainText('显示 1/2 张卡片');
  // 恢复可见 → 回 20 万行
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(tableA.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 200000',{timeout:30000});
  expect(errors).toEqual([]);
});

test('场景3：同名不同结构卡并列显示，互不合并',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');await prepare(page);
  const csvA='id,name,value\n1,甲,10\n2,乙,20';
  await paste(page, csvA);await parse(page);
  await page.locator('#addCardBtn').click();
  const csvB='id,desc\n1,说明甲\n2,说明乙'; // 同名（CSV Table 1）但列不同
  await paste(page, csvB);await parse(page);
  // 表池并列：拼接表 + 限定名表
  await expect(page.locator('.table-title',{hasText:'CSV Table 1 (数据段 2)'})).toBeVisible();
  const first=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})}).first();
  await expect(first.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 2');
  // 隐藏基础卡 → 限定名表仍在（范围控制只影响来源）
  await cardList(page).nth(0).locator('[data-card-act="visible"]').click();
  await expect(page.locator('.table-container')).toHaveCount(1); // 等待表池完成更新，而非读取旧 DOM
  await expect(page.locator('.table-title',{hasText:'CSV Table 1 (数据段 2)'})).toBeVisible();
});

test('拼接表只读，单来源编辑、撤销和重做写到该来源卡片',async({page})=>{
  await page.goto('/index.html'); await prepare(page);
  const input=page.locator('#rawInput');
  await input.fill('id,label\n1,Apple'); await parse(page);
  await page.locator('#addCardBtn').click();
  await input.fill('id,label\n2,Berry'); await parse(page);
  const tables=page.locator('#previewArea .table-container');
  await expect(tables.first().locator('tbody tr')).toHaveCount(2);
  await expect(tables.first()).toContainText('拼接 · 只读');
  await tables.first().getByText('Apple',{exact:true}).dblclick();
  await expect(page.locator('.cell-editor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('只读');
  await input.fill('id,other\n2,Berry'); await parse(page);
  await expect(tables).toHaveCount(2);
  const cell=tables.first().locator('tbody td').nth(1);
  await cell.dblclick(); await cell.locator('textarea').fill('Edited Apple');
  await cell.locator('textarea').press('Enter');
  await expect(cell).toHaveText('Edited Apple');
  await page.keyboard.press('Control+z'); await expect(cell).toHaveText('Apple');
  await page.keyboard.press('Control+y'); await expect(cell).toHaveText('Edited Apple');
  await cardList(page).first().locator('[data-card-act="visible"]').click();
  await expect(tables).toHaveCount(1);
  await expect(tables).toContainText('Berry');
  await cardList(page).first().locator('[data-card-act="visible"]').click();
  await expect(cell).toHaveText('Edited Apple');
});

test('HTML 卡参与同一表池，导出前确认其他可见卡的格式',async({page})=>{
  await page.goto('/index.html'); await prepare(page);
  const input=page.locator('#rawInput');
  await input.fill('count,rate;note\n12,50;3\n9,90;4\n10,50;5');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#parseStatusText')).toContainText('请选择解析格式');
  await page.locator('#addCardBtn').click();
  await input.fill('<table><tr><th>ID</th><th>Name</th></tr><tr><td>001</td><td>Apple</td></tr></table>');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea')).toContainText('Apple');
  const cardName=await page.evaluate(()=>OTA.require('store').Store.getState().docs[0].title);
  const downloads=[];
  page.on('download',download=>downloads.push(download));
  await page.locator('#exportFullBtn').click();
  await expect(page.locator('#toast')).toContainText(cardName);
  await expect(page.locator('#toast')).toContainText('解析格式');
  expect(downloads).toHaveLength(0);
  await cardList(page).first().locator('[data-card-act="visible"]').click();
  const download = page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  expect(await readSheet(await (await download).path(),1)).toEqual([['ID','Name'],['001','Apple']]);
  await cardList(page).first().locator('[data-card-act="visible"]').click();
  await cardList(page).first().click();
  await parse(page);
  await expect(page.locator('#previewArea .table-container')).toHaveCount(2);
  const complete=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  const workbook=await (await complete).path();
  expect(await readSheet(workbook,1)).toHaveLength(4);
  expect(await readSheet(workbook,2)).toEqual([['ID','Name'],['001','Apple']]);
});

test('场景4：view 引用完整性——隐藏来源卡标记不可用、恢复自动复原',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');await prepare(page);
  const csv='id,name\n1,甲\n2,乙';
  await paste(page, csv);await parse(page);
  await page.locator('#addCardBtn').click();
  const csvB='id,label\n1,标签一\n2,标签二';
  await paste(page, csvB);await parse(page);
  // 设计器必须同时看到表池中来自不同卡片的原始表，而不只看当前卡片。
  await page.locator('#sidebarConfigTabBtn').click();
  await page.locator('#manageViewsBtn').click();
  await page.locator('#jeAddNew').click();
  await page.locator('#jeName').fill('CrossCardView');
  await page.locator('#jeLeftTable').selectOption('CSV Table 1');
  await page.locator('#jeRightTable').selectOption('CSV Table 1 (数据段 2)');
  await expect(page.getByRole('button',{name:'采用 id = id',exact:true})).toBeVisible();
  await page.locator('.je-rel-l').selectOption('id');
  await page.locator('.je-rel-r').selectOption('id');
  await page.locator('#jeLList input[value="name"]').check();
  await page.locator('#jeRList input[value="label"]').check();
  const sample=page.getByRole('table',{name:'JOIN 结果样例'});
  await expect(sample.locator('tbody tr')).toHaveCount(2);
  await expect(sample.locator('tbody tr').first().locator('td')).toHaveText(['甲','标签一']);
  await page.locator('#jeSave').click();
  await expect(page.locator('#joinModal')).toHaveClass(/hidden/);
  await page.evaluate(()=>OTA.require('store').Store.transition('view:setEnabled',{enabledViews:['CrossCardView']}));
  const joined=page.locator('#previewArea .table-container').filter({hasText:'JOIN:CrossCardView'});
  await expect(joined).toContainText('标签一');
  await expect(joined).toContainText('甲');
  await expect(page.locator('#viewsTrigger')).toContainText('CrossCardView');
  // 隐藏右侧来源卡 → view 引用表不在表池 → 标记不可用
  await page.locator('#sidebarDataTabBtn').click();
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(page.locator('#viewsTrigger .view-unavailable')).toContainText('不可用');
  // 恢复可见 → 自动复原
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(page.locator('#viewsTrigger .view-unavailable')).toHaveCount(0);
});

test('场景5：粘贴落选中卡 + 新增卡片流',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');await prepare(page);
  await paste(page, 'id,name\n1,甲');await parse(page);
  // 新增卡片自动选中：粘贴应落新卡（表池含两张卡的表）
  await page.locator('#addCardBtn').click();
  await expect(cardList(page).nth(1)).toHaveClass(/active/);
  await paste(page, 'id,name\n2,乙');await parse(page);
  await expect(page.locator('.table-title',{hasText:/^CSV Table 1$/}).first()).toBeVisible();
  const first=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})}).first();
  await expect(first.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 2');
  // 选中卡 A：粘贴替换其内容
  await cardList(page).nth(0).click();
  await paste(page, 'id,name\n3,丙');await parse(page);
  await expect(first.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 2');
});

test('场景6：浏览器重启恢复多卡工作区',async({page,context})=>{
  test.setTimeout(180000);
  await grant(context);await page.goto('/index.html');await prepare(page);
  await paste(page, 'id,name\n1,甲');await parse(page);
  await page.locator('#addCardBtn').click();
  await paste(page, 'id,name\n2,乙');await parse(page);
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click(); // 隐藏卡 B
  // 等待自动保存后重开
  await expect(page.locator('#storageStatus')).toContainText('已保存',{timeout:30000});
  await page.reload();
  await expect(cardList(page)).toHaveCount(2);
  await expect(page.locator('#datasetSummary')).toContainText('显示 1/2 张卡片');
  await parse(page); // 重开后解析（autoParse 持久化为关闭）
  const first=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})}).first();
  await expect(first.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 1');
});
