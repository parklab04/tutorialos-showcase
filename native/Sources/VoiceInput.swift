import Foundation
import AVFoundation
import Speech
import Darwin

// Speech and microphone state stay inside HelpOS. This file never writes audio
// or transcripts, and never permits the Speech framework's network fallback.
enum VoiceInputPhase: String, Codable {
    case idle, authorizing, listening, finishing, final, cancelled, error
}

struct VoiceInputSession {
    private(set) var phase: VoiceInputPhase = .idle
    private(set) var sessionID: String?
    private(set) var locale = "en-US"
    private(set) var transcript = ""
    private(set) var error: String?

    static func validLocale(_ locale: String) -> Bool { locale == "en-US" || locale == "ko-KR" }

    mutating func begin(locale: String) -> String {
        sessionID = UUID().uuidString
        self.locale = locale
        transcript = ""
        error = nil
        phase = .authorizing
        return sessionID!
    }

    func accepts(_ identifier: String, phases: [VoiceInputPhase]) -> Bool {
        sessionID == identifier && phases.contains(phase)
    }

    mutating func listening(_ identifier: String) {
        guard accepts(identifier, phases: [.authorizing]) else { return }
        phase = .listening
    }

    @discardableResult mutating func receive(_ text: String, session identifier: String) -> Bool {
        guard accepts(identifier, phases: [.listening, .finishing]) else { return false }
        let bounded = String(text.prefix(2000)).trimmingCharacters(in: .whitespacesAndNewlines)
        let changed = bounded != transcript
        transcript = bounded
        return changed
    }

    mutating func finishing(_ identifier: String) {
        guard accepts(identifier, phases: [.listening]) else { return }
        phase = .finishing
    }

    mutating func finish(_ identifier: String) {
        guard accepts(identifier, phases: [.listening, .finishing]) else { return }
        phase = transcript.isEmpty ? .error : .final
        error = transcript.isEmpty ? "no-speech" : nil
    }

    mutating func fail(_ code: String, session identifier: String? = nil) {
        if let identifier, !accepts(identifier, phases: [.authorizing, .listening, .finishing]) { return }
        phase = .error
        error = code
        transcript = ""
    }

    mutating func authorized(_ identifier: String) {
        guard accepts(identifier, phases: [.authorizing]) else { return }
        phase = .idle
        sessionID = nil
    }

    mutating func cancel() {
        sessionID = nil
        transcript = ""
        error = nil
        phase = .cancelled
    }
}

private struct VoiceInputSnapshot: Encodable {
    let phase: VoiceInputPhase
    let sessionId: String?
    let locale: String
    let transcript: String
    let error: String?
    let microphone: String
    let speech: String
    let onDeviceSupported: Bool
    let listening: Bool

    // Explicit nulls keep the C ABI schema stable for TypeScript validation.
    enum CodingKeys: String, CodingKey {
        case phase, sessionId, locale, transcript, error, microphone, speech, onDeviceSupported, listening
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(phase, forKey: .phase)
        try values.encode(sessionId, forKey: .sessionId)
        try values.encode(locale, forKey: .locale)
        try values.encode(transcript, forKey: .transcript)
        try values.encode(error, forKey: .error)
        try values.encode(microphone, forKey: .microphone)
        try values.encode(speech, forKey: .speech)
        try values.encode(onDeviceSupported, forKey: .onDeviceSupported)
        try values.encode(listening, forKey: .listening)
    }
}

// The AVAudioEngine tap runs on its own audio thread. Serialize append/endAudio
// so a final callback cannot append after cancellation closed this request.
private final class VoiceAudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    init(_ request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        request?.append(buffer)
    }
    func end() {
        lock.lock(); defer { lock.unlock() }
        request?.endAudio()
        request = nil
    }
}

// All controller methods and audio-engine lifecycle calls execute on main.
// Permission and recognition callbacks carry session IDs, so cancelling while
// an OS permission sheet is open can never start recording afterwards.
private final class VoiceInputController: @unchecked Sendable {
    private var session = VoiceInputSession()
    private var recognizers: [String: SFSpeechRecognizer] = [:]
    private var audioEngine: AVAudioEngine?
    private var sink: VoiceAudioSink?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var audioChangeObserver: NSObjectProtocol?
    private var deadline: DispatchWorkItem?
    private var silence: DispatchWorkItem?
    private var finishDeadline: DispatchWorkItem?
    private var authorizationDeadline: DispatchWorkItem?

    private func recognizer(for locale: String) -> SFSpeechRecognizer? {
        guard VoiceInputSession.validLocale(locale) else { return nil }
        if let existing = recognizers[locale] { return existing }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else { return nil }
        recognizer.queue = OperationQueue.main
        recognizers[locale] = recognizer
        return recognizer
    }

