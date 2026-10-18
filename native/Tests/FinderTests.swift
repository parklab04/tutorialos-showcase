import AppKit
import ApplicationServices

@main
struct FinderObserverTests {
    static func main() {
        var checks = 0
        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            guard condition() else { fatalError(message) }
            checks += 1
        }
        func command(_ title: String, key: String = "", virtual: Int? = nil, modifiers: Int? = nil) -> String? {
            finderFileMenuCommand(title, command: key, virtualKey: virtual, modifiers: modifiers)
        }
        check(finderFileMenuAnchor("File") == "File", "English File anchor must normalize")
        check(finderFileMenuAnchor("파일") == "File", "Korean File anchor must normalize")
        check(finderFileMenuAnchor("File report.pdf") == nil, "A file name must not become the menu anchor")
        check(finderWindowMayBeDocument(role: "AXWindow", subrole: "AXStandardWindow", minimized: false), "Normal Finder document remains eligible")
        check(!finderWindowMayBeDocument(role: "AXWindow", subrole: "AXFloatingWindow", minimized: false), "Quick Look floating window cannot replace its owning document")
        check(!finderWindowMayBeDocument(role: "AXWindow", subrole: "AXDialog", minimized: false), "A dialog needs explicit ownership rather than new document identity")
        check(!finderWindowMayBeDocument(role: "AXSheet", subrole: nil, minimized: false), "An attached sheet is not itself a document")
        check(!finderWindowMayBeDocument(role: "AXWindow", subrole: "AXStandardWindow", minimized: true), "Minimized windows cannot provide visible document evidence")
        check(command("New Folder") == "New Folder", "Fixed new-folder command must be recognized")
        check(command("새로운 폴더") == "New Folder", "Korean new-folder command must be recognized")
        check(command("새 폴더") == "New Folder", "Alternate exact Korean command must match lesson aliases")
        check(command("New Folder with Selection (2 Items)") == nil, "Selection-folder is a different operation")
        check(command("Rename") == "Rename", "Fixed singular rename must be recognized")
        check(command("이름 변경") == "Rename", "Korean singular rename must normalize")
        for title in ["Rename…", "Rename...", "Rename 2 Items…", "Rename report.pdf", "이름 변경…", "2개 항목 이름 변경"] {
            check(command(title) == nil, "Batch or filename-bearing Rename cannot become singular Rename")
        }
        check(command("Quick Look", key: "y", modifiers: 0) == "Quick Look", "Command-Y menu variant must be supported")
        check(command("Quick Look “private report.pdf”", key: "y", modifiers: 0) == "Quick Look", "Dynamic title must discard its filename")
        check(command("Quick Look 'private report.pdf'", key: " ", modifiers: 8) == "Quick Look", "Unmodified Space variant must normalize")
        check(command("Quick Look \"private report.pdf\"", virtual: 49, modifiers: 8) == "Quick Look", "Observed Space virtual key must normalize")
        check(command("‘private report.pdf’ 훑어보기", key: "y", modifiers: 0) == "Quick Look", "Korean filename suffix must normalize")
        for title in ["Quick Look 2 Items", "Quick Look private report.pdf", "Quick Look “”, another command", "Quick Look \"\"", "Preview"] {
            check(command(title, key: "y", modifiers: 0) == nil, "Unknown or multi-item Quick Look shape must fail closed")
        }
        check(command("Quick Look “private report.pdf”") == nil, "A dynamic title without shortcut evidence is insufficient")
        check(command("Quick Look", key: "y", modifiers: nil) == nil, "Unknown modifiers cannot imply Command-Y")
        check(command("Quick Look", key: "y", modifiers: 1) == nil, "Shift-Command-Y is not the same command")
        check(command("Quick Look", key: " ", modifiers: 0) == nil, "Command-Space is not unmodified Space")
        check(!namedRanges(in: "File New Folder Rename Quick Look").contains { ["File", "New Folder", "Rename", "Quick Look"].contains($0.0) }, "New commands must remain AX-only")

