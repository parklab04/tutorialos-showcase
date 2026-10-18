import AppKit
import ApplicationServices
import ScreenCaptureKit
import Vision

// Each visitor shares the observation's time/node budget. Safari's document
// toolbar and tab tree are unrelated to menu lessons and can consume that whole
// budget. An attached bookmark sheet is the exception: its Add button must stay
// ahead of the menu scan while the learner is saving a bookmark.
func visitObservationRegions(safari: Bool, finder: Bool = false, attachedSheets: () -> Void, menuBar: () -> Void, document: () -> Void) {
    if safari {
        attachedSheets()
        menuBar()
        document()
    } else if finder {
        menuBar()
        document()
    } else {
        document()
        menuBar()
    }
}

// Missing AXEnabled means the command's state was not read. It must not turn
// into either clickable guidance or a definite "unavailable" message.
func observedChromeEnabled(safari: Bool, role: String, enabled: Bool?) -> Bool? {
    safari && role == "AXMenuItem" ? enabled : enabled ?? true
}

func safariOCRAnchorIsPermitted(label: String, rect: CGRect, display: CGRect) -> Bool {
    // OCR can locate View, but cannot distinguish an enabled Zoom In command
    // from the same greyed-out text on Start Page. Commands require AX evidence.
    ["View", "보기"].contains(label) && finiteRect(rect) && display.contains(rect) && rect.midY < display.minY + 42
}

