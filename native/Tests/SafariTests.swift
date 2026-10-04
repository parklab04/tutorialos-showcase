import AppKit
import ApplicationServices

func runSafariTests() {
    var count = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError(message) }
        count += 1
    }
    let document = CGRect(x: -1100, y: 70, width: 1000, height: 700)
    let menu = CGRect(x: -950, y: 25, width: 280, height: 460)
    let window = ChromeWindow(id: 20, pid: 7, rect: document, layer: 0, alpha: 1)
    let menuWindow = ChromeWindow(id: 21, pid: 7, rect: menu, layer: 0, alpha: 1)
    check(stableSafariDocumentID(document, pid: 7, before: [window], after: [menuWindow, window]) == 20,
          "Opening a layer-zero menu must preserve the AX document identity")
    check(stableSafariDocumentID(document, pid: 7, before: [menuWindow, window], after: [window]) == 20,
          "Closing the menu must preserve the document identity")
    check(stableSafariDocumentID(document, pid: 7, before: [window], after: [ChromeWindow(id: 22, pid: 7, rect: document, layer: 0, alpha: 1)]) == nil,
          "A replacement document with identical bounds is not the same window")
    check(uniqueSafariDocumentID(document, pid: 7, windows: [window, ChromeWindow(id: 22, pid: 7, rect: document, layer: 0, alpha: 1)]) == nil,
          "Identical candidate windows must fail closed")
    check(uniqueSafariDocumentID(document, pid: 7, windows: [ChromeWindow(id: 20, pid: 8, rect: document, layer: 0, alpha: 1)]) == nil,
          "Another application's matching rectangle cannot become Safari's document")
    check(uniqueSafariDocumentID(document, pid: 7, windows: [ChromeWindow(id: 20, pid: 7, rect: document, layer: 101, alpha: 1)]) == nil,
          "A floating window is not a normal document")
    check(uniqueSafariDocumentID(document, pid: 7, windows: [ChromeWindow(id: 20, pid: 7, rect: document, layer: 0, alpha: 0)]) == nil,
          "A transparent window is not positive on-screen evidence")
    check(uniqueSafariDocumentID(CGRect(x: CGFloat.infinity, y: 0, width: 100, height: 100), pid: 7, windows: [window]) == nil,
          "Invalid geometry must never be matched")
    check(safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [menuWindow, window]),
          "A real matching Safari menu window supplies positive visibility")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [window]),
          "Retained AX menu geometry without a menu window must fail closed")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [ChromeWindow(id: 21, pid: 8, rect: menu, layer: 0, alpha: 1), window]),
          "Another application's popup cannot corroborate Safari's menu")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [ChromeWindow(id: 21, pid: 7, rect: menu, layer: 0, alpha: 0), window]),
          "A transparent menu is not visible")
    check(!safariMenuWindowIsVisible(document, document: document, pid: 7, windows: [window]),
          "The document itself cannot be misclassified as a visible menu")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [menuWindow, ChromeWindow(id: 22, pid: 7, rect: menu, layer: 0, alpha: 1), window]),
          "Ambiguous popup windows must fail closed")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [menuWindow]),
          "A popup without its matched document cannot supply visibility")
    check(!safariMenuWindowIsVisible(menu, document: document, pid: 7, windows: [ChromeWindow(id: 21, pid: 7, rect: menu, layer: -1, alpha: 1), window]),
          "A below-normal window cannot corroborate a menu")

    func menuSource(_ visibleCount: Int?, explicit: Bool? = nil, windowPresent: Bool = false, hidden: Bool = false) -> SafariMenuChildSource {
        safariMenuChildSource(hidden: hidden, explicitVisibility: explicit, visibleChildCount: visibleCount, hasMenuWindow: windowPresent)
    }
    check(menuSource(0, explicit: true) == .children,
          "An explicitly open menu must expose AXChildren despite an empty AXVisibleChildren list")
    check(menuSource(nil, explicit: true) == .children,
          "An explicitly open menu with unavailable AXVisibleChildren must expose AXChildren")
    check(menuSource(0, windowPresent: true) == .children,
          "A matching current menu window corroborates open state despite empty AXVisibleChildren")
    check(menuSource(nil, windowPresent: true) == .children,
          "A matching current menu window corroborates open state when visibility attributes are unavailable")
    check(menuSource(2) == .visibleChildren,
          "A positive visible-child list remains sufficient visibility evidence")
    check(menuSource(2, explicit: true, windowPresent: true) == .visibleChildren,
          "Prefer the visible subset when it contains children rather than expanding to retained AXChildren")
    check(menuSource(0) == .none,
          "An empty list without positive evidence must not expose retained AXChildren")
    check(menuSource(nil) == .none,
          "Missing visibility information without a current menu window must fail closed")
    check(menuSource(0, explicit: false, windowPresent: true) == .none,
          "Explicitly closed state defeats conflicting menu-window evidence")
    check(menuSource(2, explicit: false, windowPresent: true) == .none,
          "Explicitly closed state defeats stale visible children and window evidence together")
    check(menuSource(2, explicit: true, windowPresent: true, hidden: true) == .none,
          "A hidden menu must never expose children despite conflicting positive evidence")
    check(menuSource(0, explicit: true, hidden: true) == .none,
          "A hidden menu must not take the new AXChildren fallback")
    let openThenClosed = [
        menuSource(0, windowPresent: true),
        menuSource(0),
        menuSource(nil),
        menuSource(2, explicit: false),
    ]
    check(openThenClosed == [.children, .none, .none, .none],
          "After a menu closes, prior open evidence cannot expose its retained children")

    check(safariChromeLabel("Add Bookmark…") == "Add Bookmark", "The actual ellipsis must normalize")
    check(safariChromeLabel("Add Bookmark...") == "Add Bookmark", "The ASCII ellipsis must normalize")
    check(safariChromeLabel("Hide Reader") == "Hide Reader", "Already-active Reader must be observable")
    check(safariChromeLabel("Reopen Last Closed Tab") == "Reopen Last Closed Tab", "Closed-tab action must be allowlisted")
    check(safariChromeLabel("Add") == nil, "Generic Add must never become an unscoped target")
    check(safariChromeLabel("Add Bookmark for Private Page") == nil, "Private or partial titles must not match")
    check(!namedRanges(in: "Show Reader Add Bookmark Reopen Last Closed Tab").contains { ["Show Reader", "Add Bookmark", "Reopen Last Closed Tab"].contains($0.0) },
          "New AX-only guides must not expand OCR recognition")
    check(safariMenuItemLabelMayBeRead(menu: "View", command: ""), "View's fixed command labels do not require a shortcut")
    check(safariMenuItemLabelMayBeRead(menu: "Bookmarks", command: "D"), "Add Bookmark's fixed shortcut allows its command label")
    check(safariMenuItemLabelMayBeRead(menu: "Bookmarks", command: "", identifier: "AddBookmark"), "Observed AddBookmark identifier also permits its fixed command label")
    check(safariMenuItemLabelMayBeRead(menu: "History", command: "t"), "Reopen's fixed shortcut allows its command label")
    check(safariMenuItemLabelMayBeRead(menu: "History", command: "", identifier: "ReopenLastClosedTab"), "Observed ReopenLastClosedTab identifier permits its fixed command label")
    check(!safariMenuItemLabelMayBeRead(menu: "History", command: ""), "History page titles must not be read")
    check(!safariMenuItemLabelMayBeRead(menu: "Bookmarks", command: "1"), "Saved bookmark titles must not be read")
    check(!safariMenuItemLabelMayBeRead(menu: nil, command: "d"), "A shortcut outside its known menu is insufficient")

    let sheet = CGRect(x: -900, y: 120, width: 560, height: 300)
    let add = SafariSheetControl(role: "AXButton", label: "Add", rect: CGRect(x: -470, y: 360, width: 90, height: 30), hidden: false)
    let cancel = SafariSheetControl(role: "AXButton", label: "Cancel", rect: CGRect(x: -580, y: 360, width: 90, height: 30), hidden: false)
    func isBookmark(_ controls: [SafariSheetControl], identifier: String = "AddBookmarkSheet", attached: Bool = true, visible: Bool = true, hidden: Bool = false) -> Bool {
        isSafariBookmarkSheet(sheet, document: document, identifier: identifier, attached: attached, visible: visible, hidden: hidden, controls: controls)
    }
    check(isBookmark([add, cancel]), "Observed bookmark identifier inside an attached sheet must allow scoped Add")
    check(!isBookmark([add, cancel], identifier: "UnrelatedSheet"), "An unrelated Add/Cancel dialog must fail closed")
    check(!isBookmark([add, cancel], attached: false), "An unattached sheet must not be accepted")
    check(!isBookmark([add, cancel], hidden: true), "A hidden sheet must not be accepted")
    check(!isBookmark([add, cancel], visible: false), "A retained sheet subtree without positive visibility must not expose Add")
    check(!isBookmark([add, add, cancel]), "Ambiguous Add buttons must fail closed")
    check(!isBookmark([cancel, SafariSheetControl(role: "AXButton", label: "Add", rect: add.rect, hidden: true)]),
          "A stale hidden Add button must not complete sheet evidence")
    check(!isBookmark([cancel, SafariSheetControl(role: "AXButton", label: "Add", rect: CGRect(x: 10, y: 10, width: 90, height: 30), hidden: false)]),
          "A different sheet's Add button must not be used")
    check(!isBookmark([cancel, SafariSheetControl(role: "AXStaticText", label: "Add", rect: add.rect, hidden: false)]),
          "Text saying Add is not a clickable Add button")
    check(!isBookmark([add, cancel, SafariSheetControl(role: "AXTextField", label: "Add this page to:", rect: add.rect, hidden: false)], identifier: ""),
          "User-entered text cannot replace the fixed bookmark identifier")
    print("\(count) Safari chrome, sheet and document identity checks passed")
    runSafariObservationBudgetTests()
    runSafariEnabledEvidenceTests()
}