        let document = CGRect(x: -1000, y: 80, width: 900, height: 680)
        let menu = CGRect(x: -950, y: 24, width: 300, height: 500)
        let target = CGRect(x: -945, y: 75, width: 285, height: 24)
        func record(_ title: String = "Rename", role: String = "AXMenuItem", menuName: String? = "File", visible: Bool = true,
                    enabled: Bool? = true, bounds: CGRect? = nil, key: String = "", modifiers: Int? = nil) -> [String: Any]? {
            finderFileMenuRecord(id: "fixture", role: role, title: title, menu: menuName, visible: visible, enabled: enabled,
                                 menuRect: menu, rect: bounds ?? target, command: key, virtualKey: nil, modifiers: modifiers)
        }
        check(record()?["scope"] as? String == "finder-file-menu", "Native record must carry exact File-menu scope")
        check(record(enabled: false)?["enabled"] as? Bool == false, "Explicit disabled state is useful waiting evidence")
        check(record(enabled: nil) == nil, "Unknown enabled state must not be emitted as enabled or disabled")
        check(record(visible: false) == nil, "Retained collapsed commands cannot be targets")
        check(record(menuName: "Edit") == nil && record(menuName: nil) == nil, "Commands require current File-menu ownership")
        check(record(role: "AXStaticText") == nil, "Matching text does not establish a clickable menu command")
        check(record(bounds: CGRect(x: 100, y: 100, width: 60, height: 24)) == nil, "Unrelated item bounds must not join this menu")
        check(record(bounds: CGRect(x: CGFloat.infinity, y: 100, width: 60, height: 24)) == nil, "Invalid bounds must be rejected")
        let dynamic = record("Quick Look “private report.pdf”", key: "y", modifiers: 0)!
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: dynamic), encoding: .utf8)!
        check(!encoded.contains("private report") && dynamic["label"] as? String == "Quick Look", "No dynamic filename may escape the scoped record")

        let normal = ChromeWindow(id: 101, pid: 7, rect: document, layer: 0, alpha: 1)
        let popup = ChromeWindow(id: 102, pid: 7, rect: menu, layer: 0, alpha: 1)
        func attachedOwner(_ attached: Bool, subrole: String = "AXStandardWindow", windows: [ChromeWindow]? = nil) -> Bool {
            finderAttachedDocumentIsValid(attached: attached, role: "AXWindow", subrole: subrole, minimized: false,
                                          rect: document, pid: 7, windows: windows ?? [normal, popup])
        }
        check(attachedOwner(true), "Explicit attachment to a matching normal document can retain owning identity")
        check(!attachedOwner(false), "A main window without explicit attachment must never be guessed as preview owner")
        check(!attachedOwner(true, subrole: "AXFloatingWindow"), "An attached floating window cannot become its own document")
        check(!attachedOwner(true, windows: [popup]), "Attachment without on-screen normal-document evidence must fail")
        check(!attachedOwner(true, windows: [ChromeWindow(id: 101, pid: 9, rect: document, layer: 0, alpha: 1)]), "Another app's geometry cannot corroborate an attached owner")
        check(!attachedOwner(true, windows: [normal, ChromeWindow(id: 103, pid: 7, rect: document, layer: 0, alpha: 1)]), "Ambiguous owning document geometry must fail")
        check(stableSafariDocumentID(document, pid: 7, before: [normal], after: [popup, normal]) == 101, "Finder menu must not replace document identity")
        check(stableSafariDocumentID(document, pid: 7, before: [popup, normal], after: [normal]) == 101, "Menu close must preserve Finder document identity")
        check(stableSafariDocumentID(document, pid: 7, before: [normal], after: [ChromeWindow(id: 103, pid: 7, rect: document, layer: 0, alpha: 1)]) == nil, "Replacement window cannot provide same-document confirmation")
        check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [normal]), "Retained menu bounds cannot supply positive visibility")
        check(safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [popup, normal]), "Matching Finder-owned popup can corroborate visibility")

        func visibility(hidden: Bool? = nil, explicit: Bool? = nil, count: Int? = nil, window: Bool? = nil, geometry: Bool = true) -> FinderMenuVisibility {
            finderMenuVisibility(hidden: hidden, explicitVisibility: explicit, visibleChildCount: count, hasMenuWindow: window, validGeometry: geometry)
        }
        check(visibility(explicit: true, count: 0) == .visible, "Explicitly open menu can expose retained children")
        check(visibility(count: 2) == .visible, "Positive visible-child evidence can establish open state")
        check(visibility(count: 0, window: true) == .visible, "Matching popup can establish an open menu")
        check(visibility(explicit: false) == .closed, "Explicit closed state can confirm menu closure")
        check(visibility(hidden: true) == .closed, "Hidden menu can establish closed state")
        check(visibility(count: 0, window: false) == .closed, "Valid empty visible-child plus absent popup can establish closed state")
        check(visibility(count: 0) == .unknown, "Empty list without corroboration is not closure evidence")
        check(visibility(explicit: true, geometry: false) == .unknown, "Open status without usable geometry remains uncertain")
        check(visibility(explicit: false, window: true) == .unknown, "Conflicting popup/closed metadata must fail closed")
        check(finderObservedMenuContext([(true, .visible), (false, .closed)], complete: true) == "file", "One known visible File menu establishes file context")
        check(finderObservedMenuContext([(true, .visible), (false, .unknown)], complete: true) == "file", "Positive File visibility does not require unopened siblings to expose state")
        check(finderObservedMenuContext([(true, .unknown), (false, .visible)], complete: true) == "other", "Positive other-menu visibility must prevent closed confirmation despite unknown File state")
        check(finderObservedMenuContext([(true, .closed), (false, .visible)], complete: true) == "other", "Another open menu must not imply File completion")
        check(finderObservedMenuContext([(true, .closed), (false, .closed)], complete: true) == "closed", "Complete known-closed menu scan establishes closure")
        check(finderObservedMenuContext([(true, .closed), (false, .unknown)], complete: true) == "unknown", "Any unreadable menu prevents closed evidence")
        check(finderObservedMenuContext([(true, .closed)], complete: false) == "unknown", "Budget exhaustion prevents closure evidence")
        check(finderObservedMenuContext([], complete: true) == "unknown", "Missing menu bar cannot imply closed")
        check(finderObservedMenuContext([(true, .visible), (false, .visible)], complete: true) == "unknown", "Ambiguous concurrent menus cannot guide")
        var remaining = 2
        var visited: [String] = []
        func visit(_ label: String) { if remaining > 0 { remaining -= 1; visited.append(label) } }
        visitObservationRegions(safari: false, finder: true, attachedSheets: { visit("sheet") }, menuBar: { visit("File"); visit("Rename") }, document: { visit("Downloads") })
        check(visited == ["File", "Rename"], "Finder menus must not be starved by large file trees")
        var order: [String] = []
        visitObservationRegions(safari: false, finder: true, attachedSheets: {}, menuBar: { order.append("menu") }, document: { order.append("Downloads") })
        check(order == ["menu", "Downloads"], "Downloads must remain observed after menu chrome")
        print("\(checks) Finder command, privacy, menu-context and identity checks passed")
    }
}
