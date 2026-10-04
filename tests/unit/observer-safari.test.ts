import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeReader} from '../../electron/platform/native-observer';
import {parseObservation} from '../../electron/platform/observer';

const rect = {x: 100, y: 80, width: 900, height: 650};
const add = {id: 'ax-42', role: 'AXButton', label: 'Add', enabled: true,
  rect: {x: 650, y: 340, width: 80, height: 30}, scope: 'bookmark-sheet'};
const sample = {trusted: true, screenCapture: false, frontmostBundleId: 'com.apple.Safari',
  frontmostName: 'Safari', timestamp: Date.now(), source: 'accessibility', window: rect,
  windowId: '12:34', elements: [add]};

test('native JSON boundary preserves the validated bookmark-sheet scope', async () => {
  const calls: string[] = [];
  const read = createNativeReader((command, callback) => {
    calls.push(command);
    callback(null, JSON.stringify(sample));
  });
  const parsed = parseObservation(await read('--observe com.apple.Safari'));
  assert.deepEqual(calls, ['--observe com.apple.Safari']);
  assert.deepEqual(parsed.elements[0], add);
  assert.equal(parsed.elements[0].scope, 'bookmark-sheet');
  assert.equal(parsed.observedBundleId, undefined);
});

test('native observation parser rejects every unsupported sheet scope', () => {
  for (const scope of ['bookmark-dialog', 'bookmark-sheet-extra', '', null, true, 1, {}]) {
    assert.throws(() => parseObservation({...sample, elements: [{...add, scope}]}));
  }
  const {scope: _, ...unscoped} = add;
  assert.deepEqual(parseObservation({...sample, elements: [unscoped]}).elements[0], unscoped);
});

test('adding a sheet scope does not admit private fields or Safari background claims', () => {
  const parsed = parseObservation({...sample, pageTitle: 'Private page',
    elements: [{...add, bookmarkName: 'Private bookmark'}]});
  assert.equal('pageTitle' in parsed, false);
  assert.equal('bookmarkName' in parsed.elements[0], false);
  assert.throws(() => parseObservation({...sample, observedBundleId: 'com.apple.Safari'}));
});