    func json(locale requestedLocale: String? = nil, error override: String? = nil) -> String {
        precondition(Thread.isMainThread)
        let locale = requestedLocale.flatMap { VoiceInputSession.validLocale($0) ? $0 : nil } ?? session.locale
        let snapshot = VoiceInputSnapshot(
            phase: override == nil ? session.phase : .error,
            sessionId: session.sessionID, locale: locale,
            transcript: override == nil ? session.transcript : "", error: override ?? session.error,
            microphone: Self.microphoneStatus(), speech: Self.speechStatus(),
            onDeviceSupported: recognizer(for: locale)?.supportsOnDeviceRecognition == true,
            listening: session.phase == .listening
        )
        guard let data = try? JSONEncoder().encode(snapshot), let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"voice-encoding-failed\"}"
        }
        return text
    }

    func start(locale: String, record: Bool) -> String {
        precondition(Thread.isMainThread)
        guard VoiceInputSession.validLocale(locale) else { return json(error: "unsupported-locale") }
        cancelResources()
        let identifier = session.begin(locale: locale)
        // Calling Apple's authorization API without either usage key can crash.
        guard Self.hasUsageDescription("NSSpeechRecognitionUsageDescription"),
              Self.hasUsageDescription("NSMicrophoneUsageDescription") else {
            session.fail("missing-usage-description", session: identifier)
            return json()
        }
        guard let recognizer = recognizer(for: locale), recognizer.supportsOnDeviceRecognition else {
            session.fail("on-device-unavailable", session: identifier)
            return json()
        }
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.session.accepts(identifier, phases: [.authorizing]) else { return }
            self.session.fail("authorization-timeout", session: identifier)
        }
        authorizationDeadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
        authorizeSpeech(identifier, record: record)
        return json()
    }

    private func authorizeSpeech(_ identifier: String, record: Bool) {
        guard session.accepts(identifier, phases: [.authorizing]) else { return }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: authorizeMicrophone(identifier, record: record)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { [weak self] _ in
                DispatchQueue.main.async { self?.authorizeSpeech(identifier, record: record) }
            }
        case .denied: fail("speech-denied", identifier)
        case .restricted: fail("speech-restricted", identifier)
        @unknown default: fail("speech-unavailable", identifier)
        }
    }

    private func authorizeMicrophone(_ identifier: String, record: Bool) {
        guard session.accepts(identifier, phases: [.authorizing]) else { return }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            authorizationDeadline?.cancel(); authorizationDeadline = nil
            if record { beginRecording(identifier) } else { session.authorized(identifier) }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] _ in
                DispatchQueue.main.async { self?.authorizeMicrophone(identifier, record: record) }
            }
        case .denied: fail("microphone-denied", identifier)
        case .restricted: fail("microphone-restricted", identifier)
        @unknown default: fail("microphone-unavailable", identifier)
        }
    }

    private func beginRecording(_ identifier: String) {
        guard session.accepts(identifier, phases: [.authorizing]) else { return }
        guard let recognizer = recognizer(for: session.locale), recognizer.supportsOnDeviceRecognition else {
            fail("on-device-unavailable", identifier); return
        }
        guard recognizer.isAvailable else { fail("recognizer-unavailable", identifier); return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        // Both conditions are required. Never relax this to a network request.
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .confirmation
        request.contextualStrings = ["FaceTime", "Safari", "Finder", "Downloads", "Reader"]
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
            fail("microphone-unavailable", identifier); return
        }
        let audioSink = VoiceAudioSink(request)
        audioEngine = engine
        sink = audioSink
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            audioSink.append(buffer)
        }
        tapInstalled = true
        session.listening(identifier)
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // Apple's callback queue is main, and the explicit hop also keeps
            // cleanup outside the recognizer's callback stack.
            DispatchQueue.main.async { self?.recognized(result, error: error, identifier: identifier) }
        }
        audioChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            guard let self, self.session.accepts(identifier, phases: [.listening]) else { return }
            self.fail("microphone-changed", identifier)
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            fail("microphone-start-failed", identifier)
            return
        }
        let timeout = DispatchWorkItem { [weak self] in self?.stopRecording(identifier) }
        deadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
    }

    private func recognized(_ result: SFSpeechRecognitionResult?, error: Error?, identifier: String) {
        guard session.accepts(identifier, phases: [.listening, .finishing]) else { return }
        if let result {
            let changed = session.receive(result.bestTranscription.formattedString, session: identifier)
            if result.isFinal { finish(identifier); return }
            if changed && !session.transcript.isEmpty && session.phase == .listening {
                silence?.cancel()
                let timeout = DispatchWorkItem { [weak self] in self?.stopRecording(identifier) }
                silence = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6, execute: timeout)
            }
        }
        if error != nil {
            if session.phase == .finishing && !session.transcript.isEmpty { finish(identifier) }
            else { fail("recognition-failed", identifier) }
        }
    }

    func stop() -> String {
        precondition(Thread.isMainThread)
        if let identifier = session.sessionID {
            if session.phase == .authorizing {
                cancelResources(); session.cancel()
            } else { stopRecording(identifier) }
        }
        return json()
    }

    private func stopRecording(_ identifier: String) {
        guard session.accepts(identifier, phases: [.listening]) else { return }
        session.finishing(identifier)
        stopAudio()
        task?.finish()
        let timeout = DispatchWorkItem { [weak self] in self?.finish(identifier) }
        finishDeadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: timeout)
    }

    private func finish(_ identifier: String) {
        guard session.accepts(identifier, phases: [.listening, .finishing]) else { return }
        session.finish(identifier)
        cancelResources()
    }

    private func fail(_ code: String, _ identifier: String) {
        guard session.accepts(identifier, phases: [.authorizing, .listening, .finishing]) else { return }
        session.fail(code, session: identifier)
        cancelResources()
    }

    func cancel() -> String {
        precondition(Thread.isMainThread)
        // Invalidate callbacks before touching the recognizer/audio resources.
        session.cancel()
        cancelResources()
        return json()
    }

    private func stopAudio() {
        deadline?.cancel(); deadline = nil
        silence?.cancel(); silence = nil
        if let observer = audioChangeObserver {
            NotificationCenter.default.removeObserver(observer)
            audioChangeObserver = nil
        }
        audioEngine?.stop()
        if tapInstalled { audioEngine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
        sink?.end(); sink = nil
        audioEngine = nil
    }

    private func cancelResources() {
        authorizationDeadline?.cancel(); authorizationDeadline = nil
        finishDeadline?.cancel(); finishDeadline = nil
        stopAudio()
        task?.cancel(); task = nil
    }

    private static func hasUsageDescription(_ name: String) -> Bool {
        guard let text = Bundle.main.object(forInfoDictionaryKey: name) as? String else { return false }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private static func microphoneStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .notDetermined: return "not-determined"
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "restricted"
        }
    }
    private static func speechStatus() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined: return "not-determined"
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "restricted"
        }
    }
}

