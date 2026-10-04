# TutorialOS (HelpOS) | Sprint 1 build update

**A Mac learning companion that points to the next control while the learner does the task.** This is a public project update, not the source repository or a public app release. The current app bundle is still named HelpOS.app.

## The problem I'm exploring

When someone is learning an unfamiliar app, a search result or chatbot answer lives away from the screen where the task happens. The learner has to translate instructions back into buttons and menus. I'm starting with adults who want to become more confident using their Mac, including older adults. The specific buyer, urgency, and willingness to pay are **not validated yet**.

## What the preview does today

In the private Mac preview (v0.1.25), a learner can ask one of five supported English voice requests: FaceTime microphone/camera on or off, or making a Safari page larger. The app transcribes the request for review, brings the target app forward, and shows a blue guide pointer and small instruction bubble near an observed control. The learner clicks the real control and confirms completion. There is a typed-command fallback. It does **not** click for the user, interpret arbitrary requests with an LLM, or verify that the task succeeded. The current flow uses on-device speech recognition and a bounded local parser.

[Watch the 40-second concept walkthrough](./tutorialos-walkthrough.mp4). It uses **simulated screens**, not a recording of live screen recognition. Automated tests use injected observations; live microphone and FaceTime behavior in the installed build still need validation. The preview is not a notarized public release.

## What I need to learn next

So far I have discussed the idea with my fellowship pair, Aaron. That is **not** three to five customer interviews. Next I want to speak with learners and people who help them, identify one painful task, test whether the pointer actually reduces confusion, and learn who would pay. Feedback on the best first use case and what should be demonstrated in a real-user test is welcome.

