import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidePointerMode, type LiveState } from '../../src/features/live-guide/contracts';

const state: LiveState = {
  sessionId: 'guide', lessonId: 'facetime-mic', status: 'waiting-control', stepIndex: 0,
  title: 'Microphone is off', message: 'No click needed. Choose Complete.', why: '',
  target: null, contextWindow: { x: 100, y: 100, width: 700, height: 500 },
  observationSource: 'accessibility', verification: null,
  permission: { accessibility: true, screenCapture: false }, canComplete: true,
};

test('an already-satisfied goal never asks the learner to reveal or click a control', () => {
  assert.equal(guidePointerMode(state), null);
  assert.equal(guidePointerMode({ ...state, status: 'guiding', target: { x: 400, y: 450, width: 40, height: 40 }, message: 'Click the microphone.' }), 'pointing');
  assert.equal(guidePointerMode({ ...state, title: 'Show call buttons', message: 'Move pointer over FaceTime', canComplete: false }), 'following');
});

test('a known unavailable command uses its recovery coach without a searching companion', () => {
  assert.equal(guidePointerMode({ ...state, title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.', canComplete: false }), null);
});