private func runSafariEnabledEvidenceTests() {
    var count = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError(message) }
        count += 1
    }
    check(observedChromeEnabled(safari: true, role: "AXMenuItem", enabled: nil) == nil,
          "Unreadable AXEnabled must omit a Safari command, not claim it is disabled")
    check(observedChromeEnabled(safari: true, role: "AXMenuItem", enabled: false) == false,
          "An explicitly disabled Safari command must remain available as disabled evidence")
    check(observedChromeEnabled(safari: true, role: "AXMenuItem", enabled: true) == true,
          "An explicitly enabled Safari command can be emitted")
    check(observedChromeEnabled(safari: true, role: "AXMenuBarItem", enabled: nil) == true,
          "Unreadable command state must not remove the View menu-bar anchor")
    check(observedChromeEnabled(safari: false, role: "AXMenuItem", enabled: nil) == true,
          "This change must not silently alter other applications' observation")
    let display = CGRect(x: -1440, y: -900, width: 1440, height: 900)
    let anchor = CGRect(x: -1240, y: -898, width: 50, height: 24)
    for label in ["View", "보기"] {
        check(safariOCRAnchorIsPermitted(label: label, rect: anchor, display: display),
              "A recognized View anchor within a negative-origin display's menu bar must remain usable")
    }
    for label in ["Zoom In", "확대"] {
        check(!safariOCRAnchorIsPermitted(label: label, rect: anchor, display: display),
              "OCR text must never invent an enabled zoom command even at menu-bar coordinates")
    }
    check(!safariOCRAnchorIsPermitted(label: "View", rect: CGRect(x: -1240, y: -700, width: 50, height: 24), display: display),
          "Text saying View inside a webpage cannot become the menu-bar anchor")
    check(!safariOCRAnchorIsPermitted(label: "View", rect: CGRect(x: 20, y: -898, width: 50, height: 24), display: display),
          "Off-display OCR geometry must not become an anchor")
    print("\(count) Safari enabled-state and OCR evidence checks passed")
}

