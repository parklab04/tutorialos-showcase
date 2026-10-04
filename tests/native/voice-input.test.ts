import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('native voice lifecycle rejects stale speech and never records during permission-only setup', { skip: process.platform !== 'darwin', timeout: 90000 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'helpos-voice-test-'));
  const binary = path.join(directory, 'voice-tests');
  try {
    execFileSync('swiftc', [
      '-module-cache-path', '/private/tmp/helpos-swift-cache',
      '-framework', 'Speech', '-framework', 'AVFoundation',
      'native/Sources/VoiceInput.swift', 'native/Tests/VoiceInputTests.swift', '-o', binary,
    ], { cwd: process.cwd(), timeout: 80000, stdio: 'pipe' });
    // Only pure session state is exercised. This test does not authorize Speech,
    // instantiate an AVAudioEngine, open a microphone, or request permissions.
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 5000 });
    assert.match(output, /23 voice session lifecycle checks passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
