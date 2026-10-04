import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('native Safari observation scopes bookmark actions and keeps document identity across menus', {skip: process.platform !== 'darwin', timeout: 45000}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'helpos-safari-test-'));
  const binary = path.join(directory, 'safari-tests');
  try {
    execFileSync('swiftc', ['-D', 'SAFARI_OBSERVER_TEST', '-module-cache-path', '/private/tmp/helpos-swift-cache',
      'native/Sources/AppContext.swift', 'native/Sources/Support.swift', 'native/Sources/ScreenObserver.swift',
      'native/Sources/FaceTimeCallDetector.swift', 'native/Sources/Observation.swift', 'native/Sources/main.swift',
      'native/Tests/SafariTests.swift', '-o', binary], {cwd: process.cwd(), timeout: 35000, stdio: 'pipe'});
    assert.match(execFileSync(binary, [], {encoding: 'utf8', timeout: 5000}), /54 Safari chrome, sheet and document identity checks passed/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
