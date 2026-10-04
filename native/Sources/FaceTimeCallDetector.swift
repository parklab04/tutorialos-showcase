import AppKit
import ApplicationServices

// Background FaceTime detection uses AX metadata only, never screen pixels.
struct FaceTimeControl {
    let role: String
    let label: String
    let enabled: Bool
    let rect: CGRect
    var value: String? = nil
    var nativeIdentifier: String? = nil
    var subrole: String? = nil
}
struct FaceTimeWindowEvidence {
    let rect: CGRect
    let controls: [FaceTimeControl]
    let complete: Bool
    let minimized: Bool
}
let faceTimeControlRoles: Set<String> = ["AXButton", "AXCheckBox", "AXToggleButton"]
let faceTimeEndLabels: Set<String> = ["end", "end call", "hang up", "종료", "통화 종료", "통화 끝내기"]
let faceTimeMicrophoneLabels: Set<String> = ["mute", "mute audio", "mute microphone", "unmute", "unmute audio", "unmute microphone", "음소거", "오디오 음소거", "마이크 끄기", "음소거 해제", "오디오 음소거 해제", "마이크 켜기"]
let faceTimeCameraLabels: Set<String> = ["turn camera off", "camera off", "stop video", "turn camera on", "camera on", "start video", "카메라 끄기", "비디오 끄기", "비디오 중단", "카메라 켜기", "비디오 켜기", "비디오 시작"]
let faceTimeMediaLabels = faceTimeMicrophoneLabels.union(faceTimeCameraLabels)
let faceTimeEndedLabels: Set<String> = ["call ended", "call has ended", "통화가 종료되었습니다", "통화가 종료됨"]
let faceTimeNewLabels: Set<String> = ["new facetime", "new call", "새로운 facetime", "새로운 통화"]
let faceTimeLinkLabels: Set<String> = ["create link", "링크 생성"]
func faceTimeLabel(_ label: String) -> String {
    label.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "…", with: "").lowercased()
}
func finiteRect(_ rect: CGRect) -> Bool {
    [rect.minX, rect.minY, rect.width, rect.height].allSatisfy { $0.isFinite } && abs(rect.minX) < 40000 && abs(rect.minY) < 40000 && rect.width >= 3 && rect.height >= 3 && rect.width < 12000 && rect.height < 12000
}
// These identifiers identify FaceTime's modern neutral controls. AXSwitch is
// a subrole; a generic Camera/Microphone label is not enough to identify one.
func faceTimeHasNeutralIdentifier(_ identifier: String?) -> Bool {
    identifier == "toggleMicMenuButton" || identifier == "toggleVideoButton"
}
func mayReadFaceTimeLegacyLabels(bundleIdentifier: String?, nativeIdentifier: String?) -> Bool {
    bundleIdentifier != "com.apple.FaceTime" || !faceTimeHasNeutralIdentifier(nativeIdentifier)
}
func faceTimeUsesLegacyLabels(role: String, nativeIdentifier: String?) -> Bool {
    // An identified switch that fails validation must not regain a target via
    // a legacy action in AXHelp/AXDescription, even if its role has changed.
    mayReadFaceTimeLegacyLabels(bundleIdentifier: "com.apple.FaceTime", nativeIdentifier: nativeIdentifier) && (faceTimeControlRoles.contains(role) || role == "AXStaticText")
}
func faceTimeNeutralKind(role: String, subrole: String?, nativeIdentifier: String?) -> String? {
    guard role == "AXCheckBox", subrole == "AXSwitch" else { return nil }
    switch nativeIdentifier {
    case "toggleMicMenuButton": return "microphone"
    case "toggleVideoButton": return "camera"
    default: return nil
    }
}
func faceTimeBinaryValue(_ value: CFTypeRef?) -> String? {
    // This is a binary position, not a mute/camera-on interpretation. Mixed,
    // missing and non-binary values cannot provide a toggle transition.
    if let number = value as? NSNumber {
        if number.doubleValue == 0 { return "0" }
        if number.doubleValue == 1 { return "1" }
        return nil
    }
    if let string = value as? String, ["0", "1"].contains(string) { return string }
    return nil
}
func faceTimeNeutralControl(role: String, subrole: String?, nativeIdentifier: String?, enabled: Bool, visible: Bool, rect: CGRect, rawValue: CFTypeRef?) -> FaceTimeControl? {
    guard enabled, visible, finiteRect(rect), let kind = faceTimeNeutralKind(role: role, subrole: subrole, nativeIdentifier: nativeIdentifier),
          let value = faceTimeBinaryValue(rawValue) else { return nil }
    return FaceTimeControl(role: role, label: kind == "microphone" ? "Microphone" : "Camera", enabled: true,
                           rect: rect, value: value, nativeIdentifier: nativeIdentifier, subrole: subrole)
}
func faceTimeValidatedNeutralKind(_ control: FaceTimeControl) -> String? {
    guard control.enabled, ["0", "1"].contains(control.value ?? ""),
          let kind = faceTimeNeutralKind(role: control.role, subrole: control.subrole, nativeIdentifier: control.nativeIdentifier),
          control.label == (kind == "microphone" ? "Microphone" : "Camera") else { return nil }
    return kind
}
func faceTimeElementRecord(_ control: FaceTimeControl, id: String) -> [String: Any] {
    var record: [String: Any] = ["id": id, "role": control.role, "label": control.label, "enabled": control.enabled, "rect": dict(control.rect)]
    if let value = control.value { record["value"] = value }
    if faceTimeValidatedNeutralKind(control) != nil {
        record["nativeIdentifier"] = control.nativeIdentifier
        record["subrole"] = control.subrole
    }
    return record
}
func classifyFaceTimeWindow(_ window: FaceTimeWindowEvidence) -> String {
    guard !window.minimized, finiteRect(window.rect) else { return "unknown" }
    let controls = window.controls.filter { finiteRect($0.rect) && window.rect.insetBy(dx: -2, dy: -2).contains($0.rect) }
    let buttons = controls.filter { faceTimeControlRoles.contains($0.role) }
    let enabled = Set(buttons.filter { $0.enabled }.map { faceTimeLabel($0.label) })
    let allButtons = Set(buttons.map { faceTimeLabel($0.label) })
    let enabledKinds = Set(buttons.compactMap(faceTimeControlKind))
    if enabledKinds.contains("end") && !enabledKinds.isDisjoint(with: ["microphone", "camera"]) { return "active" }
    // Positive call controls remain evidence when an unrelated subtree is unreadable.
    // Only a complete traversal can establish negative call evidence.
    guard window.complete else { return "unknown" }
    // A disabled or partially exposed call toolbar is not evidence of an ended call.
    if !allButtons.isDisjoint(with: faceTimeEndLabels.union(faceTimeMediaLabels)) || buttons.contains(where: { faceTimeNeutralKind(role: $0.role, subrole: $0.subrole, nativeIdentifier: $0.nativeIdentifier) != nil }) { return "unknown" }
    let ended = controls.contains { $0.role == "AXStaticText" && faceTimeEndedLabels.contains(faceTimeLabel($0.label)) }
    let lobby = !enabled.isDisjoint(with: faceTimeNewLabels) && !enabled.isDisjoint(with: faceTimeLinkLabels)
    return ended || lobby ? "inactive" : "unknown"
}
func classifyFaceTimeWindows(_ windows: [FaceTimeWindowEvidence]) -> String {
    let states = windows.map(classifyFaceTimeWindow)
    let activeCount = states.filter { $0 == "active" }.count
    if activeCount == 1 { return "active" }
    return activeCount == 0 && !states.isEmpty && states.allSatisfy { $0 == "inactive" } ? "inactive" : "unknown"
}
func uniqueFaceTimeWindowID(_ rect: CGRect, candidates: [(CGWindowID, CGRect)]) -> CGWindowID? {
    let matching = candidates.filter { abs($0.1.minX - rect.minX) <= 2 && abs($0.1.minY - rect.minY) <= 2 && abs($0.1.width - rect.width) <= 2 && abs($0.1.height - rect.height) <= 2 }
    return matching.count == 1 ? matching[0].0 : nil
}
// CGWindowList returns windows from front to back. Only metadata is read;
// no FaceTime pixels or other applications' accessibility contents are captured.
struct FaceTimeScreenWindow {
    let id: CGWindowID
    let pid: pid_t
    let rect: CGRect
    let alpha: Double
    var layer: Int = 0
}
func faceTimeScreenWindows() -> [FaceTimeScreenWindow]? {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    var windows: [FaceTimeScreenWindow] = []
    for row in rows {
        guard let pid = row[kCGWindowOwnerPID as String] as? NSNumber,
              let id = row[kCGWindowNumber as String] as? NSNumber,
              let bounds = row[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }),
              rect.width >= 0, rect.height >= 0 else { return nil }
        windows.append(FaceTimeScreenWindow(id: id.uint32Value, pid: pid.int32Value, rect: rect, alpha: (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1, layer: (row[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0))
    }
    return windows
}
func faceTimeDisplayFrames() -> [CGRect] {
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(32, &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}
func faceTimeControlVisibility(_ rect: CGRect, callWindowID: CGWindowID, windows: [FaceTimeScreenWindow], ignoredPIDs: Set<pid_t>, displays: [CGRect]) -> String {
    guard finiteRect(rect), displays.contains(where: { $0.contains(rect) }),
          let index = windows.firstIndex(where: { $0.id == callWindowID }),
          windows[index].alpha > 0, windows[index].rect.insetBy(dx: -2, dy: -2).contains(rect) else { return "missing" }
    // Must match electron/features/live-guide/windows.ts: only the
    // click-through dim layer uses pop-up-menu +1. Coach/home remain blockers.
    let overlayLayer = Int(CGWindowLevelForKey(.popUpMenuWindow)) + 1
    let covered = windows.prefix(index).contains { window in
        let isOwnOverlay = ignoredPIDs.contains(window.pid) && window.layer == overlayLayer
        return !isOwnOverlay && window.alpha > 0 && window.rect.intersects(rect)
    }
    return covered ? "covered" : "visible"
}
func faceTimeControlIsClear(_ rect: CGRect, callWindowID: CGWindowID, windows: [FaceTimeScreenWindow], ignoredPIDs: Set<pid_t>, displays: [CGRect]) -> Bool {
    faceTimeControlVisibility(rect, callWindowID: callWindowID, windows: windows, ignoredPIDs: ignoredPIDs, displays: displays) == "visible"
}
func faceTimeControlKind(_ control: FaceTimeControl) -> String? {
    guard control.enabled, faceTimeControlRoles.contains(control.role) else { return nil }
    if let kind = faceTimeValidatedNeutralKind(control) { return kind }
    let label = faceTimeLabel(control.label)
    if faceTimeMicrophoneLabels.contains(label) { return "microphone" }
    if faceTimeCameraLabels.contains(label) { return "camera" }
    if faceTimeEndLabels.contains(label) { return "end" }
    return nil
}
func faceTimeKindVisibility(_ controls: [FaceTimeControl], callWindowID: CGWindowID, windows: [FaceTimeScreenWindow], ignoredPIDs: Set<pid_t>, displays: [CGRect]) -> [String: String] {
    var result = ["microphone": "missing", "camera": "missing", "end": "missing"]
    for control in controls {
        guard let kind = faceTimeControlKind(control) else { continue }
        let status = faceTimeControlVisibility(control.rect, callWindowID: callWindowID, windows: windows, ignoredPIDs: ignoredPIDs, displays: displays)
        if status == "visible" || (status == "covered" && result[kind] != "visible") { result[kind] = status }
    }
    return result
}
func faceTimeCallObservation(includeElements: Bool = false) -> [String: Any] {
    let accessibility = AXIsProcessTrusted()
    func result(_ state: String, window: CGRect? = nil, callId: String? = nil, controls: [[String: Any]] = [], elements: [[String: Any]] = [], observed: Bool = false, occluded: Bool = false, visibility: [String: String] = ["microphone": "missing", "camera": "missing", "end": "missing"]) -> [String: Any] {
        let stillTrusted = accessibility && AXIsProcessTrusted()
        var output: [String: Any] = ["accessibility": stillTrusted, "state": stillTrusted ? state : "unknown", "callId": stillTrusted ? (callId as Any? ?? NSNull()) : NSNull(), "window": stillTrusted ? (window.map(dict) as Any? ?? NSNull()) : NSNull(), "timestamp": Date().timeIntervalSince1970 * 1000]
        if stillTrusted && state == "active" {
            output["controls"] = controls
            output["controlVisibility"] = visibility
            if includeElements {
                output["elements"] = elements
                output["occluded"] = occluded
                if observed { output["observedBundleId"] = "com.apple.FaceTime" }
            }
        }
        return output
    }
    guard accessibility, !Task.isCancelled else { return result("unknown") }
    let applications = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.FaceTime").filter { !$0.isTerminated }
    if applications.isEmpty { return result("inactive") }
    guard applications.count == 1, let application = applications.first else { return result("unknown") }
    let root = AXUIElementCreateApplication(application.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.05)
    var rawWindows: CFTypeRef?
    guard AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &rawWindows) == .success, let windows = rawWindows as? [AXUIElement] else { return result("unknown") }
    if windows.isEmpty { return result(application.isTerminated ? "unknown" : "inactive") }
    guard windows.count <= 8 else { return result("unknown") }
    let originalScreenWindows = faceTimeScreenWindows()
    let started = ProcessInfo.processInfo.systemUptime
    let knownLabels = faceTimeEndLabels.union(faceTimeMediaLabels).union(faceTimeEndedLabels).union(faceTimeNewLabels).union(faceTimeLinkLabels)
    var visited = 0
    var evidence: [FaceTimeWindowEvidence] = []
    for window in windows {
        var complete = true
        var controls: [FaceTimeControl] = []
        func read(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            guard !Task.isCancelled, ProcessInfo.processInfo.systemUptime - started < 0.9 else { complete = false; return nil }
            var value: CFTypeRef?
            let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
            if [.cannotComplete, .failure, .apiDisabled, .invalidUIElement].contains(error) { complete = false }
            return error == .success ? value : nil
        }
        func bounds(_ element: AXUIElement) -> CGRect? {
            guard let position = read(element, kAXPositionAttribute), let size = read(element, kAXSizeAttribute), CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
            var point = CGPoint.zero; var dimensions = CGSize.zero
            guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
            let rect = CGRect(origin: point, size: dimensions)
            return finiteRect(rect) ? rect : nil
        }
        func walk(_ element: AXUIElement, depth: Int) {
            guard !Task.isCancelled, depth <= 13, visited < 650, ProcessInfo.processInfo.systemUptime - started < 0.9 else { complete = false; return }
            visited += 1
            AXUIElementSetMessagingTimeout(element, 0.05)
            guard let role = read(element, kAXRoleAttribute) as? String else { complete = false; return }
            // Contact lists, typed text, and web content are not needed for call state.
            if ["AXWebArea", "AXTextArea", "AXTextField", "AXSecureTextField", "AXTable", "AXOutline", "AXList"].contains(role) { return }
            if (read(element, "AXHidden") as? Bool) == true { complete = false; return }
            let identifier = (faceTimeControlRoles.contains(role) || role == "AXStaticText") ? read(element, kAXIdentifierAttribute) as? String : nil
            if faceTimeHasNeutralIdentifier(identifier), let rect = bounds(element) {
                let neutral = faceTimeNeutralControl(role: role, subrole: read(element, kAXSubroleAttribute) as? String,
                    nativeIdentifier: identifier, enabled: (read(element, kAXEnabledAttribute) as? Bool) == true,
                    visible: (read(element, "AXVisible") as? Bool) == true,
                    rect: rect, rawValue: read(element, kAXValueAttribute))
                if let neutral { controls.append(neutral) }
            }
            if faceTimeUsesLegacyLabels(role: role, nativeIdentifier: identifier) {
                let names = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] + (role == "AXStaticText" ? [kAXValueAttribute] : [])
                for name in names {
                    if let text = read(element, name) as? String, knownLabels.contains(faceTimeLabel(text)), let rect = bounds(element) {
                        controls.append(FaceTimeControl(role: role, label: text, enabled: (read(element, kAXEnabledAttribute) as? Bool) == true, rect: rect, value: numberOrBool(read(element, kAXValueAttribute))))
                        break
                    }
                }
            }
            if let children = read(element, kAXChildrenAttribute) as? [AXUIElement] { for child in children { walk(child, depth: depth + 1) } }
        }
        AXUIElementSetMessagingTimeout(window, 0.05)
        guard let rect = bounds(window) else {
            evidence.append(FaceTimeWindowEvidence(rect: .null, controls: [], complete: false, minimized: false))
            continue
        }
        let minimized = (read(window, kAXMinimizedAttribute) as? Bool) == true
        if !minimized { walk(window, depth: 0) }
        evidence.append(FaceTimeWindowEvidence(rect: rect, controls: controls, complete: complete, minimized: minimized))
    }
    guard !Task.isCancelled, !application.isTerminated else { return result("unknown") }
    let state = classifyFaceTimeWindows(evidence)
    if state == "active", let window = evidence.first(where: { classifyFaceTimeWindow($0) == "active" }) {
        let screenWindows = faceTimeScreenWindows()
        let candidates = screenWindows?.filter { $0.pid == application.processIdentifier }.map { ($0.id, $0.rect) } ?? []
        let identifier = uniqueFaceTimeWindowID(window.rect, candidates: candidates)
        let originalCandidates = originalScreenWindows?.filter { $0.pid == application.processIdentifier }.map { ($0.id, $0.rect) } ?? []
        let originalIdentifier = uniqueFaceTimeWindowID(window.rect, candidates: originalCandidates)
        guard !Task.isCancelled, !application.isTerminated else { return result("unknown") }
        guard let identifier, originalIdentifier == identifier, let screenWindows else {
            return result("active", window: window.rect, occluded: true)
        }
        let displays = faceTimeDisplayFrames()
        // In the app, this is the HelpOS main PID. The extra bundle match also
        // identifies its overlay when running the diagnostic helper separately.
        let ignoredPIDs = Set([getpid()] + NSRunningApplication.runningApplications(withBundleIdentifier: "app.helpos.desktop").map { $0.processIdentifier })
        let relevant = window.controls.filter { control in
            finiteRect(control.rect) && window.rect.insetBy(dx: -2, dy: -2).contains(control.rect)
        }
        let visibility = faceTimeKindVisibility(relevant, callWindowID: identifier, windows: screenWindows, ignoredPIDs: ignoredPIDs, displays: displays)
        let clear = relevant.filter { faceTimeControlIsClear($0.rect, callWindowID: identifier, windows: screenWindows, ignoredPIDs: ignoredPIDs, displays: displays) }
        let occluded = relevant.contains { faceTimeControlKind($0) != nil && !faceTimeControlIsClear($0.rect, callWindowID: identifier, windows: screenWindows, ignoredPIDs: ignoredPIDs, displays: displays) }
        var elements: [[String: Any]] = []
        var choices: [[String: Any]] = []
        for control in clear {
            elements.append(faceTimeElementRecord(control, id: "facetime-\(elements.count)"))
            if let kind = faceTimeControlKind(control), !choices.contains(where: { ($0["kind"] as? String) == kind }) {
                let sameKind = clear.filter { faceTimeControlKind($0) == kind }
                let distinct = sameKind.reduce(into: [CGRect]()) { rectangles, item in
                    if !rectangles.contains(where: { abs($0.minX - item.rect.minX) < 2 && abs($0.minY - item.rect.minY) < 2 && abs($0.width - item.rect.width) < 3 && abs($0.height - item.rect.height) < 3 }) { rectangles.append(item.rect) }
                }
                if distinct.count == 1 { choices.append(["kind": kind, "rect": dict(control.rect)]) }
            }
        }
        return result("active", window: window.rect, callId: "\(application.processIdentifier):\(identifier)", controls: choices, elements: elements, observed: true, occluded: occluded, visibility: visibility)
    }
    return result(state)
}
