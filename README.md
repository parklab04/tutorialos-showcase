# TutorialOS

**An on-screen coach for adults learning to use their Mac.** A separate blue guide pointer shows where to click, with a short English instruction beside it. The learner operates the real app.

This is the **MIT-licensed application source**, including React, Electron, Swift, tests, and build configuration. It is an early prototype with prepared guides for three apps. It does not yet provide universal guidance for arbitrary apps or requests.

## Current scope

| App | Prepared guides in this source |
| --- | --- |
| Safari | Make text larger, use Reader, save a bookmark, reopen a closed tab |
| FaceTime | Mute/unmute, camera off/on, end an existing call |
| Finder | Find Downloads, create a folder, rename an item, Quick Look |

The source includes 11 curated guides. Five English voice goals cover FaceTime microphone/camera on or off and Safari zoom. Voice uses Apple on-device Speech; a typed request is also available. Review the request before choosing **Show me**. Complete on a goal session records the learner's confirmation, not an AI judgment.

The app reads macOS Accessibility information to locate controls. It never moves the user's pointer, clicks, types, or starts calls. Automatic help when supported apps open is optional. A missing or ambiguous control produces recovery guidance rather than a guessed target.

## Prototype status

Latest source: **0.1.29**. This update includes a cleaner guide chooser, three additional Finder guides, and a Safari bookmark fix that recovers when the learner reaches the Add sheet between observations.

The native observer, state engine, browser UI, and Electron integration have automated checks. Many checks use injected observations: they prove behavior under the supplied conditions, not recognition of a real app. **Real Finder recognition and a complete real-app journey on this exact version remain unverified.** FaceTime controls can hide or expose incomplete Accessibility information. The last separately recorded installed preview was 0.1.25.

[The concept walkthrough](./tutorialos-walkthrough.mp4) shows **simulated screens**, not live screen recognition. No notarized public installer is provided.

## Build on a Mac

Requirements: macOS 13+, Node.js 24+, and Xcode Command Line Tools. Packaging targets Apple Silicon.

```sh
git clone https://github.com/parklab04/tutorialos-showcase.git
cd tutorialos-showcase
npm ci
npm run build
npm start
```

Grant Accessibility to the app you actually run when you want live guidance. Voice input additionally needs Microphone and Speech Recognition access and available on-device English recognition. Grant permissions yourself through macOS. Rebuilt, ad-hoc-signed copies may need renewed permission. `npm run dev` previews the interface in a browser; native overlays and voice require Electron.

```sh
npm run check
npm run test:e2e:browser
npm run test:e2e:desktop
node tests/e2e/desktop/safari-guides.mjs
node tests/e2e/desktop/finder-guides.mjs
npm run package:mac
```

Browser checks currently use Google Chrome installed on the Mac. Desktop checks use isolated profiles and mocked native observations. Packaging produces `release/mac-arm64/HelpOS.app`; it does not install the app or grant access. The bundle retains the name HelpOS for its existing platform identity. Builds are ad-hoc signed, not notarized distribution releases.

## How it works

| Layer | Responsibility |
| --- | --- |
| React + TypeScript | Requests, guide chooser, accessible instruction bubble |
| Electron + Node.js | Desktop windows, lifecycle, permissions, native bridge |
| Swift | Read-only macOS Accessibility, app activation, on-device Speech |
| IPC + Zod | A narrow, validated boundary between the interface and desktop process |
| Guide engine | Match prepared steps against fresh observed controls; discard stale targets |

The core flow needs no AI API key. Optional text-only AI recommendations map a typed question to prepared lessons; they do not see the screen or execute actions.

## Contribute

Issues and pull requests are welcome **in this repository**. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, boundaries, and a useful bug report. [ROADMAP.md](./ROADMAP.md) separates current scope from the proposed path toward broader guidance.

Development currently happens in a private repository. Reviewed source and these public docs are exported here; private history, customer notes, presentation projects, and generated app binaries are excluded. Maintainers integrate public contributions into the development source before the next export, so the mirror does not overwrite accepted work. This is a temporary workflow, not an automatic bidirectional sync.

## License and attribution

TutorialOS-owned source is [MIT licensed](./LICENSE). The companion pointer adapts MIT-licensed code from [Clicky by Farza](https://github.com/farzaa/clicky); the [notice](./third_party/clicky/NOTICE.md), [license](./third_party/clicky/LICENSE), and pinned [provenance](./third_party/clicky/provenance.json) are included. Clicky's speech, screenshot upload, model service, and analytics are not imported. Dependencies retain their own licenses.
