import { test, expect } from '@playwright/test';
import {readSheet} from 'read-excel-file/node';

const cards = page => page.locator('#cardList .data-card');
const raw = name => JSON.stringify([{id:'1', name}, {id:'2', name}]);
const shown = page => page.locator('.table-container .meta-tag').filter({hasText:/^Show:/}).first();

async function parse(page, text) {
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#parseStatusText')).toContainText(/\d[\d,]* 行/);
}

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('普通粘贴按光标插入，全选才替换；大段粘贴切换明确的整卡替换提示', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  const editor=page.locator('#rawInput');
  await editor.fill('left|right');
  await editor.focus();
  await editor.evaluate(node=>node.setSelectionRange(5,5));
  await page.evaluate(()=>navigator.clipboard.writeText('MID'));
  await editor.press('Control+V');
  await expect(editor).toHaveValue('left|MIDright');
  await expect(page.locator('#pasteBehaviorHint')).toContainText('光标');
  await editor.press('Control+A');
  await page.evaluate(()=>navigator.clipboard.writeText('whole card'));
  await editor.press('Control+V');
  await expect(editor).toHaveValue('whole card');
  await page.locator('#addCardBtn').click();
  await expect(editor).toBeFocused();
  await page.evaluate(()=>navigator.clipboard.writeText('new card'));
  await editor.press('Control+V');
  await expect(editor).toHaveValue('new card');
  await cards(page).first().click();
  await expect(editor).toHaveValue('whole card');
  const large='id,name\n'+'1,large\n'.repeat(20000);
  await page.evaluate(text=>navigator.clipboard.writeText(text),large);
  await editor.focus();
  await editor.press('Control+V');
  await expect(editor).toHaveJSProperty('readOnly',true);
  await expect(page.locator('#pasteBehaviorHint')).toContainText('只读预览');
  expect(await page.evaluate(()=>OTA.require('store').Store.getDocument().raw.length)).toBe(large.length);
});

test('解析失败与待确认状态显示在对应卡片上，原文保留', async ({page}) => {
  await page.locator('#formatSelect').selectOption('json');
  await page.locator('#rawInput').fill('{broken');
  await page.locator('#parseBtn').click();
  await expect(cards(page).first().locator('.data-card-summary')).toContainText('解析失败');
  await expect(page.locator('#rawInput')).toHaveValue('{broken');
  await page.locator('#rawInput').fill('alpha,beta\none,two\nthree,four');
  await page.locator('#formatSelect').selectOption('csv');
  await expect(cards(page).first().locator('.data-card-summary')).toContainText('待确认');
  await expect(page.locator('#rawInput')).toHaveValue('alpha,beta\none,two\nthree,four');
});

test('卡片显示解析摘要，结果栏统计整个筛选结果；编辑退出表池的卡片不改变范围', async ({page}) => {
  await parse(page, raw('A'));
  await page.locator('#addCardBtn').click();
  const b = JSON.stringify([{id:'1',name:'B'},{id:'2',name:'B'},{id:'3',name:'B'}]);
  await parse(page, b);
  await expect(cards(page).first().locator('.data-card-summary')).toContainText('2 行 · 已解析');
  await expect(cards(page).last().locator('.data-card-summary')).toContainText('3 行 · 已解析');
  await expect(page.locator('#datasetSummary')).toContainText('表池 2/2 张卡片 · 1 表 · 5 行');
  await cards(page).last().locator('[data-card-act="visible"]').uncheck();
  await expect(shown(page)).toHaveText('Show: 2');
  await cards(page).first().click();
  await cards(page).last().click();
  await expect(page.locator('#rawInput')).toHaveValue(b);
  await expect(shown(page)).toHaveText('Show: 2');
  await expect(page.locator('#previewArea tbody tr').first()).toContainText('A');
  await expect(page.locator('#datasetSummary')).toContainText('表池 1/2 张卡片 · 1 表 · 2 行');
  await page.locator('#formatSelect').selectOption('json');
  await page.locator('#rawInput').fill('{broken');
  await page.locator('#parseBtn').click();
  await expect(cards(page).last().locator('.data-card-summary')).toContainText('解析失败');
  await expect(shown(page)).toHaveText('Show: 2');
  const pending=page.waitForEvent('download');
  await page.locator('#exportFullBtn').click();
  const download=await pending;
  const rows=await readSheet(await download.path(),'JSON Table 1');
  expect(rows).toEqual([['id','name'],[1,'A'],[2,'A']]);
  await cards(page).first().locator('[data-card-act="visible"]').uncheck();
  await expect(page.locator('.table-container')).toHaveCount(0);
  await expect(page.locator('#datasetSummary')).toContainText('表池 0/2 张卡片 · 0 表 · 0 行');
});

