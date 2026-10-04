import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('native app watcher deduplicates visits and accepts only real on-screen app windows', { skip: process.platform !== 'darwin', timeout: 45000 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'helpos-app-watcher-test-'));
  const binary = path.join(directory, 'app-watcher-tests');
  try {
    execFileSync('swiftc', ['-D', 'APP_WATCHER_TEST', '-module-cache-path', '/private/tmp/helpos-swift-cache', 'native/Sources/AppContext.swift', 'native/Sources/AppWatcher.swift', 'native/Tests/AppWatcherTests.swift', '-o', binary], { cwd: process.cwd(), timeout: 35000, stdio: 'pipe' });
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 5000 });
    assert.match(output, /180 app watcher episode and CG metadata checks passed/);
    const relativeArgvResult = spawnSync(binary, [], { argv0: 'Contents/MacOS/helpos-app-watcher', encoding: 'utf8', timeout: 5000 });
    assert.ifError(relativeArgvResult.error);
    assert.equal(relativeArgvResult.status, 0, relativeArgvResult.stderr);
    assert.equal(relativeArgvResult.signal, null);
    assert.match(relativeArgvResult.stdout, /180 app watcher episode and CG metadata checks passed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
