import {test, expect} from '@playwright/test';

const rawText = page => page.evaluate(() => OTA.require('store').Store.getDocument().raw);
const revision = page => page.evaluate(() => OTA.require('store').Store.getDocument().sourceRevision);

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('原文输入框聚焦时边框保持原色，标题提示键盘焦点', async ({page}) => {
  const inline = page.locator('#rawInput');
  const draft = page.locator('#fullSourceInput');
  const frame = page.locator('.source-editor-body');
  const label = page.locator('#sourceEditorLabel');
  const title = page.locator('#sourceEditorTitle');
  const borderColor = node => getComputedStyle(node).borderTopColor;
  await page.emulateMedia({reducedMotion:'reduce'});
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#themeBtn').click();
    const inlineBorder = await inline.evaluate(borderColor);
    await inline.click();
    await expect(inline).toBeFocused();
    await expect(inline).toHaveCSS('border-top-color', inlineBorder);
    await expect(inline).toHaveCSS('outline-style', 'none');
    await expect(inline).toHaveCSS('box-shadow', 'none');
    await inline.fill('one\ntwo');
    await inline.press('Shift+Tab');
    await expect(label).toHaveCSS('text-decoration-line', 'none');
    await page.keyboard.press('Tab');
    await expect(inline).toBeFocused();
    await expect(label).toHaveCSS('text-decoration-line', 'underline');
    await page.getByRole('button', {name:'编辑完整原文', exact:true}).click();
    await draft.press('Shift+Tab');
    await expect(title).toHaveCSS('text-decoration-line', 'none');
    const frameBorder = await frame.evaluate(borderColor);
    await page.keyboard.press('Tab');
    await expect(draft).toBeFocused();
    await expect(frame).toHaveCSS('border-top-color', frameBorder);
    await expect(draft).toHaveCSS('outline-style', 'none');
    await expect(draft).toHaveCSS('box-shadow', 'none');
    await expect(title).toHaveCSS('text-decoration-line', 'underline');
    await draft.press('Escape');
  }
});

test('完整原文的行号随草稿、滚动和自动换行对齐', async ({page}) => {
  const editor = page.locator('#rawInput');
  const draft = page.locator('#fullSourceInput');
  const numbers = page.locator('#sourceLineNumbers');
  await editor.fill('one\n\nthree\n');
  const edit = page.getByRole('button', {name:'编辑完整原文', exact:true});
  await expect(edit.locator('svg')).toBeVisible();
  await edit.click();
  await expect(numbers).toHaveText('1\n2\n3\n4');
  const longLine = '长文本'.repeat(100);
  await draft.fill(longLine + '\nnext\n');
  await expect(numbers).toHaveText('1\n2\n3');
  await page.getByLabel('自动换行').check();
  const rows = () => numbers.textContent();
  await expect.poll(rows).toMatch(/^1\n\n+2\n3$/);
  const wideRows = (await rows()).split('\n').length;
  await page.setViewportSize({width:600, height:800});
  await expect.poll(async () => (await rows()).split('\n').length).toBeGreaterThan(wideRows);
  await draft.fill(longLine + '\n' + 'a data row with several ordinary text fields\n'.repeat(400));
  await draft.press('Control+End');
  await expect.poll(rows).toMatch(/\n402$/);
  expect((await rows()).split('\n').length).toBeLessThan(100);
  await page.getByLabel('自动换行').uncheck();
  await draft.press('Control+Home');
  await expect.poll(rows).toMatch(/^1\n2\n3\n/);
});

