import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { loadModules } from '../helpers/load-modules.mjs';

describe('loadModules test environment', () => {
  it('creates an independent module registry and Store singleton for each call', () => {
    const first = loadModules(['store']).OTA;
    const second = loadModules(['store']).OTA;

    assert.notEqual(first, second);
    assert.notEqual(first.require('store').Store, second.require('store').Store);
  });

  it('installs the registry on an injected window and checks requested module names', () => {
    const window = {};
    const { OTA } = loadModules(['store'], { window });

    assert.equal(window.OTA, OTA);
    assert.throws(() => loadModules(['missing-module']), /Unknown test module/);
  });
});
