import path from 'node:path';
import {test,expect} from '@playwright/test';
import {createLargeCsv} from '../tests/helpers/large-data.mjs';
import {readSheet} from 'read-excel-file/node';

/* 多卡片工作区 e2e（验收基线 docs/testing/multi-card-baseline.md 六场景）
   CI Chromium 运行；单文件离线产品，卡片 = 数据段（显隐控制表池 + 独立解析策略）。 */

const grant = async context => context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
const paste = async (page, text) => {
  await page.evaluate(async t=>navigator.clipboard.writeText(t), text);
  await page.locator('#rawInput').click();await page.locator('#rawInput').press('Control+V');
};
const cardList = page => page.locator('.data-card');
const parse = async page => { await page.locator('#parseBtn').click(); await expect(page.locator('#parseStatusText')).toContainText('解析完成',{timeout:60000}); };

test('场景1+2：两卡同名同结构 10 万行 CSV 拼接 20 万行、显隐回落、导出读回',async({page,context})=>{
  test.setTimeout(300000);
  const fixture=createLargeCsv();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await grant(context);await page.goto('/index.html');
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
  await expect(page.locator('#poolCount')).toContainText('2 张卡片');
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
  await expect(page.locator('#poolCount')).toContainText('1 张卡片');
  // 恢复可见 → 回 20 万行
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(tableA.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 200000',{timeout:30000});
  expect(errors).toEqual([]);
});

test('场景3：同名不同结构卡并列显示，互不合并',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');
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
  await expect(page.locator('.table-title',{hasText:'CSV Table 1 (数据段 2)'})).toBeVisible();
});

test('场景4：view 引用完整性——隐藏来源卡标记不可用、恢复自动复原',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');
  const csv='id,name\n1,甲\n2,乙';
  await paste(page, csv);await parse(page);
  await page.locator('#addCardBtn').click();
  const csvB='id,label\n1,标签一\n2,标签二';
  await paste(page, csvB);await parse(page);
  // 直接经 Store 建立跨表 JOIN view 并启用（UI 建 view 由既有 JOIN 设计器覆盖）
  await page.evaluate(()=>{
    const Store=OTA.require('store').Store;
    Store.transition('view:upsert',{view:{view:'V',left:'CSV Table 1',right:'CSV Table 1 (数据段 2)',type:'inner',on:'id=id',select:'left.id,right.label'}});
    Store.transition('view:setEnabled',{enabledViews:['V']});
  });
  await expect(page.locator('#viewsTrigger')).toContainText('V');
  // 隐藏右侧来源卡 → view 引用表不在表池 → 标记不可用
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(page.locator('#viewsTrigger .view-unavailable')).toContainText('不可用');
  // 恢复可见 → 自动复原
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click();
  await expect(page.locator('#viewsTrigger .view-unavailable')).toHaveCount(0);
});

test('场景5：粘贴落选中卡 + 新增卡片流',async({page,context})=>{
  test.setTimeout(120000);
  await grant(context);await page.goto('/index.html');
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
  await grant(context);await page.goto('/index.html');
  await paste(page, 'id,name\n1,甲');await parse(page);
  await page.locator('#addCardBtn').click();
  await paste(page, 'id,name\n2,乙');await parse(page);
  await cardList(page).nth(1).locator('[data-card-act="visible"]').click(); // 隐藏卡 B
  // 等待自动保存后重开
  await expect(page.locator('#storageStatus')).toContainText('已保存',{timeout:30000});
  await page.reload();
  await expect(cardList(page)).toHaveCount(2);
  await expect(page.locator('#poolCount')).toContainText('1 张卡片');
  const first=page.locator('.table-container').filter({has:page.locator('.table-title',{hasText:/^CSV Table 1$/})}).first();
  await expect(first.locator('.meta-tag').filter({hasText:/^Show:/})).toHaveText('Show: 1');
});
