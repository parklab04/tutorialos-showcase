import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceGoal } from '../../electron/features/voice-guide/intent';

test('English demo requests resolve to a single explicit goal', () => {
  for (const [text, id] of [
    ['Please mute my microphone', 'mute'], ['I want to unmute my microphone', 'unmute'],
    ['Turn my mic back on', 'unmute'], ['Turn off my microphone in FaceTime', 'mute'],
    ['Un mute my microphone', 'unmute'], ['Please un-mute me', 'unmute'],
    ['Turn my camera off', 'camera-off'], ['Turn the camera on', 'camera-on'],
    ['Make the text bigger in Safari', 'zoom-in'], ['Zoom in', 'zoom-in'],
  ]) assert.equal(parseVoiceGoal(text).goal?.id, id, text);
});
test('unsupported, ambiguous, negated and compound requests never silently route', () => {
  for (const text of ['', "Don't mute my microphone", 'Mute and end the call', 'Mute my speakers',
    'Turn my camera off and send a message', 'Turn it off', 'Mute my microphone in Zoom meeting',
    'Turn my camera on in Safari', 'Zoom in on FaceTime', 'Mute or unmute', 'Open a new tab',
    'Mute my headphones', 'Send a message']) assert.equal(parseVoiceGoal(text).goal, null, text);
});
