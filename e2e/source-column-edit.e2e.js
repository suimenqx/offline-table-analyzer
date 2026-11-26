import {test, expect} from '@playwright/test';

async function dragColumns(page, input, from, to, alt = true) {
  const layout = await input.evaluate(el => {
    const css = getComputedStyle(el), box = el.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = css.fontSize + ' ' + css.fontFamily;
    return {
      x:box.left + el.clientLeft + parseFloat(css.paddingLeft) - el.scrollLeft,
      y:box.top + el.clientTop + parseFloat(css.paddingTop) - el.scrollTop,
      width:ctx.measureText('0').width, height:parseFloat(css.lineHeight)
    };
  });
  const point = ([col,row]) => [layout.x + col * layout.width, layout.y + (row + .5) * layout.height];
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(...point(from));
  await page.mouse.down();
  await page.mouse.move(...point(to), {steps:3});
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

test.beforeEach(async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#autoParseToggle').uncheck();
});

test('reverse Alt drag edits a column across unequal lines and undo restores the block', async ({page}) => {
  const input = page.locator('#rawInput');
  const original = 'a11z\nb22y\nc\nd44w';
  await input.fill(original);
  await dragColumns(page, input, [3,3], [1,0]);
  await page.keyboard.type('OK');
  await expect(input).toHaveValue('aOKz\nbOKy\ncOK\ndOKw');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('aOz\nbOy\ncO\ndOw');
  await page.keyboard.press('Delete');
  await expect(input).toHaveValue('aO\nbO\ncO\ndO');
  await page.keyboard.press('Control+z');
  await expect(input).toHaveValue('aOz\nbOy\ncO\ndOw');
  expect(await page.evaluate(() => OTA.require('store').Store.getDocument().raw)).toBe(await input.inputValue());
  await dragColumns(page, input, [1,0], [2,1], false);
  await page.keyboard.type('!');
  await expect(input).toHaveValue('a!y\ncO\ndOw');
});

test('vertical carets edit a full-source draft until Escape and respect save and cancel', async ({page}) => {
  const input = page.locator('#rawInput'), draft = page.locator('#fullSourceInput');
  await input.fill('ab\ncd\nef');
  for (const save of [false, true]) {
    await page.locator('#editFullSourceBtn').click();
    await dragColumns(page, draft, [1,0], [1,2]);
    await page.keyboard.insertText('中');
    await expect(draft).toHaveValue('a中b\nc中d\ne中f');
    await draft.press('Escape');
    await expect(draft).toBeFocused();
    await expect(input).toHaveValue('ab\ncd\nef');
    await page.locator(save ? '#sourceEditorSaveBtn' : '#sourceEditorCancelBtn').click();
    await expect(input).toHaveValue(save ? 'a中b\nc中d\ne中f' : 'ab\ncd\nef');
  }
});

test('column copy, cut and plain-text paste use one slice per selected row', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const input = page.locator('#rawInput');
  await input.fill('a12z\nb34y\nc56x');
  await dragColumns(page, input, [1,0], [3,2]);
  await page.keyboard.press('Control+c');
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n','\n')).toBe('12\n34\n56');
  await page.keyboard.press('Control+x');
  await expect(input).toHaveValue('az\nby\ncx');
  await page.keyboard.press('Control+v');
  await expect(input).toHaveValue('a12z\nb34y\nc56x');
  await page.evaluate(() => navigator.clipboard.writeText('!'));
  await page.keyboard.press('Control+v');
  await expect(input).toHaveValue('a12!z\nb34!y\nc56!x');
});

test('scrolled and soft-wrapped selections follow visible rows', async ({page}) => {
  const input = page.locator('#rawInput'), draft = page.locator('#fullSourceInput');
  const line = 'a'.repeat(240);
  await input.fill((line + '\n').repeat(30));
  await input.evaluate(el => el.scrollTo(200, 200));
  await dragColumns(page, input, [35,12], [37,14]);
  await page.keyboard.type('X');
  const rows = (await input.inputValue()).split('\n');
  expect(rows.slice(12,15)).toEqual(Array(3).fill('a'.repeat(35) + 'X' + 'a'.repeat(203)));
  await page.locator('#editFullSourceBtn').click();
  await draft.fill(line);
  await page.locator('#sourceWrapToggle').check();
  await dragColumns(page, draft, [2,0], [4,1]);
  await page.keyboard.type('!');
  const result = await draft.inputValue();
  expect(result).toMatch(/^aa!a+!a+$/);
  expect(result.length).toBe(238);
  await draft.press('Control+z');
  await expect(draft).toHaveValue(line);
  await dragColumns(page, draft, [2,0], [4,1]);
  await page.setViewportSize({width:860, height:720});
  await page.keyboard.type('!');
  await expect(draft).toHaveValue(result);
});

test('keyboard column selection, Chinese IME commit and native undo form one source edit', async ({page}) => {
  const input = page.locator('#rawInput');
  await input.fill('a1\nb2\nc3');
  await input.press('Control+Home');
  await input.press('ArrowRight');
  await input.press('Alt+Shift+ArrowDown');
  await input.press('Alt+Shift+ArrowDown');
  const revision = () => page.evaluate(() => OTA.require('store').Store.getDocument().sourceRevision);
  const before = await revision();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {text:'zhong', selectionStart:5, selectionEnd:5});
  expect(await revision()).toBe(before);
  await cdp.send('Input.insertText', {text:'中'});
  await expect(input).toHaveValue('a中1\nb中2\nc中3');
  expect(await revision()).toBe(before + 1);
  await input.press('Control+z');
  await expect(input).toHaveValue('a1\nb2\nc3');
  await input.press('Control+y');
  await expect(input).toHaveValue('a中1\nb中2\nc中3');
});

