import AppKit
import ApplicationServices

let allowedBundles: Set<String> = ["com.apple.FaceTime", "com.apple.Safari", "com.apple.finder"]
let allowedLabels = ["View", "보기", "Zoom In", "확대", "확대하기", "Zoom Out", "Actual Size", "축소", "실제 크기", "Downloads", "다운로드", "Mute", "Mute Audio", "Mute microphone", "음소거", "오디오 음소거", "마이크 끄기", "Unmute", "Unmute Audio", "Unmute microphone", "음소거 해제", "오디오 음소거 해제", "마이크 켜기", "Turn Camera Off", "Camera Off", "Stop Video", "카메라 끄기", "비디오 끄기", "비디오 중단", "Turn Camera On", "Camera On", "Start Video", "카메라 켜기", "비디오 켜기", "비디오 시작", "End", "End Call", "Hang Up", "종료", "통화 종료", "통화 끝내기", "Call Ended", "Call has ended", "통화가 종료되었습니다", "통화가 종료됨"]
let labelPatterns: [(String, NSRegularExpression)] = allowedLabels.sorted { $0.count > $1.count }.compactMap { label in
    let pattern = "(?<![\\p{L}\\p{N}_])" + NSRegularExpression.escapedPattern(for: label) + "(?![\\p{L}\\p{N}_])"
    guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
    return (label, expression)
}
func namedRanges(in text: String) -> [(String, Range<String.Index>)] {
    var result: [(String, Range<String.Index>)] = []
    var occupied: [NSRange] = []
    for (label, expression) in labelPatterns {
        for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard !occupied.contains(where: { NSIntersectionRange($0, match.range).length > 0 }), let range = Range(match.range, in: text) else { continue }
            result.append((label, range)); occupied.append(match.range)
        }
    }
    return result
}
func canonical(_ value: String) -> String? {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "…", with: "")
    return allowedLabels.first { $0.caseInsensitiveCompare(cleaned) == .orderedSame }
}
// These labels are AX-only. They deliberately do not enter labelPatterns/OCR.
let safariAXLabels = ["Bookmarks", "책갈피", "History", "방문 기록", "Show Reader", "Show Reader View", "읽기 도구 보기", "리더 보기", "Hide Reader", "읽기 도구 가리기", "Add Bookmark", "책갈피 추가", "Reopen Last Closed Tab", "마지막으로 닫은 탭 다시 열기"]
func safariChromeLabel(_ value: String) -> String? {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "…", with: "")
        .replacingOccurrences(of: "...", with: "")
    return safariAXLabels.first { $0.caseInsensitiveCompare(cleaned) == .orderedSame } ?? canonical(value)
}
func safariMenuItemLabelMayBeRead(menu: String?, command: String, identifier: String = "") -> Bool {
    // View contains fixed application commands. History and Bookmarks also
    // contain private page names: only inspect the fixed command's shortcut.
    if ["View", "보기"].contains(menu ?? "") { return true }
    if ["Bookmarks", "책갈피"].contains(menu ?? "") { return identifier == "AddBookmark" || command.lowercased() == "d" }
    if ["History", "방문 기록"].contains(menu ?? "") { return identifier == "ReopenLastClosedTab" || command.lowercased() == "t" }
    return false
}