func axObservation(_ application: NSRunningApplication, chromeSnapshot: [ChromeWindow]? = nil) -> (CGRect?, [[String: Any]], String?) {
    let root = AXUIElementCreateApplication(application.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 0.05)
    let safari = application.bundleIdentifier == "com.apple.Safari"
    let finder = application.bundleIdentifier == "com.apple.finder"
    let chromeSnapshot = (safari || finder) ? chromeSnapshot ?? chromeWindows() : nil
    let safariWindows = chromeSnapshot ?? []
    var finderMenuContext = "unknown"
    var elements: [[String: Any]] = []
    var visited = 0
    var visitedSheets: Set<CFHashCode> = []
    var visibleSheets: [AXUIElement] = []
    var documentRoot: AXUIElement?
    var window: CGRect?
    let start = Date()
    func withinBudget(_ depth: Int) -> Bool {
        !Task.isCancelled && depth <= 13 && visited < 650 && elements.count < 200 && Date().timeIntervalSince(start) < 0.65
    }
    func documentWindow(_ element: AXUIElement) -> Bool {
        let role = stringAttribute(element, kAXRoleAttribute)
        return finder ? finderWindowMayBeDocument(role: role, subrole: attribute(element, kAXSubroleAttribute) as? String,
                                                  minimized: (attribute(element, kAXMinimizedAttribute) as? Bool) == true) : role == "AXWindow"
    }
    func finderMenus(_ bar: AXUIElement) {
        guard let document = window, let chromeSnapshot,
              uniqueSafariDocumentID(document, pid: application.processIdentifier, windows: chromeSnapshot) != nil,
              let menuItems = attribute(bar, kAXChildrenAttribute) as? [AXUIElement], !menuItems.isEmpty else { return }
        var complete = true
        var menuStates: [(file: Bool, visibility: FinderMenuVisibility)] = []
        for item in menuItems {
            guard withinBudget(0) else { complete = false; break }
            visited += 1
            AXUIElementSetMessagingTimeout(item, 0.05)
            guard let role = attribute(item, kAXRoleAttribute) as? String else { complete = false; continue }
            guard role == "AXMenuBarItem" else { continue }
            // Menu-bar titles are fixed app chrome, never file-list contents.
            let isFile = finderFileMenuAnchor(stringAttribute(item, kAXTitleAttribute)) != nil
            if isFile, let rect = rectOf(item), finiteRect(rect), (attribute(item, "AXHidden") as? Bool) != true {
                elements.append(["id": "ax-\(visited)", "role": role, "label": "File", "enabled": true, "rect": dict(rect)])
            }
            guard let children = attribute(item, kAXChildrenAttribute) as? [AXUIElement], !children.isEmpty else { complete = false; continue }
            var foundMenu = false
            for menu in children {
                guard withinBudget(1) else { complete = false; break }
                visited += 1
                AXUIElementSetMessagingTimeout(menu, 0.05)
                guard let childRole = attribute(menu, kAXRoleAttribute) as? String else { complete = false; continue }
                guard childRole == "AXMenu" else { continue }
                foundMenu = true
                let rect = rectOf(menu)
                let hidden = attribute(menu, "AXHidden") as? Bool
                let explicit = attribute(menu, "AXVisible") as? Bool
                let visible = attribute(menu, kAXVisibleChildrenAttribute) as? [AXUIElement]
                let hasWindow = rect.map { safariMenuWindowIsVisible($0, document: document, pid: application.processIdentifier, windows: chromeSnapshot) }
                let visibility = finderMenuVisibility(hidden: hidden, explicitVisibility: explicit, visibleChildCount: visible?.count,
                                                      hasMenuWindow: hasWindow, validGeometry: rect.map(finiteRect) ?? false)
                menuStates.append((isFile, visibility))
                // Inspect command text only in File. Other menus and nested
                // submenus (including lists of apps/files) never get traversed.
                guard isFile, visibility == .visible, let rect else { continue }
                let commands: [AXUIElement]?
                switch safariMenuChildSource(hidden: hidden == true, explicitVisibility: explicit, visibleChildCount: visible?.count, hasMenuWindow: hasWindow == true) {
                case .none: commands = nil
                case .visibleChildren: commands = visible
                case .children: commands = attribute(menu, kAXChildrenAttribute) as? [AXUIElement]
                }
                guard let commands else { complete = false; continue }
                for commandItem in commands {
                    guard withinBudget(2) else { complete = false; break }
                    visited += 1
                    AXUIElementSetMessagingTimeout(commandItem, 0.05)
                    guard stringAttribute(commandItem, kAXRoleAttribute) == "AXMenuItem",
                          (attribute(commandItem, "AXHidden") as? Bool) != true,
                          let enabled = attribute(commandItem, kAXEnabledAttribute) as? Bool,
                          let commandRect = rectOf(commandItem), finiteRect(commandRect), rect.insetBy(dx: -2, dy: -2).contains(commandRect) else { continue }
                    let shortcut = stringAttribute(commandItem, "AXMenuItemCmdChar")
                    let virtualKey = (attribute(commandItem, "AXMenuItemCmdVirtualKey") as? NSNumber)?.intValue
                    let modifiers = (attribute(commandItem, "AXMenuItemCmdModifiers") as? NSNumber)?.intValue
                    // Only the exact fixed command is retained. Quick Look's
                    // dynamic suffix is normalized before any output escapes.
                    if let record = finderFileMenuRecord(id: "ax-\(visited)", role: "AXMenuItem", title: stringAttribute(commandItem, kAXTitleAttribute),
                                                        menu: "File", visible: true, enabled: enabled, menuRect: rect, rect: commandRect,
                                                        command: shortcut, virtualKey: virtualKey, modifiers: modifiers) { elements.append(record) }
                }
            }
            if !foundMenu { complete = false }
        }
        finderMenuContext = finderObservedMenuContext(menuStates, complete: complete)
    }
    func bookmarkSheet(_ sheet: AXUIElement, depth: Int) {
        guard withinBudget(depth), let document = window, !visitedSheets.contains(CFHash(sheet)),
              stringAttribute(sheet, kAXRoleAttribute) == "AXSheet", let sheetRect = rectOf(sheet),
              stringAttribute(sheet, kAXIdentifierAttribute) == "AddBookmarkSheet",
              (attribute(sheet, "AXHidden") as? Bool) != true else { return }
        let explicitVisibility = attribute(sheet, "AXVisible") as? Bool
        let positiveVisibility = visibleSheets.contains { CFEqual($0, sheet) } || explicitVisibility == true ||
            safariMenuWindowIsVisible(sheetRect, document: document, pid: application.processIdentifier, windows: safariWindows)
        guard explicitVisibility != false, positiveVisibility else { return }
        visitedSheets.insert(CFHash(sheet))
        var controls: [SafariSheetControl] = []
        var addRecords: [[String: Any]] = []
        var complete = true
        func scan(_ element: AXUIElement, depth: Int) {
            guard withinBudget(depth) else { complete = false; return }
            visited += 1
            AXUIElementSetMessagingTimeout(element, 0.05)
            if (attribute(element, "AXHidden") as? Bool) == true { return }
            let role = stringAttribute(element, kAXRoleAttribute)
            if ["AXWebArea", "AXTextArea", "AXTextField", "AXSecureTextField"].contains(role) { return }
            if role == "AXSheet", CFHash(element) != CFHash(sheet) { return }
            if role == "AXButton", let rect = rectOf(element) {
                // Only fixed application chrome is retained. Field values and
                // document, tab, bookmark-name and window titles are never read.
                let labels = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].map { stringAttribute(element, $0) }
                let allowed: Set<String> = ["Add", "Cancel"]
                if let label = labels.first(where: { allowed.contains($0) }) {
                    controls.append(SafariSheetControl(role: role, label: label, rect: rect, hidden: false))
                    if role == "AXButton", label == "Add" {
                        addRecords.append(["id": "ax-\(visited)", "role": role, "label": label,
                            "enabled": (attribute(element, kAXEnabledAttribute) as? Bool) == true,
                            "rect": dict(rect), "scope": "bookmark-sheet"])
                    }
                }
            }
            if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
                for child in children { scan(child, depth: depth + 1) }
            }
        }
        scan(sheet, depth: depth)
        if complete, isSafariBookmarkSheet(sheetRect, document: document, identifier: "AddBookmarkSheet", attached: true, visible: positiveVisibility, hidden: false, controls: controls) {
            elements.append(contentsOf: addRecords)
        }
    }
    func walk(_ element: AXUIElement, depth: Int, selected: Bool, visibleMenu: CGRect? = nil, menuName: String? = nil) {
        guard withinBudget(depth) else { return }
        visited += 1
        // AX timeouts belong to each object, not its application root.
        AXUIElementSetMessagingTimeout(element, 0.05)
        // Hidden containers may retain controls and bounds in their AX subtree.
        // Match the call observer: never use those as live fallback targets.
        let hidden = (attribute(element, "AXHidden") as? Bool) == true
        if hidden { return }
        let role = stringAttribute(element, kAXRoleAttribute)
        // The lessons need application chrome, never webpage bodies or editable text.
        if ["AXWebArea", "AXTextArea", "AXTextField", "AXSecureTextField"].contains(role) { return }
        if safari, role == "AXSheet" { bookmarkSheet(element, depth: depth); return }
        let isSelected = (attribute(element, kAXSelectedAttribute) as? Bool) ?? selected
        // Safari only needs menu chrome. In particular, do not read document
        // window/tab titles or article text while searching for these lessons.
        let menuCommandMayBeRead = role == "AXMenuItem" && visibleMenu != nil &&
            safariMenuItemLabelMayBeRead(menu: menuName, command: stringAttribute(element, "AXMenuItemCmdChar"), identifier: stringAttribute(element, kAXIdentifierAttribute))
        // The foreground fallback must not reinterpret an identified FaceTime
        // switch through AXHelp after the strict call observer rejected it.
        let fallbackIdentifier = application.bundleIdentifier == "com.apple.FaceTime" ? stringAttribute(element, kAXIdentifierAttribute) : nil
        let eligibleRole = mayReadFaceTimeLegacyLabels(bundleIdentifier: application.bundleIdentifier, nativeIdentifier: fallbackIdentifier) && (!safari || role == "AXMenuBarItem" || menuCommandMayBeRead)
        let candidates = eligibleRole ? [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].map { stringAttribute(element, $0) } : []
        let label = candidates.compactMap({ safari ? safariChromeLabel($0) : canonical($0) }).first
        let childMenuName = safari && role == "AXMenuBarItem" ? label : menuName
        if let label, let rect = rectOf(element), finiteRect(rect),
           !safari || role != "AXMenuItem" || visibleMenu?.insetBy(dx: -2, dy: -2).contains(rect) == true {
            if let enabled = observedChromeEnabled(safari: safari, role: role, enabled: attribute(element, kAXEnabledAttribute) as? Bool) {
                var record: [String: Any] = ["id": "ax-\(visited)", "role": role, "label": label, "enabled": enabled, "rect": dict(rect), "selected": isSelected]
                if !safari, let value = numberOrBool(attribute(element, kAXValueAttribute)) { record["value"] = value }
                elements.append(record)
            }
        }
        if safari, role == "AXMenu" {
            // Collapsed menus may retain AXChildren and old bounds. Only a
            // positive visible-children list, explicit visibility, or matching
            // on-screen Safari menu window can expose menu-item targets.
            guard let menuRect = rectOf(element), finiteRect(menuRect) else { return }
            let visible = attribute(element, kAXVisibleChildrenAttribute) as? [AXUIElement]
            let explicitVisibility = attribute(element, "AXVisible") as? Bool
            let hasMenuWindow = window.map { safariMenuWindowIsVisible(menuRect, document: $0, pid: application.processIdentifier, windows: safariWindows) } ?? false
            let children: [AXUIElement]?
            switch safariMenuChildSource(hidden: hidden, explicitVisibility: explicitVisibility, visibleChildCount: visible?.count, hasMenuWindow: hasMenuWindow) {
            case .none: children = nil
            case .visibleChildren: children = visible
            case .children: children = attribute(element, kAXChildrenAttribute) as? [AXUIElement]
            }
            if let children { for child in children { walk(child, depth: depth + 1, selected: isSelected, visibleMenu: menuRect, menuName: childMenuName) } }
            return
        }
        if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            for child in children { walk(child, depth: depth + 1, selected: isSelected, visibleMenu: visibleMenu, menuName: childMenuName) }
        }
    }
    let focused = attribute(root, kAXFocusedWindowAttribute)
    if let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
        let focusedElement = focused as! AXUIElement
        var focusedWindow = focusedElement
        if safari || finder, !documentWindow(focusedWindow) {
            // A sheet is not a new document identity. Resolve its owning window
            // through AX, never by choosing the frontmost CG menu or sheet.
            var owner: AXUIElement?
            if let candidate = attribute(focusedElement, kAXWindowAttribute), CFGetTypeID(candidate) == AXUIElementGetTypeID(),
               documentWindow(candidate as! AXUIElement) { owner = (candidate as! AXUIElement) }
            var ancestor = focusedElement
            for _ in 0..<4 where owner == nil && withinBudget(0) {
                guard let parent = attribute(ancestor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                ancestor = parent as! AXUIElement
                AXUIElementSetMessagingTimeout(ancestor, 0.05)
                if documentWindow(ancestor) { owner = ancestor }
            }
            if owner == nil {
                var windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
                // A main window alone does not establish that a Quick Look
                // panel belongs to it. It is only a candidate for the same
                // explicit attached-child check used for AXSheets below.
                if finder, let main = attribute(root, kAXMainWindowAttribute), CFGetTypeID(main) == AXUIElementGetTypeID() {
                    let candidate = main as! AXUIElement
                    if !windows.contains(where: { CFEqual($0, candidate) }) { windows.insert(candidate, at: 0) }
                }
                var owners: [AXUIElement] = []
                for candidate in windows.prefix(8) where withinBudget(0) {
                    AXUIElementSetMessagingTimeout(candidate, 0.05)
                    guard documentWindow(candidate) else { continue }
                    let sheets = attribute(candidate, "AXSheets") as? [AXUIElement] ?? []
                    let children = attribute(candidate, kAXChildrenAttribute) as? [AXUIElement] ?? []
                    let attached = (sheets + children).contains(where: { CFEqual($0, focusedElement) })
                    if finder {
                        if finderAttachedDocumentIsValid(attached: attached, role: stringAttribute(candidate, kAXRoleAttribute),
                                                         subrole: attribute(candidate, kAXSubroleAttribute) as? String,
                                                         minimized: (attribute(candidate, kAXMinimizedAttribute) as? Bool) == true,
                                                         rect: rectOf(candidate), pid: application.processIdentifier,
                                                         windows: chromeSnapshot ?? []) { owners.append(candidate) }
                    } else if attached { owners.append(candidate) }
                }
                if owners.count == 1 { owner = owners[0] }
            }
            guard let owner else { return (nil, [], finder ? "unknown" : nil) }
            focusedWindow = owner
        }
        AXUIElementSetMessagingTimeout(focusedWindow, 0.05)
        if finder, (attribute(focusedWindow, kAXMinimizedAttribute) as? Bool) == true { return (nil, [], "unknown") }
        window = rectOf(focusedWindow)
        documentRoot = focusedWindow
        if safari {
            visibleSheets = attribute(focusedWindow, "AXSheets") as? [AXUIElement] ?? []
            if stringAttribute(focusedElement, kAXRoleAttribute) == "AXSheet" { visibleSheets.insert(focusedElement, at: 0) }
        }
    }
    // Resolve the focused document before reading menu visibility. Do not let a
    // menu's layer-zero CG window become this observation's document identity.
    visitObservationRegions(safari: safari, finder: finder, attachedSheets: {
        for sheet in visibleSheets { bookmarkSheet(sheet, depth: 1) }
    }, menuBar: {
        if let menu = attribute(root, kAXMenuBarAttribute), CFGetTypeID(menu) == AXUIElementGetTypeID() {
            if finder { finderMenus(menu as! AXUIElement) }
            else { walk(menu as! AXUIElement, depth: 0, selected: false) }
        }
    }, document: {
        // An open Finder menu owns the interaction. Its commands do not need
        // file-list/sidebar labels, and those trees must not spend this read's
        // remaining budget. Closed-menu Downloads observation stays unchanged.
        if !(finder && ["file", "other"].contains(finderMenuContext)), let documentRoot { walk(documentRoot, depth: 0, selected: false) }
    })
    return (window, elements, finder ? finderMenuContext : nil)
}

