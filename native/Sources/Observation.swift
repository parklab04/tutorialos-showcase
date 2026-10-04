import AppKit
import ApplicationServices

// Shared by the CLI diagnostic helper and the in-process C bridge. The caller
// supplies only an allowlisted command; this dispatcher never requests access.
func observation(arguments: [String]) async -> [String: Any] {
    guard !Task.isCancelled else { return ["error": "observation_cancelled"] }
    if arguments == ["--app-context"] { return appContextObservation() }
    if arguments == ["--facetime-call"] { return faceTimeCallObservation() }
    let application = NSWorkspace.shared.frontmostApplication
    let trusted = AXIsProcessTrusted()
    let screenCapture = CGPreflightScreenCaptureAccess()
    var result: [String: Any] = ["trusted": trusted, "screenCapture": screenCapture, "frontmostBundleId": application?.bundleIdentifier ?? "", "frontmostName": application?.localizedName ?? "", "timestamp": Date().timeIntervalSince1970 * 1000, "source": "none", "window": NSNull(), "elements": []]
    func clearEvidence() {
        result["window"] = NSNull(); result["elements"] = []; result["source"] = "none"
        result.removeValue(forKey: "windowId")
        result.removeValue(forKey: "observedBundleId")
        result.removeValue(forKey: "controlVisibility")
    }
    let wantsFaceTime = arguments == ["--observe", "com.apple.FaceTime"]
    if wantsFaceTime, trusted {
        let call = faceTimeCallObservation(includeElements: true)
        result["source"] = "accessibility"
        if (call["state"] as? String) == "active" {
            result["occluded"] = call["occluded"] as? Bool ?? true
            result["controlVisibility"] = call["controlVisibility"]
            if (call["observedBundleId"] as? String) == "com.apple.FaceTime" {
                result["observedBundleId"] = "com.apple.FaceTime"
                result["window"] = call["window"]
                result["windowId"] = call["callId"]
                result["elements"] = call["elements"] as? [[String: Any]] ?? []
                result["source"] = "accessibility"
            }
        }
    }
    if (result["observedBundleId"] as? String) == nil,
       !(wantsFaceTime && (result["occluded"] as? Bool) == true),
       arguments.count == 2, arguments[0] == "--observe", allowedBundles.contains(arguments[1]), let application, application.bundleIdentifier == arguments[1] {
        // Keep the target and its identity from the same unchanged window.
        let originalWindowId = frontWindow(application.processIdentifier)?.0
        let safariAX = trusted && application.bundleIdentifier == "com.apple.Safari"
        let originalChromeWindows = safariAX ? chromeWindows() : nil
        var accessibilityWindow: CGRect?
        if trusted {
            let observed = axObservation(application, chromeSnapshot: originalChromeWindows)
            accessibilityWindow = observed.0
            result["window"] = observed.0.map(dict) ?? (NSNull() as Any)
            result["elements"] = observed.1
            result["source"] = "accessibility"
        }
        guard !Task.isCancelled else { return ["error": "observation_cancelled"] }
        if (!trusted || (result["elements"] as? [[String: Any]])?.isEmpty == true), screenCapture, application.bundleIdentifier != "com.apple.FaceTime", #available(macOS 14.2, *) {
            if let observed = try? await ocrObservation(application) {
                result["window"] = observed.0.map(dict) ?? (NSNull() as Any)
                result["elements"] = observed.1
                result["source"] = "ocr"
            }
        }
        guard !Task.isCancelled else { return ["error": "observation_cancelled"] }
        let currentWindow = frontWindow(application.processIdentifier)
        if safariAX, (result["source"] as? String) == "accessibility" {
            // Menus/sheets can be the first layer-zero Safari CG window. Match
            // the AX document geometry in both metadata snapshots instead, so
            // opening a menu cannot invent a new document/session identity.
            if let rect = accessibilityWindow, let before = originalChromeWindows, let after = chromeWindows(),
               let identifier = stableSafariDocumentID(rect, pid: application.processIdentifier, before: before, after: after) {
                result["windowId"] = "\(application.processIdentifier):\(identifier)"
            } else { clearEvidence() }
        }
        else if originalWindowId != currentWindow?.0 { clearEvidence() }
        else if !(result["window"] is NSNull), let currentWindow { result["windowId"] = "\(application.processIdentifier):\(currentWindow.0)" }
        // Reject observations completed after a foreground application switch.
        if NSWorkspace.shared.frontmostApplication?.processIdentifier != application.processIdentifier {
            clearEvidence()
            result["frontmostBundleId"] = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        }
        // The foreground fallback retains positive Call Ended evidence, but its
        // controls receive the same occlusion check as the active-call path.
        if wantsFaceTime, (result["source"] as? String) == "accessibility" {
            if let currentWindow, let stack = faceTimeScreenWindows(),
               stack.contains(where: { $0.id == currentWindow.0 && $0.pid == application.processIdentifier }) {
                let displays = faceTimeDisplayFrames()
                let ignoredPIDs = Set([getpid()] + NSRunningApplication.runningApplications(withBundleIdentifier: "app.helpos.desktop").map { $0.processIdentifier })
                var hiddenControl = false
                let records = result["elements"] as? [[String: Any]] ?? []
                let controls: [FaceTimeControl] = records.compactMap { record in
                    guard let bounds = record["rect"] as? [String: Double], let x = bounds["x"], let y = bounds["y"], let width = bounds["width"], let height = bounds["height"] else { return nil }
                    return FaceTimeControl(role: record["role"] as? String ?? "", label: record["label"] as? String ?? "", enabled: record["enabled"] as? Bool ?? false, rect: CGRect(x: x, y: y, width: width, height: height))
                }
                result["controlVisibility"] = faceTimeKindVisibility(controls, callWindowID: currentWindow.0, windows: stack, ignoredPIDs: ignoredPIDs, displays: displays)
                result["elements"] = records.filter { record in
                    guard let bounds = record["rect"] as? [String: Double], let x = bounds["x"], let y = bounds["y"], let width = bounds["width"], let height = bounds["height"] else { return false }
                    let rect = CGRect(x: x, y: y, width: width, height: height)
                    let clear = faceTimeControlIsClear(rect, callWindowID: currentWindow.0, windows: stack, ignoredPIDs: ignoredPIDs, displays: displays)
                    let control = FaceTimeControl(role: record["role"] as? String ?? "", label: record["label"] as? String ?? "", enabled: record["enabled"] as? Bool ?? false, rect: rect)
                    if !clear && faceTimeControlKind(control) != nil { hiddenControl = true }
                    return clear
                }
                result["occluded"] = hiddenControl
            } else { clearEvidence(); result["occluded"] = true }
        }
    }
    if wantsFaceTime {
        let currentForeground = NSWorkspace.shared.frontmostApplication
        result["frontmostBundleId"] = currentForeground?.bundleIdentifier ?? ""
        result["frontmostName"] = currentForeground?.localizedName ?? ""
    }
    guard !Task.isCancelled else { return ["error": "observation_cancelled"] }
    let currentAXAccess = AXIsProcessTrusted()
    let currentScreenAccess = CGPreflightScreenCaptureAccess()
    result["trusted"] = currentAXAccess
    result["screenCapture"] = currentScreenAccess
    if ((result["source"] as? String) == "accessibility" && !currentAXAccess) ||
       ((result["source"] as? String) == "ocr" && !currentScreenAccess) { clearEvidence() }
    result["timestamp"] = Date().timeIntervalSince1970 * 1000
    return result
}

func observationJSON(_ result: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { return "{\"error\":\"serialization_failed\"}" }
    return text
}
