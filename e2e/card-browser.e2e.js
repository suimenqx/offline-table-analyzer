import {test, expect} from '@playwright/test';

const cards=page=>page.locator('#cardList .data-card');
const shownCards=page=>page.locator('#cardList .data-card:visible');
const raw=name=>JSON.stringify([{id:'001',name}]);
async function parse(page,text) {
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(page.locator('.data-card.active')).toHaveAttribute('data-parse-state','ready');
}
async function addCards(page,count) {
  for(let i=0;i<count;i++) await page.locator('#addCardBtn').click();
}

test.beforeEach(async({page})=>{
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('展开列表后选中卡片自动返回紧凑布局，经典选中条与原文对应',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await addCards(page,7);
  const expand=page.locator('#expandCardListBtn');
  const compact=await page.locator('#cardList').evaluate(node=>node.clientHeight);
  await expand.click();
  await expect(expand).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#cardList').evaluate(node=>node.clientHeight)).toBeGreaterThan(compact);
  await cards(page).nth(4).click();
  await expect(expand).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#sourceEditorLabel')).toHaveText('原文 · 数据段 5');
  const stripe=()=>page.locator('.data-card.active').evaluate(node=>({
    color:getComputedStyle(node,'::before').backgroundColor,
    width:getComputedStyle(node,'::before').width,
    primary:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  }));
  expect(await stripe()).toEqual({color:'rgb(166, 106, 76)',width:'2px',primary:'#a66a4c'});
  await page.locator('#themeBtn').click();
  expect(await stripe()).toEqual({color:'rgb(180, 119, 96)',width:'2px',primary:'#b47760'});
  await expect(page.locator('#clearCardSearchBtn')).toBeHidden();
  const themedSearch=await page.locator('#cardSearchInput').evaluate(node=>({background:getComputedStyle(node).backgroundColor,input:getComputedStyle(document.documentElement).getPropertyValue('--bg-input').trim()}));
  expect(themedSearch).toEqual({background:'rgb(32, 33, 37)',input:'#202125'});
  await expect(page.locator('#parseBtn')).toBeInViewport();
});

test('名称搜索保留分析范围与拼接顺序，方向键只经过匹配卡片，Escape 清除',async({page})=>{
  await parse(page,raw('A'));
  await expect(page.locator('#cardSearchRow')).toBeHidden();
  await addCards(page,7);
  await cards(page).first().dblclick();
  await page.getByRole('textbox',{name:'卡片名称'}).fill('Orders October');
  await page.getByRole('textbox',{name:'卡片名称'}).press('Enter');
  const saved=await page.evaluate(()=>JSON.stringify(OTA.require('store').Store.serializeState()));
  const summary=await page.locator('#datasetSummary').textContent();
  const search=page.getByRole('searchbox',{name:'搜索卡片名称'});
  await search.fill('ORDERS');
  await expect(shownCards(page)).toHaveCount(1);
  await expect(page.locator('#cardSearchStatus')).toHaveText('找到 1 / 8 张卡片');
  expect(await page.evaluate(()=>JSON.stringify(OTA.require('store').Store.serializeState()))).toBe(saved);
  await expect(page.locator('#datasetSummary')).toHaveText(summary);
  await expect(shownCards(page).locator('.card-drag-handle')).toBeDisabled();
  await search.press('ArrowDown');
  await expect(shownCards(page).first()).toBeFocused();
  await shownCards(page).first().press('ArrowDown');
  await expect(shownCards(page).first()).toBeFocused();
  await search.fill('missing');
  await expect(page.locator('#cardSearchEmpty')).toBeVisible();
  await search.press('Escape');
  await expect(shownCards(page)).toHaveCount(8);
  await expect(search).toBeFocused();
  await expect(cards(page).first().locator('.card-drag-handle')).toBeEnabled();
});

test('异常状态可直接用鼠标和键盘打开当前或其他卡片的正确解析详情',async({page})=>{
  await page.locator('#rawInput').fill('a,b\n1,2,3\n4,5');
  await page.locator('#parseBtn').click();
  await expect(cards(page).first()).toHaveAttribute('data-parse-state','confirm');
  const firstId=await cards(page).first().getAttribute('data-card-id');
  await page.locator('#addCardBtn').click();
  await page.locator('#formatSelect').selectOption('json');
  await page.locator('#rawInput').fill('{broken');
  await page.locator('#parseBtn').click();
  await expect(cards(page).last()).toHaveAttribute('data-parse-state','error');
  const failure=cards(page).last().locator('.card-status-action');
  await failure.focus(); await failure.press('Enter');
  await expect(page.getByRole('dialog',{name:'解析详情'})).toContainText('PARSE_ERROR');
  await page.locator('#modalCloseBtn').click();
  await expect(failure).toBeFocused();
  await cards(page).first().locator('.card-status-action').click();
  await expect(page.getByRole('dialog',{name:'解析详情'})).toBeVisible();
  await expect(page.locator('.data-card.active')).toHaveAttribute('data-card-id',firstId);
  await expect(page.locator('.diagnostic-candidate-btn')).not.toHaveCount(0);
  await page.locator('#modalCloseBtn').click();
  await expect(cards(page).first().locator('.card-status-action')).toBeFocused();
});

test('删除撤销恢复原顺序、显隐、原文及修正，并重新计算结果',async({page})=>{
  await parse(page,raw('original'));
  const firstId=await cards(page).first().getAttribute('data-card-id');
  await page.locator('#previewArea tbody td').nth(1).dblclick();
  await page.locator('#previewArea textarea.cell-editor').fill('corrected');
  await page.locator('#previewArea textarea.cell-editor').press('Enter');
  await page.locator('#addCardBtn').click();
  await parse(page,raw('second'));
  await cards(page).first().locator('.card-visibility').click();
  await cards(page).first().locator('.card-remove').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('#cardUndoNotice')).toContainText('数据段 1');
  await page.locator('#undoCardRemovalBtn').click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first()).toHaveAttribute('data-card-id',firstId);
  await expect(cards(page).first()).toHaveClass(/active.*excluded-card/);
  await expect(page.locator('#rawInput')).toHaveValue(raw('original'));
  await expect(page.locator('#cardUndoNotice')).toBeHidden();
  await cards(page).last().locator('.card-visibility').click();
  await cards(page).first().locator('.card-visibility').click();
  await expect(page.locator('#previewArea tbody')).toContainText('corrected');
});

