import AppKit
import CoreGraphics

let appHelpBundleIDs: Set<String> = ["com.apple.FaceTime", "com.apple.Safari", "com.apple.finder"]
let helpOSBundleID = "app.helpos.desktop"

struct AppContextSnapshot {
    let bundleID: String
    let pid: pid_t?
    let window: CGRect?
    let timestamp: Double
}

struct AppContextWindowIDs {
    let visible: Set<CGWindowID>
    let all: Set<CGWindowID>
}

struct AppWindowContextSnapshot {
    let bundleID: String
    let pid: pid_t
    let windows: AppContextWindowIDs
    let timestamp: Double
}

private func appContextVisibleWindow(pid: pid_t, record row: [String: Any], displays: [CGRect]) -> CGRect? {
    guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
          (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
          (row[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
          let alpha = (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue,
          alpha.isFinite, alpha > 0,
          let bounds = row[kCGWindowBounds as String] as? [String: Any],
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
          [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }),
          rect.width > 1, rect.height > 1,
          displays.contains(where: { display in
              let visible = rect.intersection(display)
              return !visible.isNull && visible.width > 0 && visible.height > 0
          }) else { return nil }
    return rect
}

// CG metadata only: never inspect window titles, pixels, or Accessibility data.
// Normal on-screen windows use layer zero; Finder's desktop is not eligible.
func appContextWindow(pid: pid_t, records: [[String: Any]], displays: [CGRect]) -> CGRect? {
    for row in records {
        if let rect = appContextVisibleWindow(pid: pid, record: row, displays: displays) { return rect }
    }
    return nil
}

// All layer-zero IDs include minimized/offscreen windows. Their continued
// existence distinguishes a restore from closing the last window and reopening.
// nil means unknown metadata, never evidence that the application has no windows.
func appContextWindowIDs(pid: pid_t, records: [[String: Any]]?, displays: [CGRect]) -> AppContextWindowIDs? {
    guard let records, !displays.isEmpty, displays.allSatisfy({ display in
        [display.minX, display.minY, display.width, display.height].allSatisfy { $0.isFinite } && display.width > 0 && display.height > 0
    }) else { return nil }
    var all = Set<CGWindowID>()
    var visible = Set<CGWindowID>()
    for row in records {
        guard let owner = row[kCGWindowOwnerPID as String] as? NSNumber,
              let layer = row[kCGWindowLayer as String] as? NSNumber else { return nil }
        guard owner.int32Value == pid, layer.intValue == 0 else { continue }
        guard let bounds = row[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }),
              rect.width >= 0, rect.height >= 0 else { return nil }
        // Zero-sized helper windows do not keep a document population alive.
        // Position and on-screen state do not exclude minimized/offscreen IDs.
        guard rect.width > 1, rect.height > 1 else { continue }
        guard let number = row[kCGWindowNumber as String] as? NSNumber,
              number.doubleValue.isFinite, number.doubleValue > 0,
              number.doubleValue <= Double(UInt32.max), number.doubleValue.rounded(.down) == number.doubleValue else { return nil }
        let id = number.uint32Value
        guard all.insert(id).inserted else { return nil }
        if appContextVisibleWindow(pid: pid, record: row, displays: displays) != nil { visible.insert(id) }
    }
    return AppContextWindowIDs(visible: visible, all: all)
}

func appWindowContext(firstBundleID: String, firstPID: pid_t?, lastBundleID: String, lastPID: pid_t?,
                      records: [[String: Any]]?, displays: [CGRect], timestamp: Double) -> AppWindowContextSnapshot? {
    guard appHelpBundleIDs.contains(firstBundleID), firstBundleID == lastBundleID,
          let pid = firstPID, pid > 0, lastPID == pid, timestamp.isFinite,
          let windows = appContextWindowIDs(pid: pid, records: records, displays: displays) else { return nil }
    return AppWindowContextSnapshot(bundleID: firstBundleID, pid: pid, windows: windows, timestamp: timestamp)
}

func appContextDisplays() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var identifiers = [CGDirectDisplayID](repeating: 0, count: Int(count))
    let status = identifiers.withUnsafeMutableBufferPointer { buffer in
        CGGetActiveDisplayList(count, buffer.baseAddress, &count)
    }
    guard status == .success else { return [] }
    return identifiers.prefix(Int(count)).map(CGDisplayBounds)
}

func currentAppContext() -> AppContextSnapshot {
    let first = NSWorkspace.shared.frontmostApplication
    let bundleID = first?.bundleIdentifier ?? ""
    var window: CGRect?
    if let first, appHelpBundleIDs.contains(bundleID),
       let records = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        window = appContextWindow(pid: first.processIdentifier, records: records, displays: appContextDisplays())
    }
    let last = NSWorkspace.shared.frontmostApplication
    let sameApp = first?.processIdentifier == last?.processIdentifier && bundleID == (last?.bundleIdentifier ?? "")
    return AppContextSnapshot(bundleID: last?.bundleIdentifier ?? "", pid: last?.processIdentifier,
                              window: sameApp ? window : nil, timestamp: Date().timeIntervalSince1970 * 1000)
}

func currentAppWindowContext() -> AppWindowContextSnapshot? {
    let first = NSWorkspace.shared.frontmostApplication
    guard let first, first.activationPolicy == .regular,
          let bundleID = first.bundleIdentifier, appHelpBundleIDs.contains(bundleID) else { return nil }
    let records = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    let displays = appContextDisplays()
    let last = NSWorkspace.shared.frontmostApplication
    return appWindowContext(firstBundleID: bundleID, firstPID: first.processIdentifier,
                            lastBundleID: last?.bundleIdentifier ?? "", lastPID: last?.processIdentifier,
                            records: records, displays: displays, timestamp: Date().timeIntervalSince1970 * 1000)
}

func appContextObservation() -> [String: Any] {
    let context = currentAppContext()
    let window: Any = context.window.map { rect in
        ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    } ?? (NSNull() as Any)
    return ["frontmostBundleId": context.bundleID, "pid": context.pid.map { $0 as Any } ?? NSNull(),
            "window": window, "timestamp": context.timestamp]
}
