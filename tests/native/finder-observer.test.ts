import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('native Finder observation scopes menu commands, removes filenames, and distinguishes closed/other/unknown menus', {skip: process.platform !== 'darwin', timeout: 45000}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'helpos-finder-test-'));
  try {
    const binary = path.join(directory, 'finder-tests');
    execFileSync('swiftc', ['-module-cache-path', '/private/tmp/helpos-swift-cache',
      'native/Sources/AppContext.swift', 'native/Sources/Support.swift', 'native/Sources/ScreenObserver.swift',
      'native/Sources/FaceTimeCallDetector.swift', 'native/Sources/Observation.swift',
      'native/Tests/FinderTests.swift', '-o', binary], {cwd: process.cwd(), timeout: 35000, stdio: 'pipe'});
    assert.match(execFileSync(binary, [], {encoding: 'utf8', timeout: 5000}), /\d+ Finder command, privacy, menu-context and identity checks passed/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