func recognizeControls(_ image: CGImage, region: CGRect, displayFrame: CGRect) throws -> [(String, CGRect)] {
    try Task.checkCancellation()
    let scaleX = Double(image.width) / displayFrame.width
    let scaleY = Double(image.height) / displayFrame.height
    let clipped = region.intersection(displayFrame)
    guard !clipped.isNull, clipped.width >= 3, clipped.height >= 3 else { return [] }
    let pixelRect = CGRect(x: (clipped.minX - displayFrame.minX) * scaleX, y: (clipped.minY - displayFrame.minY) * scaleY, width: clipped.width * scaleX, height: clipped.height * scaleY).integral
    guard let cropped = image.cropping(to: pixelRect) else { return [] }
    let actualRegion = CGRect(x: displayFrame.minX + pixelRect.minX / scaleX, y: displayFrame.minY + pixelRect.minY / scaleY, width: pixelRect.width / scaleX, height: pixelRect.height / scaleY)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US", "ko-KR"]
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.002
    try Task.checkCancellation()
    try VNImageRequestHandler(cgImage: cropped, options: [:]).perform([request])
    try Task.checkCancellation()
    var result: [(String, CGRect)] = []
    for item in request.results ?? [] {
        try Task.checkCancellation()
        guard let candidate = item.topCandidates(1).first, candidate.confidence >= 0.65 else { continue }
        for (label, range) in namedRanges(in: candidate.string) {
            guard let rectangle = try? candidate.boundingBox(for: range) else { continue }
            let box = rectangle.boundingBox
            let rect = globalRect(box, in: actualRegion)
            result.append((label, rect))
        }
    }
    return result
}

