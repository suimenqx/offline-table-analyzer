import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

const { OTA } = loadModules(['source-snapshot']);
const { SourceSnapshot } = OTA.require('source-snapshot');

beforeEach(() => SourceSnapshot.clear());

describe('SourceSnapshot', () => {
  it('keeps parser inputs intact while bounding diagnostic previews', () => {
    const plain = 'id,name\r\n1,Alice';
    const html = '<table><tr><td>Alice</td></tr></table>';
    const longRtf = 'x'.repeat(SourceSnapshot.PREVIEW_LIMIT + 1);
    const snapshot = SourceSnapshot.captureClipboard({
      docId: 'tab-a',
      plain,
      html,
      types: ['text/plain', 'text/html', 'text/rtf'],
      formats: [{ type: 'text/rtf', value: longRtf }],
    });

    assert.equal(snapshot.plain, plain);
    assert.equal(snapshot.html, html);
    assert.equal(snapshot.hasHtmlTable, true);
    const rtf = snapshot.formats.find(format => format.type === 'text/rtf');
    assert.equal(rtf.preview.length, SourceSnapshot.PREVIEW_LIMIT);
    assert.equal(rtf.truncated, true);
  });

  it('returns a snapshot only for its tab and normalized source text', () => {
    SourceSnapshot.captureClipboard({ docId: 'tab-a', plain: 'id,name\r\n1,Alice' });

    assert.ok(SourceSnapshot.getCurrentPaste({ docId: 'tab-a', text: 'id,name\n1,Alice' }));
    assert.equal(SourceSnapshot.getCurrentPaste({ docId: 'tab-b', text: 'id,name\n1,Alice' }), null);
    assert.equal(SourceSnapshot.getCurrentPaste({ docId: 'tab-a', text: 'id,name\n1,Bob' }), null);
  });

  it('captures file source metadata and clears the previous source', () => {
    const snapshot = SourceSnapshot.captureFile({
      docId: 'tab-a',
      fileName: 'table.html',
      text: '<table><tr><td>Alice</td></tr></table>',
      format: 'html-table',
    });

    assert.equal(snapshot.kind, 'file');
    assert.equal(snapshot.fileName, 'table.html');
    assert.equal(snapshot.html, snapshot.plain);
    assert.equal(SourceSnapshot.getLastPaste(), snapshot);
    SourceSnapshot.clear();
    assert.equal(SourceSnapshot.getLastPaste(), null);
  });
});
