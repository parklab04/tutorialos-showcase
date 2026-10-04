import AppKit
import ApplicationServices
let app = NSWorkspace.shared.frontmostApplication
let data: [String: Any] = ["trusted": AXIsProcessTrusted(), "frontmost": app?.bundleIdentifier ?? "", "screenCapture": CGPreflightScreenCaptureAccess()]
if let encoded = try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]), let text = String(data: encoded, encoding: .utf8) { print(text) }
