import AppKit
import ApplicationServices
import Darwin

// Explicit diagnostic only; not included in production builds. Never return
// contact labels, arbitrary AX text, CG window titles, or screen pixels.
private let diagnosticLabels = Set(allowedLabels.map(faceTimeLabel))
    .union(faceTimeNewLabels).union(faceTimeLinkLabels)
    .union(["camera", "microphone", "audio", "video", "mute button", "unmute button", "toggle microphone", "toggle camera", "pause video", "resume video", "turn microphone off", "turn microphone on", "카메라", "마이크", "오디오", "비디오", "effects", "video effects", "screen sharing", "share screen", "화면 공유", "close", "닫기"])

private func diagnosticWindow(_ window: FaceTimeScreenWindow) -> [String: Any] {
    ["id": window.id, "pid": window.pid, "bundleId": NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier ?? "", "layer": window.layer, "alpha": window.alpha, "rect": dict(window.rect)]
}

private func diagnosticSnapshot() -> [String: Any] {
    let trusted = AXIsProcessTrusted()
    var output: [String: Any] = ["accessibility": trusted, "screenCapture": CGPreflightScreenCaptureAccess(), "timestamp": Date().timeIntervalSince1970 * 1000]
    let stack = faceTimeScreenWindows() ?? []
    let displays = faceTimeDisplayFrames()
    let ignoredPIDs = Set([getpid()] + NSRunningApplication.runningApplications(withBundleIdentifier: "app.helpos.desktop").map { $0.processIdentifier })
    output["stack"] = stack.prefix(300).map(diagnosticWindow)
    output["displayFrames"] = displays.map(dict)
    output["overlayLayer"] = Int(CGWindowLevelForKey(.popUpMenuWindow)) + 1
    guard trusted else { return output }
    let start = ProcessInfo.processInfo.systemUptime
    var visited = 0
    var truncated = false
    var windowsOutput: [[String: Any]] = []
    func read(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        guard ProcessInfo.processInfo.systemUptime - start < 3.0 else { truncated = true; return nil }
        AXUIElementSetMessagingTimeout(element, 0.04)
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    func bounds(_ element: AXUIElement) -> CGRect? {
        guard let position = read(element, kAXPositionAttribute), let size = read(element, kAXSizeAttribute), CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero; var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        let rect = CGRect(origin: point, size: dimensions)
        return finiteRect(rect) ? rect : nil
    }
    for bundle in ["com.apple.FaceTime", "com.apple.avconferenced"] {
        for application in NSRunningApplication.runningApplications(withBundleIdentifier: bundle).prefix(2) {
            let root = AXUIElementCreateApplication(application.processIdentifier)
            guard let windows = read(root, kAXWindowsAttribute) as? [AXUIElement] else { continue }
            for (windowIndex, window) in windows.prefix(8).enumerated() {
                let windowRect = bounds(window)
                let matches = windowRect.map { rect in stack.filter { $0.pid == application.processIdentifier && uniqueFaceTimeWindowID(rect, candidates: [($0.id, $0.rect)]) != nil } } ?? []
                var records: [[String: Any]] = []
                var roleCounts: [String: Int] = [:]
                func walk(_ element: AXUIElement, depth: Int) {
                    guard depth <= 15, visited < 1000, records.count < 80, ProcessInfo.processInfo.systemUptime - start < 3.0 else { truncated = true; return }
                    visited += 1
                    guard let role = read(element, kAXRoleAttribute) as? String else { return }
                    roleCounts[role, default: 0] += 1
                    if ["AXWebArea", "AXTextArea", "AXTextField", "AXSecureTextField", "AXTable", "AXOutline", "AXList"].contains(role) { return }
                    let hidden = (read(element, "AXHidden") as? Bool) == true
                    if ["AXButton", "AXCheckBox", "AXToggleButton", "AXPopUpButton", "AXMenuButton"].contains(role) {
                        var record: [String: Any] = ["role": role, "hidden": hidden, "enabled": (read(element, kAXEnabledAttribute) as? Bool) as Any? ?? NSNull()]
                        var labels: [String: String] = [:]
                        for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
                            if let text = read(element, name) as? String, !text.isEmpty {
                                let normalized = faceTimeLabel(text)
                                labels[name] = diagnosticLabels.contains(normalized) ? normalized : "<redacted>"
                            }
                        }
                        record["labels"] = labels
                        if let value = numberOrBool(read(element, kAXValueAttribute)) { record["value"] = value }
                        if let rect = bounds(element) {
                            record["rect"] = dict(rect)
                            record["insideAXWindow"] = windowRect?.insetBy(dx: -2, dy: -2).contains(rect) ?? false
                            record["insideDisplay"] = displays.contains { $0.contains(rect) }
                            record["cgMatches"] = matches.map { $0.id }
                            record["occlusion"] = matches.map { match -> [String: Any] in
                                let index = stack.firstIndex { $0.id == match.id } ?? 0
                                let blockers = stack.prefix(index).filter {
                                    !((ignoredPIDs.contains($0.pid)) && $0.layer == Int(CGWindowLevelForKey(.popUpMenuWindow)) + 1) && $0.alpha > 0 && $0.rect.intersects(rect)
                                }
                                return ["candidateId": match.id, "clear": faceTimeControlIsClear(rect, callWindowID: match.id, windows: stack, ignoredPIDs: ignoredPIDs, displays: displays), "blockers": blockers.prefix(20).map(diagnosticWindow)]
                            }
                        }
                        records.append(record)
                    }
                    if hidden { return }
                    if let children = read(element, kAXChildrenAttribute) as? [AXUIElement] { for child in children { walk(child, depth: depth + 1) } }
                }
                walk(window, depth: 0)
                windowsOutput.append(["pid": application.processIdentifier, "bundleId": bundle, "index": windowIndex, "rect": windowRect.map(dict) as Any? ?? NSNull(), "minimized": (read(window, kAXMinimizedAttribute) as? Bool) as Any? ?? NSNull(), "matchedCGIds": matches.map { $0.id }, "roleCounts": roleCounts, "buttons": records])
            }
        }
    }
    output["axWindows"] = windowsOutput
    output["truncated"] = truncated
    output["visited"] = visited
    output["production"] = faceTimeCallObservation(includeElements: true)
    return output
}

@_cdecl("helpos_diagnose_facetime")
public func diagnoseFaceTime() -> UnsafeMutablePointer<CChar>? {
    guard !Thread.isMainThread else { return strdup("{\"error\":\"diagnostic_requires_worker\"}") }
    let value = diagnosticSnapshot()
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return strdup("{\"error\":\"serialization_failed\"}") }
    return strdup(text)
}

@_cdecl("helpos_diagnostic_free")
public func freeDiagnostic(_ pointer: UnsafeMutableRawPointer?) { free(pointer) }
