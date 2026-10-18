# Toward guidance across more apps

The goal is one understandable interaction: ask for help, see the next control, act yourself, and confirm the outcome. Today the implementation uses 11 prepared guides for Safari, FaceTime, and Finder. Arbitrary-app guidance is not shipped.

## Next: reliable real-app evidence

Freeze one build and validate a complete Safari journey on that exact installation. Record app/OS version, permission state, correct target, transition, and learner-confirmed outcome. Repeat with Finder and an already joined FaceTime call. Keep deterministic fixture checks and real-app results separate.

## Then: shared recipes over observed controls

Move app-specific role, scope, label, window identity, and transition rules into explicit recipes over a common Accessibility candidate representation. Preserve freshness, visibility, enabled-state, ambiguity, and window matching checks. The Safari bookmark catch-up fix illustrates why a guide must resynchronize to observed state when a learner moves faster than a polling interval.

This should make new supported tasks cheaper to add. It does not make unknown apps supported automatically.

## Experiment: one unfamiliar app

Prototype one explicitly requested next-step suggestion in an app without a prepared guide. Try Accessibility evidence first. A vision fallback would require explicit capture consent, a clear data destination, current-window identity, response freshness checks, and refusal to point when evidence is insufficient. It is a separate proposed experiment, not part of today's source.

Success criteria: a correctly grounded next control, the learner performs the action, and the learner can recover when a target cannot be identified. Do not equate menu disappearance or a model's confidence with task completion. Automatic clicking and typing remain outside the current product scope.

## Learn from people

Test whether people can finish one unfamiliar task and repeat it with less help. Observe wrong clicks, requests for clarification, recovery, and whether the result actually matches their intent. Validate the buyer, repeat need, and pricing separately; no subscription model is assumed validated.
