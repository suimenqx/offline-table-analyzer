import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('Accessibility and responsive contract', () => {
  it('keeps dialog semantics, live status, and narrow-screen layout in the source artifact', () => {
    const template = fs.readFileSync(path.join(ROOT, 'src/templates/index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(ROOT, 'src/styles/styles.css'), 'utf8');
    assert.match(template, /role="dialog" aria-modal="true"/);
    assert.match(template, /id="analysisState" role="status" aria-live="polite"/);
    assert.match(template, /id="activeFilterChips"/);
    assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  });
});
