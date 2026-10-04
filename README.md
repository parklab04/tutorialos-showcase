# TutorialOS (HelpOS) | Mac learning companion

**A Mac learning companion that points to the next control while the learner does the task.** This repository contains a filtered public snapshot of the application source and a Sprint 1 project update, not a public app release. The current app bundle is still named HelpOS.app.

## Source code, license, and updates

The application source is here in `src/`, `electron/`, `native/`, `scripts/`, `tests/`, and `public/`, with the build manifests and icons. The original development repository remains private. Its Git history, internal docs, presentation assets, demo-video project files, and release binaries are **not** mirrored here. This public repository keeps its own clean history and the concept video below.

TutorialOS-owned source is available under the [MIT License](./LICENSE). The pointer presentation adapts ideas from Clicky by Farza, licensed under MIT; see the preserved [Clicky notice](./third_party/clicky/NOTICE.md), [license](./third_party/clicky/LICENSE), and [provenance](./third_party/clicky/provenance.json). Dependencies retain their own licenses.

A guarded workflow in the private repository updates this filtered snapshot when allowlisted source files are committed to its `main` branch. It checks known private-path and credential patterns and pins the reviewed Clicky notices. These checks are not a substitute for reviewing new third-party code, claims, or sensitive content before a private-main push. Public README and video edits are maintained separately.

To build from source on macOS 13+ with Node.js 24+ and Xcode Command Line Tools:

```sh
npm ci
npm run build
npm start
```

The macOS preview is ad-hoc signed and not a notarized public release. Browser previews do not provide the native microphone and overlay behavior.

## The problem I'm exploring

When someone is learning an unfamiliar app, a search result or chatbot answer lives away from the screen where the task happens. The learner has to translate instructions back into buttons and menus. I'm starting with adults who want to become more confident using their Mac, including older adults. The specific buyer, urgency, and willingness to pay are **not validated yet**.

## What the preview does today

In the private Mac preview (v0.1.25), a learner can ask one of five supported English voice requests: FaceTime microphone/camera on or off, or making a Safari page larger. The app transcribes the request for review, brings the target app forward, and shows a blue guide pointer and small instruction bubble near an observed control. The learner clicks the real control and confirms completion. There is a typed-command fallback. It does **not** click for the user, interpret arbitrary requests with an LLM, or verify that the task succeeded. The current flow uses on-device speech recognition and a bounded local parser.

[Watch the 40-second concept walkthrough](./tutorialos-walkthrough.mp4). It uses **simulated screens**, not a recording of live screen recognition. Automated tests use injected observations; live microphone and FaceTime behavior in the installed build still need validation. The preview is not a notarized public release.

## What I need to learn next

So far I have discussed the idea with my fellowship pair, Aaron. That is **not** three to five customer interviews. Next I want to speak with learners and people who help them, identify one painful task, test whether the pointer actually reduces confusion, and learn who would pay. Feedback on the best first use case and what should be demonstrated in a real-user test is welcome.

