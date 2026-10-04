# Clicky attribution

TutorialOS adapts cursor-companion presentation from Clicky by Farza.

- Upstream: https://github.com/farzaa/clicky
- Pinned revision: `a80fa80721a8aebe51a170a7780705024ebc6e46`
- Source: `leanring-buddy/OverlayWindow.swift`
- License: MIT, Copyright (c) 2026 Farza; full text included in LICENSE.

The React/TypeScript adaptation uses the triangular pointer geometry, the offset
beside the user's cursor, and a distinct target-pointing presentation. Its
placement, session validation, reduced-motion handling, readable typography,
and target lifetime follow TutorialOS's own contracts. Electron supplies the
transparent click-through window; the SwiftUI implementation is not linked.

The integration does not import Clicky's speech, TTS, screenshot upload,
Cloudflare Worker, analytics, onboarding, or remote model services.