// A bounded tree visitor stands in for expensive AX reads. The same region
// scheduler used by axObservation must preserve useful chrome before unrelated
// document nodes spend the shared budget. This is fixture evidence, not a live
// Safari timing or Accessibility-permission test.
private func runSafariObservationBudgetTests() {
    struct Node {
        let role: String
        var label: String? = nil
        var enabled = true
        var children: [Node] = []
    }
    let toolbar = Node(role: "AXToolbar", children: (0..<40).map { _ in
        Node(role: "AXGroup", children: [Node(role: "AXButton")])
    })
    let document = Node(role: "AXWindow", children: [toolbar, Node(role: "AXWebArea")])
    let menu = Node(role: "AXMenuBar", children: [
        Node(role: "AXMenuBarItem"), Node(role: "AXMenuBarItem"), Node(role: "AXMenuBarItem"),
        Node(role: "AXMenuBarItem", label: "View", children: [
            Node(role: "AXMenu", children: [
                Node(role: "AXMenuItem", label: "Zoom In", enabled: false),
                Node(role: "AXMenuItem", label: "Zoom Out", enabled: false)
            ])
        ])
    ])
    let sheet = Node(role: "AXSheet", children: [
        Node(role: "AXButton", label: "Add"), Node(role: "AXButton", label: "Cancel")
    ])
    func scan(safari: Bool, document: Node, menu: Node, sheets: [Node] = [], budget: Int = 18) -> (labels: [String: Bool], visited: Int) {
        var labels: [String: Bool] = [:]
        var visited = 0
        func walk(_ node: Node) {
            guard visited < budget else { return }
            visited += 1
            if let label = node.label { labels[label] = node.enabled }
            if node.role != "AXWebArea" { for child in node.children { walk(child) } }
        }
        visitObservationRegions(safari: safari, attachedSheets: { sheets.forEach(walk) },
                                menuBar: { walk(menu) }, document: { walk(document) })
        return (labels, visited)
    }
    var count = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError(message) }
        count += 1
    }
    let priorOrder = scan(safari: false, document: document, menu: menu)
    check(priorOrder.visited == 18 && priorOrder.labels["Zoom In"] == nil,
          "Document-first traversal must reproduce menu starvation under the fixture budget")
    let prioritized = scan(safari: true, document: document, menu: menu)
    check(prioritized.labels["View"] == true && prioritized.labels["Zoom In"] == false,
          "Menu-first observation must retain the actual disabled Zoom In evidence")
    check(prioritized.visited == 18,
          "Menu priority must reuse the bounded observation budget rather than silently extending it")
    let attached = scan(safari: true, document: document, menu: menu, sheets: [sheet])
    check(attached.labels["Add"] == true && attached.labels["Zoom In"] == false,
          "An attached bookmark sheet and menu must both precede the large document tree")
    let busyMenu = Node(role: "AXMenuBar", children: (0..<40).map { _ in Node(role: "AXMenuBarItem") })
    let sheetFirst = scan(safari: true, document: document, menu: busyMenu, sheets: [sheet])
    check(sheetFirst.labels["Add"] == true && sheetFirst.labels["Cancel"] == true,
          "A large menu must not starve the attached bookmark sheet's controls")
    let finder = Node(role: "AXWindow", children: [Node(role: "AXOutline", label: "Downloads")])
    check(scan(safari: false, document: finder, menu: busyMenu).labels["Downloads"] == true,
          "Other applications must retain document-first traversal")
    print("\(count) Safari observation budget checks passed")
}