@available(macOS 14.2, *)
func ocrObservation(_ application: NSRunningApplication) async throws -> (CGRect?, [[String: Any]]) {
    try Task.checkCancellation()
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    try Task.checkCancellation()
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier,
          let front = frontWindow(application.processIdentifier),
          let targetApp = content.applications.first(where: { $0.processID == application.processIdentifier }),
          let targetWindow = content.windows.first(where: { $0.windowID == front.0 && $0.owningApplication?.processID == application.processIdentifier && $0.isOnScreen }),
          let display = content.displays.max(by: { $0.frame.intersection(targetWindow.frame).width * $0.frame.intersection(targetWindow.frame).height < $1.frame.intersection(targetWindow.frame).width * $1.frame.intersection(targetWindow.frame).height }) else { return (nil, []) }
    // Include only the selected application. Other applications' windows are excluded.
    let filter = SCContentFilter(display: display, including: [targetApp], exceptingWindows: [])
    filter.includeMenuBar = true
    let configuration = SCStreamConfiguration()
    configuration.width = Int(display.frame.width * 2)
    configuration.height = Int(display.frame.height * 2)
    configuration.showsCursor = false
    configuration.capturesAudio = false
    configuration.captureResolution = .best
    try Task.checkCancellation()
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    try Task.checkCancellation()
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier, frontWindow(application.processIdentifier)?.0 == targetWindow.windowID else { return (nil, []) }
    var elements: [[String: Any]] = []
    var recognized: [(String, CGRect)] = []
    if application.bundleIdentifier == "com.apple.Safari" {
        // Crop the real menu bar before recognition so tiny UI glyphs are not
        // downsampled alongside the entire desktop. No target position is invented.
        recognized = try recognizeControls(image, region: CGRect(x: display.frame.minX, y: display.frame.minY, width: display.frame.width, height: 50), displayFrame: display.frame)
    } else {
        let sidebar = CGRect(x: targetWindow.frame.minX, y: targetWindow.frame.minY + 35, width: min(320, targetWindow.frame.width * 0.4), height: targetWindow.frame.height - 35)
        recognized = try recognizeControls(image, region: sidebar, displayFrame: display.frame)
    }
    for (label, rect) in recognized {
        try Task.checkCancellation()
        var permitted = false
        if application.bundleIdentifier == "com.apple.Safari" {
            permitted = safariOCRAnchorIsPermitted(label: label, rect: rect, display: display.frame)
        } else if ["Downloads", "다운로드"].contains(label) {
            permitted = rect.midX < targetWindow.frame.minX + min(300, targetWindow.frame.width * 0.35) && rect.minY > targetWindow.frame.minY + 35 && targetWindow.frame.contains(rect)
        }
        if permitted { elements.append(["id": "ocr-\(elements.count)", "role": "OCRLabel", "label": label, "enabled": true, "rect": dict(rect)]) }
    }
    if application.bundleIdentifier == "com.apple.finder", let title = targetWindow.title, let label = canonical(title), ["Downloads", "다운로드"].contains(label) {
        elements.append(["id": "window-title", "role": "OCRWindowTitle", "label": label, "enabled": true, "selected": true, "rect": dict(targetWindow.frame)])
    }
    guard frontWindow(application.processIdentifier)?.0 == targetWindow.windowID else { return (nil, []) }
    return (targetWindow.frame, elements)
}
