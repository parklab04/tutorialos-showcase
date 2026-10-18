# Contributing to TutorialOS

Open issues and pull requests here in the public repository. A small reproducible bug is more useful than an unsupported claim that an entire app works.

## Develop and check

Use macOS 13+, Node.js 24+, and Xcode Command Line Tools. Run `npm ci`, `npm run build`, and `npm start`. Before a pull request, run `npm run check` plus the browser or Electron suites relevant to your change. Browser tests require Google Chrome. Finder and Safari desktop suites are listed in the README.

The repository is organized by feature:

- `src/features/`: React UI and shared feature contracts.
- `electron/features/`: desktop logic and validated IPC for the same feature.
- `electron/platform/`: shared placement, observer, and window infrastructure.
- `native/Sources/`: Swift observation and speech, with pure tests in `native/Tests/`.
- `tests/`: unit, native, browser, and Electron regression checks.

Renderer code accesses desktop features only through the preload bridge. Keep observations read-only. Do not add synthetic input, automatic calls, screenshot uploads, or hidden recording as a side effect of a fix. Missing, stale, disabled, or ambiguous targets must not become clickable guidance. UI copy stays in English, readable at larger text sizes, without internal scrolling in the guide.

## Report a bug

Include macOS and TutorialOS versions, the target app, the selected guide, the expected step, the observed step, and concise reproduction steps. Say whether the problem occurred with real app observations or a fixture. Include permission status as shown by the app. Remove names, contact details, file contents, and private URLs from screenshots. Never post an API key or a real call recording in an issue.

## Submit a change

Explain the trigger, resulting behavior, relevant tests, and what remains unverified. Add a regression test for a reproducible state transition defect. Do not report mocked observations as real app recognition or learner confirmation as AI-verified success.

Source is presently mirrored from a private development repository. A maintainer must first integrate an accepted public PR into the development source, then synchronize the matching change. The public mirror is not bidirectional; this step prevents a later export from reverting the contribution. Public discussion and credit stay attached to the public PR.

Contributions to TutorialOS-owned source use the project's MIT license. Retain notices and provenance for any third-party material.