struct ChromeWindow {
    let id: CGWindowID
    let pid: pid_t
    let rect: CGRect
    let layer: Int
    let alpha: Double
}
func chromeWindows() -> [ChromeWindow]? {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    return rows.compactMap { row in
        guard let identifier = row[kCGWindowNumber as String] as? NSNumber,
              let pid = row[kCGWindowOwnerPID as String] as? NSNumber,
              let layer = row[kCGWindowLayer as String] as? NSNumber,
              let bounds = row[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), finiteRect(rect) else { return nil }
        return ChromeWindow(id: identifier.uint32Value, pid: pid.int32Value, rect: rect, layer: layer.intValue,
                            alpha: (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1)
    }
}
func uniqueSafariDocumentID(_ rect: CGRect, pid: pid_t, windows: [ChromeWindow]) -> CGWindowID? {
    guard finiteRect(rect) else { return nil }
    let matches = windows.filter { window in
        window.pid == pid && window.layer == 0 && window.alpha > 0 &&
        abs(window.rect.minX - rect.minX) <= 2 && abs(window.rect.minY - rect.minY) <= 2 &&
        abs(window.rect.width - rect.width) <= 2 && abs(window.rect.height - rect.height) <= 2
    }
    return matches.count == 1 ? matches[0].id : nil
}
func stableSafariDocumentID(_ rect: CGRect, pid: pid_t, before: [ChromeWindow], after: [ChromeWindow]) -> CGWindowID? {
    guard let original = uniqueSafariDocumentID(rect, pid: pid, windows: before),
          original == uniqueSafariDocumentID(rect, pid: pid, windows: after) else { return nil }
    return original
}
func safariMenuWindowIsVisible(_ rect: CGRect, document: CGRect, pid: pid_t, windows: [ChromeWindow]) -> Bool {
    guard finiteRect(rect), let documentID = uniqueSafariDocumentID(document, pid: pid, windows: windows) else { return false }
    // The menu must match its own current Safari-owned CG window. Merely
    // overlapping the document is not positive evidence that a menu is open.
    let matches = windows.filter { window in
        window.id != documentID && window.pid == pid && window.alpha > 0 && window.layer >= 0 &&
        abs(window.rect.minX - rect.minX) <= 2 && abs(window.rect.minY - rect.minY) <= 2 &&
        abs(window.rect.width - rect.width) <= 2 && abs(window.rect.height - rect.height) <= 2
    }
    return matches.count == 1
}

enum SafariMenuChildSource {
    case none, visibleChildren, children
}
func safariMenuChildSource(hidden: Bool, explicitVisibility: Bool?, visibleChildCount: Int?, hasMenuWindow: Bool) -> SafariMenuChildSource {
    guard !hidden, explicitVisibility != false else { return .none }
    if let count = visibleChildCount, count > 0 { return .visibleChildren }
    // An empty visible-children list cannot contradict independent positive
    // visibility. Without that evidence, retained AXChildren stay unread.
    return explicitVisibility == true || hasMenuWindow ? .children : .none
}

struct SafariSheetControl {
    let role: String
    let label: String
    let rect: CGRect
    let hidden: Bool
}
// Add/Cancel are shared by unrelated sheets. Safari's observed fixed identifier
// establishes this sheet's purpose without reading the bookmark/page title.
func isSafariBookmarkSheet(_ rect: CGRect, document: CGRect, identifier: String, attached: Bool, visible: Bool, hidden: Bool, controls: [SafariSheetControl]) -> Bool {
    guard identifier == "AddBookmarkSheet", attached, visible, !hidden, finiteRect(rect), finiteRect(document),
          document.insetBy(dx: -2, dy: -2).contains(rect) else { return false }
    let visible = controls.filter { !$0.hidden && finiteRect($0.rect) && rect.insetBy(dx: -2, dy: -2).contains($0.rect) }
    return visible.filter { $0.role == "AXButton" && $0.label == "Add" }.count == 1 &&
        visible.filter { $0.role == "AXButton" && $0.label == "Cancel" }.count == 1
}
func dict(_ rect: CGRect) -> [String: Double] { ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height] }
func globalRect(_ normalized: CGRect, in frame: CGRect) -> CGRect {
    CGRect(x: frame.minX + normalized.minX * frame.width, y: frame.minY + (1 - normalized.maxY) * frame.height, width: normalized.width * frame.width, height: normalized.height * frame.height)
}
func frontWindow(_ pid: pid_t) -> (CGWindowID, CGRect)? {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    for row in rows {
        guard (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let identifier = row[kCGWindowNumber as String] as? NSNumber,
              let bounds = row[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 100, rect.height > 100 else { continue }
        return (identifier.uint32Value, rect)
    }
    return nil
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    guard !Task.isCancelled else { return nil }
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}
func stringAttribute(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
func rectOf(_ element: AXUIElement) -> CGRect? {
    guard let rawPosition = attribute(element, kAXPositionAttribute), let rawSize = attribute(element, kAXSizeAttribute), CFGetTypeID(rawPosition) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &point), AXValueGetValue(rawSize as! AXValue, .cgSize, &size), size.width >= 3, size.height >= 3 else { return nil }
    return CGRect(origin: point, size: size)
}
func numberOrBool(_ value: CFTypeRef?) -> String? {
    if let number = value as? NSNumber { return number.stringValue }
    if let string = value as? String, ["0", "1", "true", "false", "on", "off"].contains(string.lowercased()) { return string }
    return nil
}
