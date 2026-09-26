import { after, describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import readExcelFile from 'read-excel-file/node';
import { createDOMSandbox } from '../mocks/dom.js';
import { createStorageMock } from '../mocks/storage.js';
import { loadModules } from '../helpers/load-modules.mjs';

const originalUrl = globalThis.URL;
const dom = createDOMSandbox();
const downloads = [];
globalThis.URL = {
  createObjectURL(blob) {
    downloads.push(blob);
    return `blob:test-${downloads.length}`;
  },
  revokeObjectURL() {},
};

const { OTA } = loadModules(['exporter'], {
  document: dom.document,
  window: dom.window,
  localStorage: createStorageMock(),
});
const { Exporter } = OTA.require('exporter');

after(() => {
  globalThis.URL = originalUrl;
});

describe('Exporter XLSX round-trip', () => {
  it('writes readable sheets, escaped text, numeric values, and text identifiers', async () => {
    Exporter.toExcel([
      {
        name: 'Orders',
        headers: ['OrderID', 'Status', 'Product', 'Count'],
        rows: [['0001', 'shipped', 'Widget & <A>', '12']],
      },
      {
        name: 'Orders',
        headers: ['Code'],
        rows: [['A-2']],
      },
      {
        name: 'Wide',
        headers: Array.from({ length: 27 }, (_, index) => `Column${index + 1}`),
        rows: [Array.from({ length: 27 }, (_, index) => `Value${index + 1}`)],
      },
    ], 'round trip');

    const [blob] = downloads;
    assert.ok(blob instanceof Blob);
    const sheets = await readExcelFile(Buffer.from(await blob.arrayBuffer()));

    assert.deepEqual(sheets.map(sheet => sheet.sheet), ['Orders', 'Orders_2', 'Wide']);
    assert.deepEqual(sheets[0].data, [
      ['OrderID', 'Status', 'Product', 'Count'],
      ['0001', 'shipped', 'Widget & <A>', 12],
    ]);
    assert.deepEqual(sheets[1].data, [['Code'], ['A-2']]);
    assert.equal(sheets[2].data[0][26], 'Column27');
    assert.equal(sheets[2].data[1][26], 'Value27');
  });
});