test('block deletion skips short and empty lines and the highlights follow tab stops', async ({page}) => {
  const input = page.locator('#rawInput');
  await input.fill('first123Z\nb\n\n\t4Q');
  await dragColumns(page, input, [8,3], [5,0]);
  await expect(page.locator('.column-mark')).toHaveCount(1);
  await expect(page.locator('.column-caret')).toHaveCount(4);
  await page.keyboard.press('Backspace');
  // The tab ends at column eight. Nothing to its right is in the rectangle.
  await expect(input).toHaveValue('firstZ\nb\n\n\t4Q');
});

test('Alt selection shows a blinking caret on each row, including selected text', async ({page}) => {
  const input = page.locator('#rawInput');
  await input.fill('abc\ndef\nghi');
  await dragColumns(page, input, [2,2], [1,0]);
  const carets = page.locator('.column-caret');
  await expect(carets).toHaveCount(3);
  // Sample both phases of the actual CSS animation without a wall-clock delay.
  expect(await carets.evaluateAll(nodes => nodes.map(node => {
    const [blink] = node.getAnimations();
    if (!blink) return [];
    blink.pause();
    const duration = blink.effect.getTiming().duration;
    return [.1, .8].map(fraction => {
      blink.currentTime = duration * fraction;
      return getComputedStyle(node).opacity;
    });
  }))).toEqual(Array(3).fill(['1','0']));
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(carets.first()).toHaveCSS('opacity', '1');
});

for (const key of ['ArrowLeft', 'ArrowRight']) {
  test(`${key} collapses each row then moves all carets by one grapheme`, async ({page}) => {
    const input = page.locator('#rawInput');
    const rows = ['a12😀z','b34e\u0301y','c56👩‍💻x'];
    await input.fill(rows.join('\n'));
    await dragColumns(page, input, [3,2], [1,0]);
    await input.press(key);
    await input.press(key);
    await page.keyboard.insertText('!');
    await expect(input).toHaveValue(key === 'ArrowLeft' ? rows.map(s => '!' + s).join('\n') : 'a12😀!z\nb34e\u0301!y\nc56👩‍💻!x');
  });
}

test('undo and redo of a block deletion restore the rectangle and its carets', async ({page}) => {
  const input = page.locator('#rawInput');
  const original = 'a12z\nb34y\nc56x';
  await input.fill(original);
  await dragColumns(page, input, [3,2], [1,0]);
  await input.press('Delete');
  await expect(input).toHaveValue('az\nby\ncx');
  await input.press('Control+z');
  await expect(input).toHaveValue(original);
  await input.press('Control+y');
  await expect(input).toHaveValue('az\nby\ncx');
  await page.keyboard.insertText('!');
  await expect(input).toHaveValue('a!z\nb!y\nc!x');
  await input.press('Control+z');
  await input.press('Control+z');
  await page.keyboard.insertText('?');
  await expect(input).toHaveValue('a?z\nb?y\nc?x');
  expect(await page.evaluate(() => OTA.require('store').Store.getDocument().raw)).toBe(await input.inputValue());
});

test('vertical carets stay on short lines and scroll into view on long lines', async ({page}) => {
  const input = page.locator('#rawInput'), long = 'x'.repeat(100);
  await input.fill([long,'', 'y'].join('\n'));
  await dragColumns(page, input, [0,2], [0,0]);
  await input.press('ArrowLeft');
  for (let i = 0; i < 60; i++) await input.press('ArrowRight');
  expect(await input.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.insertText('!');
  await expect(input).toHaveValue(long.slice(0,60) + '!' + long.slice(60) + '\n!\ny!');
});

test('full-source draft can undo a whole rectangle when the native edit command is unavailable', async ({page}) => {
  const input = page.locator('#rawInput'), draft = page.locator('#fullSourceInput');
  const original = 'aa\nbb\ncc';
  await input.fill(original);
  await page.locator('#editFullSourceBtn').click();
  await page.evaluate(() => { document.execCommand = () => false; });
  await dragColumns(page, draft, [0,0], [2,2]);
  await draft.press('Backspace');
  await expect(draft).toHaveValue('\n\n');
  await draft.press('Control+z');
  await expect(draft).toHaveValue(original);
  await draft.press('Control+y');
  await expect(draft).toHaveValue('\n\n');
  await draft.press('Control+z');
  await page.keyboard.insertText('中');
  await expect(draft).toHaveValue('中\n中\n中');
  await expect(input).toHaveValue(original);
  await page.locator('#sourceEditorSaveBtn').click();
  await expect(input).toHaveValue('中\n中\n中');
});

test('a block edit that crosses the inline preview limit retains the complete source', async ({page}) => {
  const input = page.locator('#rawInput');
  const original = 'ab\n' + 'c'.repeat(512 * 1024 - 4);
  await input.fill(original);
  await input.press('Control+Home');
  await dragColumns(page, input, [0,0], [0,1]);
  await page.keyboard.insertText('中');
  await expect(input).toHaveJSProperty('readOnly', true);
  await dragColumns(page, input, [0,0], [1,1]);
  await page.keyboard.type('X');
  const stored = await page.evaluate(() => OTA.require('store').Store.getDocument().raw);
  expect(stored.length).toBe(original.length + 2);
  expect(stored).toBe('中ab\n中' + original.slice(3));
  await expect(page.locator('.column-overlay')).toHaveCount(0);
  await page.locator('#undoSourceEditBtn').click();
  await expect(input).toHaveJSProperty('readOnly', false);
  expect(await input.inputValue()).toBe(original);
});
