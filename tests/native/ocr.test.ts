import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('native OCR extracts whole-token ranges and preserves negative display coordinates', { skip: process.platform !== 'darwin', timeout: 45000 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'helpos-ocr-test-'));
  const binary = path.join(directory, 'token-tests');
  try {
    execFileSync('swiftc', ['-D', 'TOKEN_MATCH_TEST', '-module-cache-path', '/private/tmp/helpos-swift-cache', 'native/Sources/AppContext.swift', 'native/Sources/Support.swift', 'native/Sources/ScreenObserver.swift', 'native/Sources/FaceTimeCallDetector.swift', 'native/Sources/Observation.swift', 'native/Sources/main.swift', 'native/Tests/OCRTests.swift', '-o', binary], { cwd: process.cwd(), timeout: 35000, stdio: 'pipe' });
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 5000 });
    assert.match(output, /9 OCR token and global geometry checks passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
