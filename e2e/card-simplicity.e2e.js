import {test, expect} from '@playwright/test';

const activeCard = page => page.locator('#cardList .data-card.active');
const transparent = 'rgba(0, 0, 0, 0)';

async function assertTwoRows(card) {
  const layout = await card.evaluate(root => {
    const rect = selector => root.querySelector(selector).getBoundingClientRect();
    const head = rect('.data-card-head'), title = rect('.data-card-title');
    const status = rect('.card-status-badge'), remove = rect('.card-remove');
    const summary = rect('.data-card-summary'), participation = rect('.card-participation');
    const badge = root.querySelector('.card-status-badge');
    return {
      statusInHeading:!!badge.closest('.data-card-head'),
      statusFits:badge.scrollWidth <= badge.clientWidth,
      statusBeforeDelete:status.right <= remove.left,
      nameBeforeStatus:title.right <= status.left,
      nameHasRoom:title.width >= 60,
      metadataOnSecondRow:summary.top >= head.bottom,
      participationOnSecondRow:participation.top >= head.bottom,
      metadataBeforeParticipation:summary.right <= participation.left,
      height:root.getBoundingClientRect().height,
    };
  });
  expect(layout).toEqual({
    statusInHeading:true, statusFits:true, statusBeforeDelete:true, nameBeforeStatus:true,
    nameHasRoom:true, metadataOnSecondRow:true, participationOnSecondRow:true,
    metadataBeforeParticipation:true, height:expect.any(Number),
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

test('轻量双行卡片移除重复装饰，正常状态安静，异常状态醒目且不挤压名称与参与开关', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
  const card = activeCard(page);
  await expect(card.locator('.card-source-symbol, .card-editing-badge')).toHaveCount(0);
  await assertQuietStatus(card);
  await page.locator('#rawInput').fill('[{"id":"1","name":"Alice"}]');
  await expect(card.locator('.card-status-label')).toHaveText('待解析');
  await assertQuietStatus(card);
  await page.locator('#parseBtn').click();
  await expect(card.locator('.card-status-label')).toHaveText('解析完成');
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
  await expect(page.locator('#sourceEditorLabel')).toHaveText(`当前编辑：${name}`);
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
      await expect(card.locator('.data-card-detail [data-card-act="visible"]')).toBeChecked();
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
