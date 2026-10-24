import {test, expect} from '@playwright/test';

const cards=page=>page.locator('#cardList .data-card');
const raw=name=>JSON.stringify([{id:'1',name},{id:'2',name}]);
async function parse(page,text,total) {
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(page.locator('.meta-tag').filter({hasText:/^Show:/}).first()).toHaveText(`Show: ${total}`);
}
async function titles(page) {return cards(page).locator('.data-card-title').allTextContents();}
async function storedTitles(page) {
  return page.evaluate(()=>{const {Store}=OTA.require('store');return Store.getActiveProject().cardIds.map(id=>Store.getCard(id).title);});
}

test.beforeEach(async ({page})=>{
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('卡片精修保留经典明暗色板、紧凑尺寸和减少动态下的键盘操作',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#addCardBtn').click();
  const palette=()=>page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return ['--primary','--accent','--bg-app','--bg-card'].map(key=>s.getPropertyValue(key).trim());});
  expect(await palette()).toEqual(['#a66a4c','#0f9f8f','#f3f3f0','#ffffff']);
  await expect(cards(page).last().locator('.card-source-symbol, .card-editing-badge')).toHaveCount(0);
  await expect(cards(page).last().locator('.card-drag-handle svg, .card-remove svg')).toHaveCount(2);
  await expect(cards(page).last().locator('.data-card-detail .card-status-label')).toHaveText('空');
  await expect(cards(page).last().locator('.data-card-summary')).toBeHidden();
  await expect(cards(page).last().locator('.card-visibility svg')).toBeVisible();
  await expect(cards(page).last().locator('[data-card-act="visible"]')).toHaveAttribute('aria-pressed','true');
  const first=await cards(page).first().boundingBox();
  await cards(page).first().hover();
  expect(await cards(page).first().boundingBox()).toEqual(first);
  await expect(cards(page).first()).toHaveCSS('border-radius','10px');
  await expect(cards(page).first().locator('.data-card-summary')).toHaveCSS('font-variant-numeric','tabular-nums');
  await page.locator('#themeBtn').click();
  expect(await palette()).toEqual(['#b47760','#64d8c8','#17181b','#202125']);
  await page.emulateMedia({reducedMotion:'reduce'});
  // Enter with an actual keyboard action: programmatic focus after a mouse
  // theme click does not opt into Chromium's :focus-visible modality.
  await cards(page).first().locator('[data-card-act="drag"]').focus();
  await expect(cards(page).first()).toHaveAttribute('tabindex','0');
  await page.keyboard.press('Shift+Tab');
  await expect(cards(page).first()).toBeFocused();
  await expect(cards(page).first()).toHaveCSS('outline-style','solid');
  await cards(page).first().press('Alt+ArrowDown');
  expect(await titles(page)).toEqual(['数据段 2','数据段 1']);
  await expect(cards(page).last()).toBeFocused();
  expect(await page.locator('#cardList').evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.effect?.getKeyframes().some(k=>k.transform)).length)).toBe(0);
  await expect(cards(page).last()).toHaveCSS('outline-style','solid');
});

test('拖拽预览让位但不写入顺序，Escape 取消，落下才提交并保留编辑对象',async({page})=>{
  await parse(page,raw('A'),2);
  await page.locator('#addCardBtn').click();await parse(page,raw('B'),4);
  await page.locator('#addCardBtn').click();await parse(page,raw('C'),6);
  const grip=cards(page).first().locator('[data-card-act="drag"]');
  await grip.scrollIntoViewIfNeeded();
  const start=await grip.boundingBox(), end=await cards(page).last().boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
  await page.mouse.down();
  await page.mouse.move(start.x+start.width/2+8,start.y+start.height/2+8,{steps:3});
  await expect(cards(page).first()).toHaveClass(/dragging/);
  const list=await page.locator('#cardList').boundingBox();
  // A card's full box may extend outside the scroll viewport. Aim at its
  // visible portion, and repeat the move so native HTML dragover is delivered.
  const x=Math.min(end.x+40,list.x+list.width-12), y=Math.min(end.y+end.height-4,list.y+list.height-8);
  await page.mouse.move(x,y,{steps:8});
  await page.mouse.move(x,y);
  await expect(page.locator('#cardFeedback')).toContainText('放置到第 3 位');
  await expect.poll(async()=>{const a=await cards(page).first().boundingBox(),b=await cards(page).last().boundingBox();return a.y>b.y;}).toBe(true);
  expect(await storedTitles(page)).toEqual(['数据段 1','数据段 2','数据段 3']);
  await expect(page.locator('#rawInput')).toHaveValue(raw('C'));
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('.data-card.dragging')).toHaveCount(0);
  expect(await storedTitles(page)).toEqual(['数据段 1','数据段 2','数据段 3']);
  await expect.poll(()=>cards(page).first().evaluate(node=>getComputedStyle(node).transform)).toBe('none');
  const target=cards(page).last(), targetBox=await target.boundingBox();
  await grip.dragTo(target,{targetPosition:{x:40,y:targetBox.height-4}});
  await expect.poll(()=>storedTitles(page)).toEqual(['数据段 2','数据段 3','数据段 1']);
  await expect(cards(page).last()).toBeFocused();
  await expect(cards(page).nth(1)).toHaveClass(/active/);
  await expect(page.locator('#rawInput')).toHaveValue(raw('C'));
  await expect(page.locator('.meta-tag').filter({hasText:/^Show:/}).first()).toHaveText('Show: 6');
});

test('真实后台解析时显示忙碌状态，完成或失败后清除；减少动态不旋转',async({page})=>{
  await page.evaluate(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      postMessage(...args) {if(args[0]?.kind==='parse')setTimeout(()=>super.postMessage(...args),450);else super.postMessage(...args);}
    };
  });
  await parse(page,raw('A'),2);
  await page.locator('#addCardBtn').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#rawInput').fill(raw('B'));
  await page.locator('#parseBtn').click();
  const card=cards(page).last();
  await expect(card).toHaveAttribute('aria-busy','true');
  await expect(card.locator('.card-status-label')).toHaveText('解析中');
  await expect(card.locator('.data-card-summary')).toBeHidden();
  await expect(card.locator('.card-status-dot')).toHaveCSS('animation-name','none');
  await expect(card).toHaveAttribute('aria-busy','false');
  await expect(card.locator('.card-status-label')).toHaveText('解析完成');
  await expect(card.locator('.data-card-summary')).toContainText('2 行');
  await page.locator('#formatSelect').selectOption('json');
  await page.locator('#rawInput').fill('{broken');
  await page.locator('#parseBtn').click();
  await expect(card.locator('.card-status-label')).toHaveText('解析失败');
  await expect(card).toHaveAttribute('aria-busy','false');
  await expect(card.locator('.card-status-dot')).toHaveAttribute('data-state','error');
  await expect(page.locator('#rawInput')).toHaveValue('{broken');
});
