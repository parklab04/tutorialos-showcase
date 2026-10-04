import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObservation } from '../../electron/platform/observer';

// Captures the native boundary shape observed in a real FaceTime call.
const switchControl = {
  id: 'ft-mic', role: 'AXCheckBox', subrole: 'AXSwitch',
  nativeIdentifier: 'toggleMicMenuButton', label: 'Microphone', value: '0',
  enabled: true, rect: { x: 708, y: 860.5, width: 36, height: 37.5 },
};
const observation = {
  trusted: true, screenCapture: false, frontmostBundleId: 'com.apple.FaceTime',
  frontmostName: 'FaceTime', timestamp: Date.now(), source: 'accessibility',
  observedBundleId: 'com.apple.FaceTime', windowId: 'ft-window',
  window: { x: 226, y: 498, width: 630, height: 420 },
  controlVisibility: { microphone: 'visible', camera: 'visible', end: 'visible' },
  elements: [switchControl],
};

test('production observation parser preserves neutral FaceTime switch identity and binary strings', () => {
  assert.deepEqual(parseObservation(observation).elements[0], switchControl);
  const camera = { ...switchControl, nativeIdentifier: 'toggleVideoButton', label: 'Camera', value: '1' };
  assert.deepEqual(parseObservation({ ...observation, elements: [camera] }).elements[0], camera);
});

test('production observation parser rejects unrelated native identifiers and subroles', () => {
  for (const extra of [{ nativeIdentifier: 'unknown' }, { subrole: 'AXToggle' }, { subrole: 1 }]) {
    assert.throws(() => parseObservation({ ...observation, elements: [{ ...switchControl, ...extra }] }));
  }
});

test('legacy controls need no switch metadata and unexpected native attributes are stripped', () => {
  const { nativeIdentifier, subrole, ...legacy } = switchControl;
  assert.deepEqual(parseObservation({ ...observation, elements: [{ ...legacy, privateText: 'not returned' }] }).elements[0], legacy);
});
