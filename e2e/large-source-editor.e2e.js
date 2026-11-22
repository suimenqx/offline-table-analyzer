import {test, expect} from '@playwright/test';

const rawText = page => page.evaluate(() => OTA.require('store').Store.getDocument().raw);
const revision = page => page.evaluate(() => OTA.require('store').Store.getDocument().sourceRevision);

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
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