test('换行开关与查找并排，标题旁统一取消或保存草稿', async ({page}) => {
  await page.locator('#rawInput').fill('one\ntwo');
  const opener = page.getByRole('button', {name:'编辑完整原文', exact:true});
  await opener.click();
  const dialog = page.getByRole('dialog', {name:/编辑完整原文/});
  const cancel = dialog.getByRole('button', {name:'取消', exact:true});
  await expect(cancel).toHaveCount(1);
  const save = dialog.getByRole('button', {name:'保存原文', exact:true});
  await expect(save).toHaveCount(1);
  const tools = dialog.getByRole('group', {name:'原文编辑工具'});
  const wrap = tools.getByRole('switch', {name:'自动换行'});
  const summary = tools.locator('summary');
  const draft = dialog.getByRole('textbox', {name:'完整原文', exact:true});
  for (const [width, height] of [[2560, 1440], [1280, 720], [360, 720]]) {
    await page.setViewportSize({width, height});
    for (const expanded of [false, true]) {
      await expect(tools.locator('details')).toHaveJSProperty('open', expanded);
      const toggleBox = await wrap.boundingBox(), searchBox = await summary.boundingBox();
      const titleBox = await dialog.getByRole('heading').boundingBox();
      const cancelBox = await cancel.boundingBox(), saveBox = await save.boundingBox();
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(cancelBox.x);
      expect(cancelBox.x + cancelBox.width).toBeLessThan(saveBox.x);
      expect(cancelBox.y).toBe(saveBox.y);
      expect(saveBox.y + saveBox.height).toBeLessThan(searchBox.y);
      expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(width);
      if (expanded) {
        const replaceAll = await tools.getByRole('button', {name:'全部替换'}).boundingBox();
        expect(Math.abs(saveBox.x + saveBox.width - replaceAll.x - replaceAll.width)).toBeLessThan(2);
      }
      expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(searchBox.x);
      expect(Math.abs((toggleBox.y + toggleBox.height / 2) - (searchBox.y + searchBox.height / 2))).toBeLessThan(2);
      await wrap.focus();
      await page.keyboard.press('Space');
      await expect(wrap).toBeChecked({checked:!expanded});
      await expect(draft).toHaveJSProperty('wrap', expanded ? 'off' : 'soft');
      await expect(tools.locator('details')).toHaveJSProperty('open', expanded);
      await summary.click();
    }
  }
  await draft.fill('draft');
  await cancel.click();
  await expect(opener).toBeFocused();
  expect(await rawText(page)).toBe('one\ntwo');
});

test('查找、替换和跳转在桌面与窄屏上保持对齐', async ({page}) => {
  const editor = page.locator('#rawInput');
  await editor.fill('one\ntwo');
  await editor.press('Control+f');
  const panel = page.locator('#sourceEditorTools');
  for (const width of [1280, 360]) {
    await page.setViewportSize({width, height:800});
    const boxes = await panel.locator('input,button').evaluateAll(nodes => nodes.map(node => {
      const {x,y,height,width,right} = node.getBoundingClientRect();
      return {x,y,height,width,right};
    }));
    const [find,next,replace,current,all,line,jump] = boxes;
    expect(new Set(boxes.map(box => box.height)).size).toBe(1);
    expect(new Set([find,replace,line].map(box => box.x)).size).toBe(1);
    expect(new Set([find,replace,line].map(box => box.width)).size).toBe(1);
    expect(new Set([next,current,all,jump].map(box => box.width)).size).toBe(1);
    expect([next.y,current.y,all.y,jump.y]).toEqual([find.y,replace.y,replace.y,line.y]);
    expect(replace.y).toBeGreaterThan(find.y);
    expect(line.y).toBeGreaterThan(replace.y);
    expect(boxes.every(box => box.x >= 0 && box.right <= width)).toBe(true);
  }
});

test('普通粘贴可带着选区展开编辑、折行查看并保存，一次撤销恢复原文', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write'], {origin:'http://127.0.0.1:4173'});
  const editor = page.locator('#rawInput');
  const open = page.locator('#editFullSourceBtn');
  const dialog = page.locator('#sourceEditorDialog');
  const draft = page.locator('#fullSourceInput');
  const text = 'id,name\n1,alpha\n2,beta';
  await expect(open).toBeHidden();
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await editor.press('Control+v');
  await expect(editor).toHaveValue(text);
  const original = await rawText(page);
  const before = await revision(page);
  await editor.evaluate(node => node.setSelectionRange(10, 15, 'backward'));
  await expect(open).toBeVisible();
  await open.click();
  await expect(dialog).toHaveAccessibleName(/数据段 1/);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveJSProperty('selectionStart', 10);
  await expect(draft).toHaveJSProperty('selectionEnd', 15);
  await expect(draft).toHaveJSProperty('selectionDirection', 'backward');
  await dialog.getByLabel('自动换行').check();
  await expect(draft).toHaveCSS('white-space', 'pre-wrap');
  await expect(draft).toHaveValue(text);
  await draft.press('B');
  expect(await rawText(page)).toBe(original);
  await draft.press('Control+s');
  await expect(dialog).toBeHidden();
  await expect(editor).toHaveValue('id,name\n1,B\n2,beta');
  expect(await revision(page)).toBe(before + 1);
  await expect(editor).toHaveJSProperty('selectionStart', 11);
  await page.locator('#parseBtn').click();
  await expect(page.locator('#previewArea tbody')).toContainText('B');
  await page.locator('#undoSourceEditBtn').click();
  expect(await rawText(page)).toBe(original);
});

