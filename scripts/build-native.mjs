import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('native', { recursive: true });
const common = ['-O', '-module-cache-path', '/private/tmp/helpos-swift-cache'];
const sources = ['native/Sources/AppContext.swift', 'native/Sources/Support.swift', 'native/Sources/ScreenObserver.swift', 'native/Sources/FaceTimeCallDetector.swift', 'native/Sources/Observation.swift'];
for (const args of [
  [...common, 'native/Sources/AppContext.swift', 'native/Sources/AppWatcher.swift', '-o', 'native/helpos-app-watcher'],
  [...common, '-emit-library', '-module-name', 'HelpOSObserver', ...sources, 'native/Sources/NativeBridge.swift', 'native/Sources/VoiceInput.swift', '-framework', 'Speech', '-framework', 'AVFoundation', '-o', 'native/libhelpos-observer.dylib'],
  [...common, ...sources, 'native/Sources/main.swift', '-o', 'native/helpos-observer'],
]) {
  const result = spawnSync('swiftc', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The Swift watcher needs its own stable signature, without Electron JIT entitlements.
// electron-builder skips re-signing this child and seals it into the signed app.
const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'app.helpos.app-watcher', 'native/helpos-app-watcher'], { stdio: 'inherit' });
if (signed.status !== 0) process.exit(signed.status ?? 1);