test('删除最后一张后仍可撤销，过期后不留下可用撤销',async({page})=>{
  await parse(page,raw('A'));
  await cards(page).first().press('Delete');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#rawInput')).toBeDisabled();
  await page.locator('#undoCardRemovalBtn').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('#rawInput')).toBeEnabled();
  await page.clock.install();
  await cards(page).first().press('Delete');
  await expect(page.locator('#cardUndoNotice')).toBeVisible();
  await page.clock.fastForward(15001);
  await expect(page.locator('#cardUndoNotice')).toBeHidden();
  expect(await page.evaluate(()=>OTA.require('store').Store.transition('card:undoRemove'))).toBe(false);
});

test('拖拽时可见目标位置，取消清除提示且不改变实际拼接顺序',async({page})=>{
  await addCards(page,2);
  const before=await cards(page).locator('.data-card-title').allTextContents();
  const grip=cards(page).first().locator('.card-drag-handle');
  const start=await grip.boundingBox(), end=await cards(page).last().boundingBox();
  await page.mouse.move(start.x+8,start.y+12); await page.mouse.down();
  await page.mouse.move(start.x+18,start.y+18,{steps:3});
  await page.mouse.move(end.x+40,end.y+end.height-4,{steps:8});
  await page.mouse.move(end.x+40,end.y+end.height-4);
  await expect(page.locator('#cardReorderHint')).toHaveText('移至第 3 位 · 顺序决定数据拼接顺序');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('#cardReorderHint')).toBeHidden();
  expect(await cards(page).locator('.data-card-title').allTextContents()).toEqual(before);
});