test('原文框快捷键查找选词、替换和跳行，取消后回到原选区', async ({page}) => {
  const editor = page.locator('#rawInput');
  const draft = page.locator('#fullSourceInput');
  const dialog = page.locator('#sourceEditorDialog');
  const text = 'id,name\n1,alpha\n2,alpha';
  await editor.fill(text);
  await editor.evaluate(node => node.setSelectionRange(10, 15));
  const before = await revision(page);
  await editor.press('Control+f');
  const find = page.locator('#sourceFindInput');
  await expect(find).toBeFocused();
  await expect(find).toHaveValue('alpha');
  await find.press('Enter');
  await expect(draft).toHaveJSProperty('selectionStart', 18);
  await draft.press('Escape');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveJSProperty('selectionStart', 10);
  await editor.press('Control+h');
  await expect(page.locator('#sourceReplaceInput')).toBeFocused();
  await page.locator('#sourceReplaceInput').fill('beta');
  await page.locator('#sourceReplaceAllBtn').click();
  await expect(draft).toHaveValue(text.replaceAll('alpha', 'beta'));
  await draft.press('Escape');
  await expect(editor).toBeFocused();
  await editor.press('Control+g');
  const line = page.locator('#sourceJumpLineInput');
  await expect(line).toBeFocused();
  await line.fill('3');
  await line.press('Enter');
  await expect(draft).toHaveJSProperty('selectionStart', 16);
  await draft.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await rawText(page)).toBe(text);
  expect(await revision(page)).toBe(before);
});

test('长行可以折行阅读，跳行后保存定位保持原文和修订号', async ({page}) => {
  const editor = page.locator('#rawInput');
  const draft = page.locator('#fullSourceInput');
  const text = 'a'.repeat(4000) + '\n' + 'row\n'.repeat(1000) + 'last';
  await editor.fill(text);
  const before = await revision(page);
  await editor.evaluate(node => node.setSelectionRange(0, 0));
  await page.locator('#editFullSourceBtn').click();
  expect(await draft.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByLabel('自动换行').check();
  expect(await draft.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await draft.press('Control+g');
  const line = page.locator('#sourceJumpLineInput');
  await line.fill('1002');
  await line.press('Enter');
  await expect(draft).toHaveJSProperty('selectionStart', text.length - 4);
  await expect.poll(() => draft.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 20)).toBe(true);
  await draft.press('Control+s');
  await expect(editor).toHaveJSProperty('selectionStart', text.length - 4);
  expect(await rawText(page)).toBe(text);
  expect(await revision(page)).toBe(before);
});

test('ordinary editing stays inline through 512 KiB; larger paste inserts at the caret and can be undone', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
  const editor=page.locator('#rawInput');
  const medium='m'.repeat(256*1024);
  await page.evaluate(text=>navigator.clipboard.writeText(text),medium);
  await editor.press('Control+V');
  await expect(editor).toHaveJSProperty('readOnly',false);
  expect((await rawText(page)).length).toBe(medium.length);

  const insertion='inserted-'.repeat(40*1024);
  const caret=120;
  await page.evaluate(text=>navigator.clipboard.writeText(text),insertion);
  await editor.evaluate((node,position)=>{node.focus();node.setSelectionRange(position,position);},caret);
  await editor.press('Control+V');
  const expected=medium.slice(0,caret)+insertion+medium.slice(caret);
  await expect(editor).toHaveJSProperty('readOnly',true);
  expect(await rawText(page)).toBe(expected);
  await expect(page.locator('#undoSourceEditBtn')).toBeVisible();
  await page.locator('#undoSourceEditBtn').click();
  await expect(editor).toHaveJSProperty('readOnly',false);
  expect(await rawText(page)).toBe(medium);
});

