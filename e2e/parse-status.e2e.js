import {test, expect} from '@playwright/test';

const activeCard = page => page.locator('#cardList .data-card.active');
const headerText = 'alpha,beta\none,two\nthree,four';
const formatTieText = 'id,name;state\n1,Alice;ok';
const irregularText = '报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束';

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('表头不确定时先显示表格，并可在预览区直接切换首行解释', async ({page}) => {
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('空');
  await page.locator('#rawInput').fill(headerText);
  await page.locator('#parseBtn').click();
  await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'ready');
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('解析完成');
  const notice = page.locator('#previewArea .parse-feedback');
  await expect(notice).toContainText('已显示表格，可调整首行解释');
  await expect(page.locator('#previewArea table')).toBeVisible();
  await expect(page.locator('#previewArea tbody')).toContainText('one');
  await notice.getByRole('button', {name:'首行作为数据'}).click();
  await expect(page.locator('#previewArea tbody tr').first()).toContainText('alpha');
  await expect(page.locator('#rawInput')).toHaveValue(headerText);
  await expect(page.locator('#sourceDiagnosticsBtn')).toHaveText('解析详情');
});

test('格式候选会产生不同结果时保留原文并提供就地预览选择', async ({page}) => {
  await page.locator('#rawInput').fill(formatTieText);
  await page.locator('#parseBtn').click();
  await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'confirm');
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('待确认');
  const notice = page.locator('#previewArea .parse-feedback');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('不同格式会产生不同列或单元格');
  await expect(notice.locator('.parse-feedback-candidate')).toHaveCount(2);
  await expect(page.locator('#previewArea table')).toHaveCount(0);
  await expect(page.locator('#rawInput')).toHaveValue(formatTieText);
  await notice.locator('.parse-feedback-candidates button').first().click();
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('解析完成');
  await expect(page.locator('#previewArea')).toContainText('Alice');
  await expect(page.locator('#rawInput')).toHaveValue(formatTieText);
});

test('多行小数保持完整时自动显示分号分列结果', async ({page}) => {
  const text = 'sku;price (EUR, incl. tax);tax (EUR, incl. fee)\n'
    + 'S-001;12,50;1,20\nS-002;9,90;0,99\nS-003;10,50;1,05';
  await page.locator('#rawInput').fill(text);
  await page.locator('#parseBtn').click();
  await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'ready');
  await expect(page.locator('#previewArea .parse-feedback-candidate')).toHaveCount(0);
  const firstPrice = page.locator('#previewArea tbody tr').filter({hasText:'S-001'});
  await expect(firstPrice.getByRole('cell')).toHaveText(['S-001','12,50','1,20']);
  await expect(page.locator('#rawInput')).toHaveValue(text);
});

test('列数不一致时保留溢出内容并提示用户检查', async ({page}) => {
  await page.locator('#rawInput').fill(irregularText);
  await page.locator('#parseBtn').click();
  await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'ready');
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('解析完成');
  const notice = page.locator('#previewArea .parse-feedback');
  await expect(notice).toContainText('列数不一致的内容已保留');
  await expect(page.locator('#previewArea table')).toBeVisible();
  await expect(page.locator('#previewArea')).toContainText('Alice');
  await expect(page.locator('#previewArea')).toContainText('fields');
  await expect(page.locator('#rawInput')).toHaveValue(irregularText);
});

test('从 validflag 开始的 CLI 选段保留多空格字段且不产生额外列', async ({page, context}) => {
  const text = 'validflag  ID     Name\n1          001    Alice\n1          002    Bob\n'
    + '1          003    Relay  Controller  Plus';
  const input = page.locator('#rawInput');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin:new URL(page.url()).origin});
  await input.click();
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await input.press('Control+V');
  await expect(input).toHaveValue(text);
  await page.locator('#parseBtn').click();
  await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'ready');
  await expect(page.locator('#formatSelect')).toHaveValue('auto');
  await expect(page.locator('#headerModeSelect')).toBeDisabled();
  const rows = page.locator('#previewArea tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole('cell')).toHaveText(['1','001','Alice']);
  await expect(rows.last().getByRole('cell')).toHaveText(['1','003','Relay  Controller  Plus']);
  await expect(page.locator('#previewArea .parse-feedback')).toHaveCount(0);
  await expect(input).toHaveValue(text);
});

test('候选详情可选查看，关闭后仍保留预览区的就地选择', async ({page}) => {
  await page.locator('#rawInput').fill(formatTieText);
  await page.locator('#parseBtn').click();
  const notice = page.locator('#previewArea .parse-feedback');
  const details = notice.getByRole('button', {name:'解析详情'});
  await details.click();
  await expect(page.getByRole('dialog', {name:'解析详情'})).toBeVisible();
  await page.locator('#modalCloseBtn').click();
  await expect(details).toBeFocused();
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('待确认');
  await expect(notice.locator('.parse-feedback-candidate')).toHaveCount(2);
  await expect(page.locator('#previewArea table')).toHaveCount(0);
});

test('候选卡片提示保留其他表池结果，并可定位尚未选择的另一张卡片', async ({page}) => {
  await page.locator('#rawInput').fill('[{"id":"1","name":"Alice"}]');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea tbody')).toContainText('Alice');
  await page.locator('#addCardBtn').click();
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(formatTieText);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea .parse-feedback-candidate')).toHaveCount(2);
  await page.locator('#cardList .data-card').first().click();
  const notice = page.locator('#previewArea .parse-feedback');
  await expect(page.locator('#previewArea tbody')).toContainText('Alice');
  const selectCard = notice.getByRole('button', {name:'选中卡片'});
  await expect(selectCard).toBeVisible();
  await selectCard.click();
  await expect(page.locator('#rawInput')).toHaveValue(formatTieText);
  await page.locator('#previewArea .parse-feedback-candidates button').first().click();
  await expect(page.locator('#previewArea .parse-feedback')).toHaveCount(0);
  await expect(page.locator('#previewArea .table-container')).toHaveCount(2);
  await expect(page.locator('#previewArea')).toContainText('Alice');
});

test('异常状态文字在明暗主题与窄屏中清晰可见', async ({page}) => {
  await page.locator('#rawInput').fill(formatTieText);
  await page.locator('#parseBtn').click();
  for(const width of [1440, 1024, 680]) {
    await page.setViewportSize({width, height:900});
    for(const theme of ['light', 'dark']) {
      if(await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeBtn').click();
      const geometry = await activeCard(page).locator('.card-status-badge').evaluate(node => ({
        width:node.clientWidth, content:node.scrollWidth, text:node.textContent,
      }));
      expect(geometry.text).toBe('待确认');
      expect(geometry.content).toBeLessThanOrEqual(geometry.width);
      await expect(page.locator('#previewArea .parse-feedback-candidates button').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
