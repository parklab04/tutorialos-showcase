# Retired browser UI checks

These checks are preserved for the earlier Practice/AI Home interface. They are not part of the active voice-guidance demo suite and should only be run with the matching historical UI. No old test coverage was deleted.

Current coverage lives in `tests/e2e/browser/voice-guide.mjs`, `tests/e2e/browser/live-coach.mjs`, the active permission/call-help/overlay-origin checks, and `tests/e2e/desktop/voice-guide.mjs`. Active native guide suites retain actual preload/IPC/window checks with explicit observation fixtures. Retired Practice URLs and internal preview choices are checked to return to the current Home without opening a simulated scene.

Run current browser checks with `npm run test:e2e:browser`. The archived files are outside that runner's discovery directory. Desktop checks must be run one at a time with isolated profiles; do not use these historical files as evidence for the current installed app.
