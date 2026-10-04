// Explicit flags support a quiet manual launch and repeatable lifecycle tests.
// macOS login launches are identified through Electron's AppleEvent-derived flag.
export function isBackgroundLaunch(argv: readonly string[], wasOpenedAtLogin: boolean): boolean {
  return !argv.includes('--preview-call-help') && (wasOpenedAtLogin || argv.includes('--background'));
}
