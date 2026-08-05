import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { createDOMSandbox } from '../mocks/dom.js';
import { loadModules } from '../helpers/load-modules.mjs';

const dom = createDOMSandbox();
const { OTA } = loadModules(['table-builder'], { document: dom.document, window: dom.window });
const { TableBuilder } = OTA.require('table-builder');

describe('TableBuilder multiline cells', () => {
  it('marks multiline cells so the preview preserves visual line breaks', () => {
    const table = TableBuilder.buildColumnHeaderTable(
      { name: 'Notes' },
      { headers: ['id', 'note'], rows: [{ d: ['1', 'first\nsecond'], _readOnly: true }] },
      0,
      {},
      null,
      null
    );
    const noteCell = table.children[1].children[0].children[1];
    assert.equal(noteCell.textContent, 'first\nsecond');
    assert.equal(noteCell.classList.contains('multiline-cell'), true);
  });

  it('does not add multiline styling to ordinary cells', () => {
    const table = TableBuilder.buildColumnHeaderTable(
      { name: 'Values' },
      { headers: ['id', 'value'], rows: [{ d: ['1', 'single line'], _readOnly: true }] },
      0,
      {},
      null,
      null
    );
    const valueCell = table.children[1].children[0].children[1];
    assert.equal(valueCell.classList.contains('multiline-cell'), false);
  });
});
