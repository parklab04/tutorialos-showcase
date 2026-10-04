import Foundation

@main
enum VoiceInputTests {
    static func main() {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            if !condition() { fatalError(message) }
        }
        var state = VoiceInputSession()
        expect(state.locale == "en-US" && state.phase == .idle, "English is the default and no audio starts on construction")
        expect(VoiceInputSession.validLocale("en-US") && VoiceInputSession.validLocale("ko-KR"), "English and Korean are explicitly supported locale choices")
        expect(!VoiceInputSession.validLocale("en") && !VoiceInputSession.validLocale("ja-JP"), "Unexpected locales are not silently substituted")
        let first = state.begin(locale: "en-US")
        expect(state.phase == .authorizing && state.transcript.isEmpty, "Starting creates a fresh authorization episode")
        state.cancel()
        state.listening(first)
        expect(state.phase == .cancelled && state.sessionID == nil, "Late permission success cannot start a cancelled session")
        expect(!state.receive("private cancelled speech", session: first), "Cancelled recognition callbacks are rejected")
        expect(state.transcript.isEmpty, "Cancellation clears all text")
        let second = state.begin(locale: "en-US")
        expect(second != first, "A fresh command has a distinct session identity")
        state.listening(second)
        expect(state.phase == .listening, "Authorized current session may listen")
        expect(state.receive("  Zoom in Safari  ", session: second), "Current partial speech is accepted")
        expect(state.transcript == "Zoom in Safari", "Whitespace is trimmed")
        expect(!state.receive("Zoom in Safari", session: second), "Duplicate partials do not prolong the silence timer")
        expect(!state.receive("old command", session: first), "Older session speech cannot replace a new command")
        state.finishing(second)
        expect(state.phase == .finishing, "Stopping leaves a bounded final-result phase")
        state.receive("Zoom in on Safari", session: second)
        state.finish(second)
        expect(state.phase == .final && state.transcript == "Zoom in on Safari", "Finishing preserves Apple's last transcription")
        expect(!state.receive("late rewritten command", session: second), "Finished text cannot be rewritten by late results")
        state.fail("recognition-failed", session: second)
        expect(state.phase == .final, "A late recognizer cancellation error cannot replace a final result")
        state.cancel()
        expect(state.transcript.isEmpty && state.error == nil, "Complete/cancel clears final text")
        let empty = state.begin(locale: "ko-KR")
        state.listening(empty)
        state.finishing(empty)
        state.finish(empty)
        expect(state.phase == .error && state.error == "no-speech", "Silence is an explicit failure, never a command")
        let denied = state.begin(locale: "en-US")
        state.fail("microphone-denied", session: denied)
        state.listening(denied)
        expect(state.phase == .error && state.transcript.isEmpty, "Denied authorization cannot enter recording")
        let setup = state.begin(locale: "en-US")
        state.authorized(setup)
        expect(state.phase == .idle && state.sessionID == nil, "Permission-only setup must not start a microphone session")
        let bounded = state.begin(locale: "en-US")
        state.listening(bounded)
        state.receive(String(repeating: "가", count: 3000), session: bounded)
        expect(state.transcript.count == 2000, "The native transcript is bounded by characters")
        state.fail("on-device-unavailable", session: bounded)
        expect(state.transcript.isEmpty && state.error == "on-device-unavailable", "Unavailable local speech never keeps or processes a command")
        print("\(checks) voice session lifecycle checks passed")
    }
}
