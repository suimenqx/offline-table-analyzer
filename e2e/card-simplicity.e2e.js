import {test, expect} from '@playwright/test';

const activeCard = page => page.locator('#cardList .data-card.active');
const transparent = 'rgba(0, 0, 0, 0)';

async function assertTwoRows(card) {
  const layout = await card.evaluate(root => {
    const rect = selector => root.querySelector(selector).getBoundingClientRect();
    const head = rect('.data-card-head'), title = rect('.data-card-title');
    const status = rect('.card-status-badge'), remove = rect('.card-remove');
    const visibility = rect('.card-visibility');
    const badge = root.querySelector('.card-status-badge');
    return {
      statusOnSecondRow:!!badge.closest('.data-card-detail') && status.top >= head.bottom,
      statusFits:badge.scrollWidth <= badge.clientWidth,
      visibilityBeforeDelete:visibility.right <= remove.left,
      nameBeforeVisibility:title.right <= visibility.left,
      nameHasRoom:title.width >= 60,
      visibilityInHeading:visibility.top >= head.top && visibility.bottom <= head.bottom,
      height:root.getBoundingClientRect().height,
    };
  });
  expect(layout).toEqual({
    statusOnSecondRow:true, statusFits:true, visibilityBeforeDelete:true, nameBeforeVisibility:true,
    nameHasRoom:true, visibilityInHeading:true, height:expect.any(Number),
  });
  expect(layout.height).toBeLessThan(90);
}

async function assertQuietStatus(card) {
  await expect(card.locator('.card-status-badge')).toHaveCSS('background-color', transparent);
  await expect(card.locator('.card-status-badge')).toHaveCSS('border-top-color', transparent);
}

async function assertAttentionStatus(card) {
  await expect(card.locator('.card-status-badge')).not.toHaveCSS('background-color', transparent);
  await expect(card.locator('.card-status-badge')).not.toHaveCSS('border-top-color', transparent);
}

test('轻量双行卡片移除重复装饰，正常状态安静，异常状态醒目且不挤压名称与眼睛按钮', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  const card = activeCard(page);
  await expect(card.locator('.card-source-symbol, .card-editing-badge')).toHaveCount(0);
  await assertQuietStatus(card);
  await page.locator('#rawInput').fill('[{"id":"1","name":"Alice"}]');
  await expect(card.locator('.card-status-label')).toHaveText('待解析');
  await assertQuietStatus(card);
  await page.locator('#parseBtn').click();
  await expect(card).toHaveAttribute('data-parse-state','ready');
  await expect(card.locator('.card-status-label')).toBeHidden();
  await expect(card.locator('.data-card-detail .data-card-summary')).toContainText('1 行');
  await assertQuietStatus(card);
  await card.focus();
  await card.press('F2');
  const name = '北京仓库订单明细与库存校验数据_2026_待复核';
  await page.getByRole('textbox', {name:'卡片名称'}).fill(name);
  await page.getByRole('textbox', {name:'卡片名称'}).press('Enter');
  await expect(card).toBeFocused();
  await expect(card.locator('.data-card-title')).toHaveText(name);
  await expect(card).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#sourceEditorLabel')).toHaveText(`原文 · ${name}`);
  await page.locator('#rawInput').fill('alpha,beta\none,two\nthree,four');
  await page.locator('#parseBtn').click();
  await expect(card.locator('.card-status-label')).toHaveText('待确认');
  await assertAttentionStatus(card);
  await expect(page.locator('#previewArea .parse-feedback-action')).toBeVisible();
  for(const width of [1440, 1024, 680]) {
    await page.setViewportSize({width, height:900});
    for(const theme of ['light', 'dark']) {
      if(await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeBtn').click();
      await assertTwoRows(card);
      await expect(card.locator('.card-status-label')).toHaveText('待确认');
      await expect(card.locator('.card-visibility')).toHaveAttribute('aria-pressed','true');
      await expect(card.locator('.data-card-title')).toHaveText(name);
    }
  }
  await page.locator('#formatSelect').selectOption('json');
  await page.locator('#rawInput').fill('{broken');
  await page.locator('#parseBtn').click();
  await expect(card.locator('.card-status-label')).toHaveText('解析失败');
  await assertAttentionStatus(card);
  await assertTwoRows(card);
  await expect(page.locator('#rawInput')).toHaveValue('{broken');
});
