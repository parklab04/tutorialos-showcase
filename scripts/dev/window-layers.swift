import Foundation
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let windows = rows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == pid }.compactMap { row -> [String: Any]? in
    guard let id = row[kCGWindowNumber as String], let layer = row[kCGWindowLayer as String], let bounds = row[kCGWindowBounds as String] else { return nil }
    return ["id": id, "layer": layer, "bounds": bounds]
}
let data = try! JSONSerialization.data(withJSONObject: ["overlayLayer": CGWindowLevelForKey(.popUpMenuWindow) + 1, "windows": windows])
print(String(data: data, encoding: .utf8)!)