test('键盘和拖拽排序改变拼接顺序，不改变编辑对象或记录数量', async ({page}) => {
  await parse(page, raw('A'));
  await page.locator('#addCardBtn').click();
  await parse(page, raw('B'));
  await expect(shown(page)).toHaveText('Show: 4');
  await cards(page).last().focus();
  await cards(page).last().press('Alt+ArrowUp');
  await expect(cards(page).first().locator('.data-card-title')).toHaveText('数据段 2');
  await expect(cards(page).first()).toBeFocused();
  await expect(page.locator('#rawInput')).toHaveValue(raw('B'));
  await expect(page.locator('#previewArea tbody tr').first()).toContainText('B');
  const target = cards(page).last();
  const box = await target.boundingBox();
  await cards(page).first().locator('[data-card-act="drag"]').dragTo(target, {targetPosition:{x:40, y:box.height-4}});
  await expect(cards(page).first().locator('.data-card-title')).toHaveText('数据段 1');
  await expect(cards(page).last()).toHaveClass(/active/);
  await expect(page.locator('#rawInput')).toHaveValue(raw('B'));
  await expect(page.locator('#previewArea tbody tr').first()).toContainText('A');
  await expect(shown(page)).toHaveText('Show: 4');
  await expect(page.locator('#cardFeedback')).toContainText('拼接顺序');
});

test('方向键只移动焦点，Enter 选中；重命名和参与开关不丢焦点', async ({page}) => {
  await parse(page, raw('A'));
  await page.locator('#addCardBtn').click();
  await parse(page, raw('B'));
  await cards(page).first().click();
  await cards(page).first().focus();
  await cards(page).first().press('ArrowDown');
  await expect(cards(page).last()).toBeFocused();
  await expect(cards(page).first()).toHaveClass(/active/);
  await cards(page).last().press('Enter');
  await expect(page.locator('#rawInput')).toHaveValue(raw('B'));
  await expect(cards(page).last()).toBeFocused();
  await cards(page).last().press('F2');
  await page.getByRole('textbox', {name:'卡片名称'}).fill('订单数据');
  await page.getByRole('textbox', {name:'卡片名称'}).press('Enter');
  await expect(cards(page).last()).toBeFocused();
  await expect(cards(page).last().locator('.data-card-title')).toHaveText('订单数据');
  await cards(page).last().press('F2');
  await page.getByRole('textbox', {name:'卡片名称'}).fill('不保存');
  await page.getByRole('textbox', {name:'卡片名称'}).press('Escape');
  await expect(cards(page).last()).toBeFocused();
  await expect(cards(page).last().locator('.data-card-title')).toHaveText('订单数据');
  const toggle = cards(page).last().locator('[data-card-act="visible"]');
  await toggle.uncheck();
  await expect(toggle).toBeFocused();
  await expect(page.locator('#sourceEditorLabel')).toHaveText('当前编辑：订单数据（未参与分析）');
  await expect(page.locator('#rawInput')).toBeEnabled();
  await expect(cards(page).last().locator('.data-card-title')).not.toHaveCSS('text-decoration-line', 'line-through');
});

test('紧凑卡片列表限高，原文不重复展示，解析和当前编辑对象清晰可见', async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  await parse(page, raw('A'));
  for(let i=0; i<5; i++) await page.locator('#addCardBtn').click();
  await expect(cards(page)).toHaveCount(6);
  await expect(cards(page).first().locator('.data-card-title')).toHaveText('数据段 1');
  await expect(cards(page).last().locator('.data-card-title')).toHaveText('数据段 6');
  await expect(page.locator('.data-card-preview')).toHaveCount(0);
  await expect(page.locator('#sourceEditorLabel')).toContainText('数据段 6');
  await expect(page.locator('#pasteBehaviorHint')).toContainText('光标');
  const layout = await page.evaluate(() => ({
    card:document.querySelector('.data-card').getBoundingClientRect().height,
    list:document.querySelector('#cardList').getBoundingClientRect().height,
    parse:document.querySelector('#parseBtn').getBoundingClientRect().bottom,
    height:innerHeight,
  }));
  expect(layout.card).toBeLessThan(90);
  expect(layout.list).toBeLessThanOrEqual(230);
  expect(layout.parse).toBeLessThan(layout.height);
  await expect(cards(page).last().locator('[data-card-act="visible"]')).toBeChecked();
  await expect(cards(page).last().locator('.card-editing-badge')).toHaveText('编辑中');
});