test('full-source editor opens the complete text, supports find/replace and line jump, and saves or cancels as one source edit', async ({page}) => {
  const large='id,name\n'+'1,alpha\n'.repeat(70000);
  await page.evaluate(source=>{
    OTA.require('dispatch').dispatch('source:replace',{text:source});
    OTA.require('source-controller').SourceController.displayText(source);
  },large);
  await expect(page.locator('#rawInput')).toHaveJSProperty('readOnly',true);
  const originalRevision=await revision(page);

  const open=page.locator('#editFullSourceBtn');
  await open.click();
  const dialog=page.locator('#sourceEditorDialog');
  const draft=page.locator('#fullSourceInput');
  await expect(dialog).toBeVisible();
  await expect(draft).toHaveValue(large);
  await draft.press('Control+f');
  await expect(page.locator('#sourceFindInput')).toBeFocused();
  await page.locator('#sourceFindInput').fill('1,alpha');
  await page.locator('#sourceFindNextBtn').click();
  await expect(draft).toHaveJSProperty('selectionStart',8);
  await page.locator('#sourceReplaceInput').fill('1,beta');
  await page.locator('#sourceReplaceCurrentBtn').click();
  await expect(draft).toHaveValue(`id,name\n1,beta\n${'1,alpha\n'.repeat(69999)}`);
  await page.locator('#sourceJumpLineInput').fill('70001');
  await page.locator('#sourceJumpBtn').click();
  const endPosition=await draft.evaluate(node=>node.selectionStart);
  expect(endPosition).toBeGreaterThan(large.length-12);
  await page.locator('#sourceEditorCancelBtn').click();
  await expect(dialog).toBeHidden();
  expect(await rawText(page)).toBe(large);
  expect(await revision(page)).toBe(originalRevision);
  await expect(open).toBeFocused();

  await open.click();
  await draft.press('Control+f');
  await page.locator('#sourceFindInput').fill('1,alpha');
  await page.locator('#sourceFindNextBtn').click();
  await page.locator('#sourceReplaceInput').fill('1,beta');
  await page.locator('#sourceReplaceCurrentBtn').click();
  await draft.press('Control+s');
  await expect(dialog).toBeHidden();
  expect(await revision(page)).toBe(originalRevision+1);
  expect(await rawText(page)).toBe(`id,name\n1,beta\n${'1,alpha\n'.repeat(69999)}`);
  await expect(page.locator('#undoSourceEditBtn')).toBeVisible();
  await page.locator('#undoSourceEditBtn').click();
  expect(await revision(page)).toBe(originalRevision+2);
  expect(await rawText(page)).toBe(large);

  await open.click();
  await draft.press('Control+h');
  await expect(page.locator('#sourceReplaceInput')).toBeFocused();
  await page.locator('#sourceFindInput').fill('1,alpha');
  await page.locator('#sourceReplaceInput').fill('1,beta');
  await page.locator('#sourceReplaceAllBtn').click();
  await expect(draft).toHaveValue(`id,name\n${'1,beta\n'.repeat(70000)}`);
  await page.locator('#sourceEditorCancelBtn').click();
  await expect(dialog).toBeHidden();
  expect(await rawText(page)).toBe(large);
  expect(await revision(page)).toBe(originalRevision+2);
});

test('saving an unchanged CRLF source preserves its exact original line endings and revision', async ({page}) => {
  const text='id,name\r\n'+'001,Alice\r\n'.repeat(50000);
  await page.evaluate(source=>{
    const dispatch=OTA.require('dispatch').dispatch;
    dispatch('source:replace',{text:source});
    OTA.require('source-controller').SourceController.displayText(source);
  },text);
  const before=await revision(page);
  await page.locator('#editFullSourceBtn').click();
  await expect(page.locator('#sourceEditorDialog')).toBeVisible();
  await page.locator('#sourceEditorSaveBtn').click();
  await expect(page.locator('#sourceEditorDialog')).toBeHidden();
  expect(await revision(page)).toBe(before);
  expect(await rawText(page)).toBe(text);
});