private let voiceInputController = VoiceInputController()

// Call every entry point with Koffi .async. A worker waits while AppKit's main
// queue owns the engine. Permission sheets/results remain asynchronous, so no
// C call waits for a user response or an utterance to finish.
private func voiceInputOnMain(_ action: @escaping () -> String) -> UnsafeMutablePointer<CChar>? {
    guard !Thread.isMainThread else { return strdup("{\"error\":\"voice-requires-worker\"}") }
    return strdup(DispatchQueue.main.sync(execute: action))
}

@_cdecl("helpos_voice_start")
public func helposVoiceStart(_ locale: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let value = locale.map { String(cString: $0) } ?? "en-US"
    return voiceInputOnMain { voiceInputController.start(locale: value, record: true) }
}

@_cdecl("helpos_voice_authorize")
public func helposVoiceAuthorize(_ locale: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let value = locale.map { String(cString: $0) } ?? "en-US"
    return voiceInputOnMain { voiceInputController.start(locale: value, record: false) }
}

@_cdecl("helpos_voice_status")
public func helposVoiceStatus(_ locale: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let value = locale.map { String(cString: $0) } ?? "en-US"
    return voiceInputOnMain {
        voiceInputController.json(locale: value, error: VoiceInputSession.validLocale(value) ? nil : "unsupported-locale")
    }
}

@_cdecl("helpos_voice_poll")
public func helposVoicePoll() -> UnsafeMutablePointer<CChar>? {
    voiceInputOnMain { voiceInputController.json() }
}

@_cdecl("helpos_voice_stop")
public func helposVoiceStop() -> UnsafeMutablePointer<CChar>? {
    voiceInputOnMain { voiceInputController.stop() }
}

@_cdecl("helpos_voice_cancel")
public func helposVoiceCancel() -> UnsafeMutablePointer<CChar>? {
    voiceInputOnMain { voiceInputController.cancel() }
}

@_cdecl("helpos_voice_free")
public func helposVoiceFree(_ pointer: UnsafeMutableRawPointer?) { free(pointer) }
