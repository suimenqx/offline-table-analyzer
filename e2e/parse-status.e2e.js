import {test, expect} from '@playwright/test';

const activeCard = page => page.locator('#cardList .data-card.active');
const headerText = 'alpha,beta\none,two\nthree,four';
const cases = [
  {name:'表头', text:headerText, value:'one'},
  {name:'格式', text:'id,name;state\n1,Alice;ok', value:'Alice'},
  {name:'表格区域', text:'报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束', value:'Alice'},
];

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

for(const {name, text, value} of cases) {
  test(`${name}待确认时明确说明未出表原因，可用键盘进入候选并完成解析`, async ({page}) => {
    await expect(activeCard(page).locator('.card-status-label')).toHaveText('空卡片');
    await page.locator('#rawInput').fill(text);
    await expect(activeCard(page).locator('.card-status-label')).toHaveText('待解析');
    await page.locator('#parseBtn').click();
    await expect(activeCard(page)).toHaveAttribute('data-parse-state', 'confirm');
    await expect(activeCard(page).locator('.card-status-label')).toHaveText('待确认');
    const notice = page.locator('#previewArea .parse-feedback');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('确认候选后才会显示这张卡片的表格');
    await expect(notice).toContainText('原文已保留');
    await expect(page.locator('#previewArea table')).toHaveCount(0);
    await expect(page.locator('#diagnosticsBtn')).toHaveText('确认候选');
    const action = notice.getByRole('button', {name:'查看并确认候选'});
    await action.focus();
    await action.press('Enter');
    await expect(page.getByRole('dialog', {name:'解析详情'})).toBeVisible();
    await page.locator('.diagnostic-candidate-btn').first().click();
    await expect(activeCard(page).locator('.card-status-label')).toHaveText('解析完成');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#parseBtn')).toBeFocused();
    await expect(page.locator('#previewArea')).toContainText(value);
    await expect(page.locator('#rawInput')).toHaveValue(text);
    await expect(page.locator('#diagnosticsBtn')).toHaveText('详情');
  });
}

test('关闭候选详情但不选择时回到确认入口，不擅自生成表格', async ({page}) => {
  await page.locator('#rawInput').fill(headerText);
  await page.locator('#parseBtn').click();
  const action = page.locator('.parse-feedback-action');
  await action.click();
  await page.locator('#modalCloseBtn').click();
  await expect(action).toBeFocused();
  await expect(activeCard(page).locator('.card-status-label')).toHaveText('待确认');
  await expect(page.locator('#previewArea table')).toHaveCount(0);
});

test('待确认提示保留其他表池结果，并能定位尚未确认的另一张卡片', async ({page}) => {
  await page.locator('#rawInput').fill('[{"id":"1","name":"Alice"}]');
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea tbody')).toContainText('Alice');
  await page.locator('#addCardBtn').click();
  await page.locator('#autoParseToggle').uncheck();
  await page.locator('#rawInput').fill(headerText);
  await page.locator('#parseBtn').click();
  const notice = page.locator('#previewArea .parse-feedback');
  await expect(notice).toBeVisible();
  await expect(page.locator('#previewArea tbody')).toContainText('Alice');
  await page.locator('#cardList .data-card').first().click();
  await expect(notice.getByRole('button', {name:'选中卡片并确认'})).toBeVisible();
  await notice.getByRole('button', {name:'选中卡片并确认'}).click();
  await expect(page.locator('#rawInput')).toHaveValue(headerText);
  await notice.getByRole('button', {name:'查看并确认候选'}).click();
  await page.locator('.diagnostic-candidate-btn').first().click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('#previewArea .table-container')).toHaveCount(2);
  await expect(page.locator('#previewArea')).toContainText('Alice');
  await expect(page.locator('#previewArea')).toContainText('one');
});

test('状态文字不靠颜色辨认，在明暗主题与窄屏中不被摘要挤掉', async ({page}) => {
  await page.locator('#rawInput').fill(headerText);
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
      await expect(page.locator('#previewArea .parse-feedback-action')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
