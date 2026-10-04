import AppKit

func runFaceTimeCallTests() {
    let callWindow = CGRect(x: -800, y: 70, width: 700, height: 500)
    func control(_ label: String, role: String = "AXButton", enabled: Bool = true, rect: CGRect = CGRect(x: -700, y: 450, width: 80, height: 30)) -> FaceTimeControl { FaceTimeControl(role: role, label: label, enabled: enabled, rect: rect) }
    func state(_ controls: [FaceTimeControl], complete: Bool = true, minimized: Bool = false) -> String { classifyFaceTimeWindow(FaceTimeWindowEvidence(rect: callWindow, controls: controls, complete: complete, minimized: minimized)) }
    assert(state([control("End Call"), control("Mute")]) == "active")
    assert(state([control("종료"), control("음소거 해제")]) == "active")
    assert(state([control("Hang Up"), control("Turn Camera On")]) == "active")
    assert(state([control("End Call")]) == "unknown")
    assert(state([control("Mute")]) == "unknown")
    assert(state([control("End", role: "AXStaticText"), control("Mute")]) == "unknown")
    assert(state([control("End Call", enabled: false), control("Mute")]) == "unknown")
    assert(state([control("End Call"), control("Mute")], complete: false) == "active")
    assert(state([control("End Call"), control("Mute")], minimized: true) == "unknown")
    assert(state([control("End Call"), control("Mute", rect: CGRect(x: 10, y: 50, width: 50, height: 30))]) == "unknown")
    assert(state([control("Call Ended", role: "AXStaticText")]) == "inactive")
    assert(state([control("New FaceTime"), control("Create Link")]) == "inactive")
    assert(state([control("New FaceTime"), control("Create Link"), control("End Call", enabled: false)]) == "unknown")
    assert(state([]) == "unknown")
    assert(uniqueFaceTimeWindowID(callWindow, candidates: [(42, callWindow)]) == 42)
    assert(uniqueFaceTimeWindowID(callWindow, candidates: [(42, callWindow), (43, callWindow)]) == nil)
    assert(uniqueFaceTimeWindowID(callWindow, candidates: [(42, CGRect(x: 0, y: 0, width: 700, height: 500))]) == nil)
    assert(state([control("Call Ended", role: "AXStaticText")], complete: false) == "unknown")
    assert(state([control("New FaceTime"), control("Create Link")], complete: false) == "unknown")
    let activeEvidence = FaceTimeWindowEvidence(rect: callWindow, controls: [control("End Call"), control("Mute")], complete: false, minimized: false)
    let unknownEvidence = FaceTimeWindowEvidence(rect: callWindow, controls: [], complete: false, minimized: false)
    let invalidEvidence = FaceTimeWindowEvidence(rect: .null, controls: [control("End Call"), control("Mute")], complete: true, minimized: false)
    let minimizedEvidence = FaceTimeWindowEvidence(rect: callWindow, controls: [control("End Call"), control("Mute")], complete: true, minimized: true)
    let inactiveEvidence = FaceTimeWindowEvidence(rect: callWindow, controls: [control("New FaceTime"), control("Create Link")], complete: true, minimized: false)
    assert(classifyFaceTimeWindow(invalidEvidence) == "unknown")
    assert(classifyFaceTimeWindows([activeEvidence, unknownEvidence]) == "active")
    assert(classifyFaceTimeWindows([activeEvidence, invalidEvidence]) == "active")
    assert(classifyFaceTimeWindows([activeEvidence, minimizedEvidence]) == "active")
    assert(classifyFaceTimeWindows([activeEvidence, activeEvidence]) == "unknown")
    assert(classifyFaceTimeWindows([inactiveEvidence, inactiveEvidence]) == "inactive")
    assert(classifyFaceTimeWindows([inactiveEvidence, unknownEvidence]) == "unknown")
    assert(classifyFaceTimeWindows([]) == "unknown")
    let target = CGRect(x: -700, y: 450, width: 80, height: 30)
    let call = FaceTimeScreenWindow(id: 42, pid: 10, rect: callWindow, alpha: 1)
    let cover = FaceTimeScreenWindow(id: 43, pid: 11, rect: target, alpha: 1)
    let displays = [CGRect(x: -1000, y: 0, width: 1000, height: 800)]
    func clear(_ stack: [FaceTimeScreenWindow], ignored: Set<pid_t> = [], rect: CGRect = target, frames: [CGRect] = displays) -> Bool {
        faceTimeControlIsClear(rect, callWindowID: 42, windows: stack, ignoredPIDs: ignored, displays: frames)
    }
    assert(clear([call]))
    assert(!clear([cover, call]))
    assert(clear([call, cover]))
    assert(!clear([cover, call], ignored: [11]))
    assert(clear([FaceTimeScreenWindow(id: 43, pid: 11, rect: target, alpha: 1, layer: Int(CGWindowLevelForKey(.popUpMenuWindow)) + 1), call], ignored: [11]))
    assert(clear([FaceTimeScreenWindow(id: 43, pid: 11, rect: target, alpha: 0), call]))
    assert(!clear([FaceTimeScreenWindow(id: 43, pid: 10, rect: target, alpha: 1), call]))
    assert(!clear([call], frames: []))
    assert(!clear([call], rect: CGRect(x: -1010, y: 450, width: 80, height: 30)))
    assert(!clear([cover]))
    assert(!clear([FaceTimeScreenWindow(id: 42, pid: 10, rect: callWindow, alpha: 0)]))
    assert(clear([FaceTimeScreenWindow(id: 43, pid: 11, rect: CGRect(x: -300, y: 50, width: 50, height: 50), alpha: 1), call]))
    assert(faceTimeControlKind(control("Unmute")) == "microphone")
    assert(faceTimeControlKind(control("Turn Camera On")) == "camera")
    assert(faceTimeControlKind(control("End Call")) == "end")
    assert(faceTimeControlKind(control("Camera")) == nil)
    assert(faceTimeControlKind(control("Mute", role: "AXStaticText")) == nil)
    let cameraRect = CGRect(x: -550, y: 450, width: 80, height: 30)
    let both = [control("Mute", rect: target), control("Turn Camera On", rect: cameraRect)]
    let visibility = faceTimeKindVisibility(both, callWindowID: 42, windows: [cover, call], ignoredPIDs: [], displays: displays)
    assert(visibility["microphone"] == "covered")
    assert(visibility["camera"] == "visible")
    assert(visibility["end"] == "missing")
    assert(faceTimeControlVisibility(target, callWindowID: 99, windows: [call], ignoredPIDs: [], displays: displays) == "missing")
    assert(faceTimeControlVisibility(target, callWindowID: 42, windows: [call], ignoredPIDs: [], displays: []) == "missing")
    assert(faceTimeKindVisibility([control("Camera")], callWindowID: 42, windows: [call], ignoredPIDs: [], displays: displays)["camera"] == "missing")
    assert(faceTimeKindVisibility([control("Unmute", rect: cameraRect)], callWindowID: 42, windows: [cover, call], ignoredPIDs: [], displays: displays)["microphone"] == "visible")
    var neutralChecks = 0
    func checkNeutral(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError(message) }
        neutralChecks += 1
    }
    let binaryFixtures: [(CFTypeRef, String)] = [(NSNumber(value: false), "0"), (NSNumber(value: true), "1"),
        (NSNumber(value: 0), "0"), (NSNumber(value: 1), "1"), (NSNumber(value: 0.0), "0"), (NSNumber(value: 1.0), "1"),
        ("0" as NSString, "0"), ("1" as NSString, "1")]
    for (raw, expected) in binaryFixtures {
        checkNeutral(faceTimeBinaryValue(raw) == expected, "Exact binary values must normalize without polarity claims")
    }
    let invalidFixtures: [CFTypeRef] = [NSNumber(value: 2), NSNumber(value: -1), NSNumber(value: 0.5), NSNumber(value: Double.nan), NSNumber(value: Double.infinity),
        "true" as NSString, "false" as NSString, "on" as NSString, "off" as NSString, "00" as NSString, "1 " as NSString, "" as NSString, NSNull()]
    for raw in invalidFixtures {
        checkNeutral(faceTimeBinaryValue(raw) == nil, "Mixed or unrecognized switch values must not become a binary state")
    }
    checkNeutral(faceTimeBinaryValue(nil) == nil, "Missing AXValue is not zero")
    func neutral(_ identifier: String = "toggleMicMenuButton", role: String = "AXCheckBox", subrole: String? = "AXSwitch", enabled: Bool = true, visible: Bool = true, rect: CGRect = target, value: CFTypeRef? = NSNumber(value: 0)) -> FaceTimeControl? {
        faceTimeNeutralControl(role: role, subrole: subrole, nativeIdentifier: identifier, enabled: enabled, visible: visible, rect: rect, rawValue: value)
    }
    let microphone = neutral()!
    let camera = neutral("toggleVideoButton", rect: cameraRect, value: "1" as NSString)!
    checkNeutral(microphone.label == "Microphone" && microphone.value == "0", "Microphone keeps a neutral name and raw binary position")
    checkNeutral(camera.label == "Camera" && camera.value == "1", "Camera keeps a neutral name and raw binary position")
    checkNeutral(state([control("End"), microphone]) == "active", "A validated modern microphone and End identify an active call")
    checkNeutral(state([control("End"), camera]) == "active", "A validated modern camera and End identify an active call")
    checkNeutral(state([control("End"), microphone], complete: false) == "active", "Valid sibling controls survive an unrelated hidden subtree")
    checkNeutral(state([microphone, camera]) == "unknown", "Media switches alone cannot establish an active call")
    checkNeutral(state([control("End"), microphone], minimized: true) == "unknown", "Minimized call controls are not current call evidence")
    checkNeutral(state([control("End"), neutral(rect: CGRect(x: 20, y: 20, width: 50, height: 30))!]) == "unknown", "Another window's switch cannot establish the call")
    checkNeutral(state([control("Call Ended", role: "AXStaticText"), microphone]) == "unknown", "A still-present modern switch blocks stale ended-call evidence")
    checkNeutral(neutral("unrelatedCamera") == nil, "Neutral labels need the exact native identifier")
    checkNeutral(neutral(role: "AXSwitch") == nil, "AXSwitch must not be accepted as a guessed role")
    checkNeutral(neutral(role: "AXStaticText") == nil, "A static label cannot impersonate a switch")
    checkNeutral(neutral(subrole: "AXToggle") == nil, "An unverified subrole must fail closed")
    checkNeutral(neutral(subrole: nil) == nil, "A missing subrole must fail closed")
    checkNeutral(neutral(enabled: false) == nil, "Disabled switches are not target evidence")
    checkNeutral(neutral(visible: false) == nil, "Neutral switches need positive visibility, not merely retained bounds")
    checkNeutral(neutral(rect: .null) == nil, "A switch needs real valid bounds")
    checkNeutral(neutral(value: NSNumber(value: 2)) == nil, "Mixed state cannot become neutral toggle evidence")
    checkNeutral(neutral(value: nil) == nil, "Missing value cannot become neutral toggle evidence")
    for identifier in ["toggleMicMenuButton", "toggleVideoButton"] {
        for role in ["AXCheckBox", "AXButton", "AXStaticText"] {
            checkNeutral(!faceTimeUsesLegacyLabels(role: role, nativeIdentifier: identifier), "Known switch IDs cannot fall through to legacy action text after any modern validation failure")
        }
    }
    checkNeutral(faceTimeUsesLegacyLabels(role: "AXCheckBox", nativeIdentifier: nil), "Unidentified legacy checkboxes retain their action labels")
    checkNeutral(faceTimeUsesLegacyLabels(role: "AXButton", nativeIdentifier: "leaveButton"), "The real End button retains its legacy action label")
    for identifier in ["toggleMicMenuButton", "toggleVideoButton"] {
        checkNeutral(!mayReadFaceTimeLegacyLabels(bundleIdentifier: "com.apple.FaceTime", nativeIdentifier: identifier), "Generic foreground fallback cannot reinterpret an identified FaceTime switch")
        checkNeutral(mayReadFaceTimeLegacyLabels(bundleIdentifier: "com.apple.Safari", nativeIdentifier: identifier), "FaceTime switch exclusions must not change Safari chrome recognition")
    }
    checkNeutral(mayReadFaceTimeLegacyLabels(bundleIdentifier: "com.apple.FaceTime", nativeIdentifier: nil), "Legacy FaceTime controls without the modern identifier remain available")
    checkNeutral(mayReadFaceTimeLegacyLabels(bundleIdentifier: "com.apple.FaceTime", nativeIdentifier: "leaveButton"), "Fallback still reads End and explicit ended-call evidence")
    checkNeutral(faceTimeControlKind(control("Microphone", role: "AXCheckBox")) == nil, "A neutral name alone is still rejected")
    let mismatched = FaceTimeControl(role: microphone.role, label: "Camera", enabled: true, rect: target,
        value: microphone.value, nativeIdentifier: microphone.nativeIdentifier, subrole: microphone.subrole)
    checkNeutral(faceTimeControlKind(mismatched) == nil, "Identifier and neutral kind must agree")
    let modernVisibility = faceTimeKindVisibility([microphone, camera], callWindowID: 42, windows: [cover, call], ignoredPIDs: [], displays: displays)
    checkNeutral(modernVisibility["microphone"] == "covered" && modernVisibility["camera"] == "visible", "Modern switches keep independent occlusion evidence")
    let emitted = faceTimeElementRecord(microphone, id: "facetime-0")
    checkNeutral(emitted["nativeIdentifier"] as? String == "toggleMicMenuButton" && emitted["subrole"] as? String == "AXSwitch", "Validated identifier and subrole survive native output")
    checkNeutral(emitted["label"] as? String == "Microphone" && emitted["value"] as? String == "0", "Native output never translates a binary position into mute polarity")
    let legacy = faceTimeElementRecord(control("Mute"), id: "facetime-1")
    checkNeutral(legacy["nativeIdentifier"] == nil && legacy["subrole"] == nil, "Legacy action labels do not gain switch privileges")
    print("\(neutralChecks) FaceTime neutral switch checks passed")
    print("7 FaceTime per-control visibility checks passed")
    print("17 FaceTime occlusion and control-kind checks passed")
    print("27 FaceTime control and window identity checks passed")
}
