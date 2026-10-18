import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObservation } from '../../electron/platform/observer';

const sample = {
  trusted: true, screenCapture: false, frontmostBundleId: 'com.apple.finder',
  frontmostName: 'Finder', timestamp: Date.now(), source: 'accessibility',
  window: { x: 100, y: 80, width: 900, height: 650 }, windowId: '123:40',
  finderMenuContext: 'file',
  elements: [{ id: 'ax-4', role: 'AXMenuItem', label: 'New Folder', enabled: true,
    scope: 'finder-file-menu', rect: { x: 160, y: 80, width: 240, height: 24 } }],
};

test('Finder native menu scope and visibility survive the production JSON boundary', () => {
  for (const finderMenuContext of ['file', 'other', 'closed', 'unknown']) {
    const result = parseObservation({ ...sample, finderMenuContext });
    assert.equal(result.finderMenuContext, finderMenuContext);
    assert.equal(result.elements[0].scope, 'finder-file-menu');
    assert.equal(result.windowId, '123:40');
  }
});

test('Finder boundary rejects invalid scopes and unknown menu states', () => {
  for (const finderMenuContext of ['edit', 'visible', '', false, null, {}]) {
    assert.throws(() => parseObservation({ ...sample, finderMenuContext }));
  }
  for (const scope of ['finder', 'file-menu', 'finder-file-menu-extra']) {
    assert.throws(() => parseObservation({ ...sample, elements: [{ ...sample.elements[0], scope }] }));
  }
});

test('Finder boundary strips extraneous file data and cannot establish background observation', () => {
  const result = parseObservation({ ...sample, fileNames: ['private.txt'],
    elements: [{ ...sample.elements[0], fileName: 'private.txt' }] });
  assert.equal('fileNames' in result, false);
  assert.equal('fileName' in result.elements[0], false);
  assert.throws(() => parseObservation({ ...sample, observedBundleId: 'com.apple.finder' }));
});
