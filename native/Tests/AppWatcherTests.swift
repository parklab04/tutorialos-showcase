import AppKit

@main
enum AppWatcherTests {
    static func main() {
        var checks = 0
        func expect(_ value: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            if !value() { fatalError(message) }
        }
        let validPath = "/Applications/HelpOS.app/Contents/MacOS/helpos-app-watcher"
        let expectedParent = URL(fileURLWithPath: "/Applications/HelpOS.app")
        func parent(_ path: String, identity: String? = helpOSBundleID) -> URL? {
            watcherParentApplication(executablePath: path, bundleIdentifier: { _ in identity })
        }
        expect(parent(validPath)?.path == expectedParent.path, "Absolute helper path must resolve to its parent bundle")
        expect(parent("Contents/MacOS/helpos-app-watcher") == nil, "Relative argv paths must not be trusted")
        expect(parent(validPath, identity: "example.other") == nil, "Wrong containing bundle identity must be rejected")
        expect(parent(validPath, identity: nil) == nil, "Missing bundle metadata must be rejected")
        expect(parent("/Applications/HelpOS.app/Contents/Resources/helpos-app-watcher") == nil, "Helper must occupy the exact MacOS location")
        expect(parent("/Applications/HelpOS.app/Contents/MacOS/another-helper") == nil, "A different executable must be rejected")
        expect(parent("/private/tmp/helpos-app-watcher") == nil, "Unbundled binaries must not launch an arbitrary parent")
        expect(parent("/Applications/Help OS.app/Contents/MacOS/helpos-app-watcher")?.lastPathComponent == "Help OS.app", "Spaces in bundle paths must remain valid")
        var failure = ""
        _ = watcherParentApplication(executablePath: validPath, bundleIdentifier: { _ in "example.other" }, reportFailure: { failure = $0 })
        expect(failure == "parent_bundle_identity_mismatch", "Identity failures must log only a fixed diagnostic code")
        failure = ""
        _ = watcherParentApplication(executablePath: "Contents/MacOS/helpos-app-watcher", bundleIdentifier: { _ in helpOSBundleID }, reportFailure: { failure = $0 })
        expect(failure == "executable_path_not_absolute", "Relative paths must log a bounded configuration reason")
        let actualPath = watcherExecutablePath()
        expect(actualPath?.hasPrefix("/") == true, "Kernel must return the actual absolute test executable path")
        expect(actualPath != "Contents/MacOS/helpos-app-watcher", "Executable lookup must not depend on a relative argv[0]")
        let safari = WatchedApplication(bundleID: "com.apple.Safari", pid: 10)
        let finder = WatchedApplication(bundleID: "com.apple.finder", pid: 20)
        let faceTime = WatchedApplication(bundleID: "com.apple.FaceTime", pid: 30)
        let helpOS = WatchedApplication(bundleID: helpOSBundleID, pid: 40)
        let other = WatchedApplication(bundleID: "example.other", pid: 50)
        var policy = AppActivationPolicy(baseline: safari)
        expect(policy.activate(safari, regular: true, timestamp: 1) == nil, "Startup baseline must not emit")
        expect(policy.activate(helpOS, regular: true, timestamp: 2) == nil, "HelpOS activation must be ignored")
        expect(policy.activate(safari, regular: true, timestamp: 3) == nil, "HelpOS bounce must preserve baseline")
        expect(policy.activate(other, regular: true, timestamp: 4) == nil, "Unsupported apps must not emit")
        let first = policy.activate(safari, regular: true, timestamp: 5)!
        expect(first.application == safari && first.timestamp == 5, "Episode must carry observed identity and time")
        expect(UUID(uuidString: first.id) != nil, "Episode ID must be a UUID")
        expect(policy.activate(safari, regular: true, timestamp: 6)?.id == first.id, "Launch and activation share one episode")
        _ = policy.deliveryFinished(id: "unrelated", succeeded: true)
        expect(policy.isCurrent(first), "A stale completion cannot deliver a new episode")
        let safariContext = AppContextSnapshot(bundleID: safari.bundleID, pid: safari.pid, window: CGRect(x: 100, y: 100, width: 800, height: 600), timestamp: 5)
        _ = policy.nextCheck(first, frontmostPID: safari.pid, context: safariContext)
        _ = policy.deliveryFinished(id: first.id, succeeded: true)
        expect(policy.activate(safari, regular: true, timestamp: 7) == nil, "Delivered episodes must not repeat")
        _ = policy.activate(helpOS, regular: true, timestamp: 8)
        expect(policy.activate(safari, regular: true, timestamp: 9) == nil, "Closing HelpOS must not immediately reopen it")
        _ = policy.activate(other, regular: false, timestamp: 10)
        expect(policy.activate(safari, regular: true, timestamp: 11) == nil, "Transient helper focus must not rearm")
        _ = policy.activate(nil, regular: true, timestamp: 12)
        expect(policy.activate(safari, regular: true, timestamp: 13) == nil, "Unknown focus must not rearm")
        _ = policy.activate(other, regular: true, timestamp: 14)
        let second = policy.activate(safari, regular: true, timestamp: 15)!
        expect(second.id != first.id, "Leaving for a regular app creates a fresh return episode")
        expect(!policy.isCurrent(first), "Late retries from a previous episode must be rejected")
        let switched = policy.activate(finder, regular: true, timestamp: 16)!
        expect(switched.application == finder && !policy.isCurrent(second), "Switching supported apps cancels the old episode")
        let call = policy.activate(faceTime, regular: true, timestamp: 17)!
        expect(call.application == faceTime, "FaceTime must be allowlisted")
        _ = policy.nextCheck(call, frontmostPID: faceTime.pid, context: AppContextSnapshot(bundleID: faceTime.bundleID, pid: faceTime.pid, window: safariContext.window, timestamp: 17))
        _ = policy.deliveryFinished(id: call.id, succeeded: true)
        policy.terminate(pid: 999)
        expect(policy.activate(faceTime, regular: true, timestamp: 18) == nil, "Unrelated termination cannot rearm")
        policy.terminate(pid: faceTime.pid)
        let relaunched = policy.activate(WatchedApplication(bundleID: faceTime.bundleID, pid: 31), regular: true, timestamp: 19)!
        expect(relaunched.id != call.id && relaunched.application.pid == 31, "Relaunch must create a fresh PID episode")
        expect(policy.activate(WatchedApplication(bundleID: "com.apple.Safari.evil", pid: 60), regular: true, timestamp: 20) == nil, "Whitelist matching must be exact")
        expect(policy.activate(WatchedApplication(bundleID: "com.apple.Finder", pid: 61), regular: true, timestamp: 21) == nil, "Finder bundle ID is case-sensitive")

        func context(_ app: WatchedApplication, window: CGRect? = CGRect(x: 100, y: 100, width: 800, height: 600)) -> AppContextSnapshot {
            AppContextSnapshot(bundleID: app.bundleID, pid: app.pid, window: window, timestamp: 100)
        }
        var lag = AppActivationPolicy(baseline: other)
        let waiting = lag.activate(faceTime, regular: true, timestamp: 100)!
        expect(lag.nextCheck(waiting, frontmostPID: other.pid, context: context(faceTime)) == .wait, "Delayed foreground metadata must retry")
        expect(lag.nextCheck(waiting, frontmostPID: faceTime.pid, context: context(other)) == .wait, "Delayed context metadata must retry")
        expect(lag.nextCheck(waiting, frontmostPID: faceTime.pid, context: context(faceTime, window: nil)) == .wait, "Delayed window creation must retry")
        expect(lag.nextCheck(waiting, frontmostPID: faceTime.pid, context: context(faceTime)) == .launch, "Fresh matching metadata can launch after transient mismatches")
        expect(lag.activate(faceTime, regular: true, timestamp: 101)?.id == waiting.id, "Duplicate activation keeps the in-flight visit")
        expect(lag.nextCheck(waiting, frontmostPID: faceTime.pid, context: context(faceTime)) == .ignore, "An in-flight launch cannot launch twice")
        expect(lag.deliveryFinished(id: waiting.id, succeeded: false), "First launch failure must permit retry")
        expect(lag.nextCheck(waiting, frontmostPID: faceTime.pid, context: context(faceTime)) == .launch, "A failed launch does not consume its visit")
        expect(!lag.deliveryFinished(id: waiting.id, succeeded: true), "Successful launch needs no retry")
        expect(lag.activate(faceTime, regular: true, timestamp: 102) == nil, "Successful delivery consumes the visit")

        var failing = AppActivationPolicy(baseline: other)
        let failed = failing.activate(safari, regular: true, timestamp: 200)!
        for attempt in 1...3 {
            expect(failing.nextCheck(failed, frontmostPID: safari.pid, context: context(safari)) == .launch, "Each permitted attempt starts one launch")
            expect(failing.deliveryFinished(id: failed.id, succeeded: false) == (attempt < 3), "Launch failures have a fixed three-attempt budget")
        }
        expect(failing.nextCheck(failed, frontmostPID: safari.pid, context: context(safari)) == .ignore, "Repeated failures cannot launch forever")
        _ = failing.activate(other, regular: true, timestamp: 201)
        let fresh = failing.activate(safari, regular: true, timestamp: 202)!
        expect(failing.nextCheck(fresh, frontmostPID: safari.pid, context: context(safari)) == .launch, "A new visit gets a new retry budget")
        expect(!failing.deliveryFinished(id: failed.id, succeeded: true), "Late old success cannot consume a new pending visit")
        expect(failing.isCurrent(fresh), "New visit remains current after old completion")
        expect(failing.nextCheck(fresh, frontmostPID: safari.pid, context: context(safari)) == .ignore, "Old completion cannot release the new in-flight launch")
        expect(!failing.deliveryFinished(id: fresh.id, succeeded: true), "New launch still finishes normally")

        var exhausted = AppActivationPolicy(baseline: other)
        let empty = exhausted.activate(finder, regular: true, timestamp: 300)!
        for check in 1...10 {
            expect(exhausted.nextCheck(empty, frontmostPID: other.pid, context: context(other)) == (check < 10 ? .wait : .ignore), "Transient readiness is bounded to ten checks")
        }
        expect(exhausted.nextCheck(empty, frontmostPID: finder.pid, context: context(finder)) == .ignore, "Late readiness cannot exceed this visit's budget")
        _ = exhausted.activate(safari, regular: true, timestamp: 301)
        expect(exhausted.nextCheck(empty, frontmostPID: finder.pid, context: context(finder)) == .ignore, "Real app switches cancel old readiness retries")

        let display = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let window = CGRect(x: 100, y: 100, width: 800, height: 600)
        func record(pid: pid_t = 10, layer: Int = 0, onscreen: Bool = true, alpha: Double = 1, rect: CGRect = CGRect(x: 100, y: 100, width: 800, height: 600)) -> [String: Any] {
            [kCGWindowOwnerPID as String: NSNumber(value: pid), kCGWindowLayer as String: NSNumber(value: layer),
             kCGWindowIsOnscreen as String: NSNumber(value: onscreen), kCGWindowAlpha as String: NSNumber(value: alpha),
             kCGWindowBounds as String: rect.dictionaryRepresentation]
        }
        func find(_ rows: [[String: Any]], displays: [CGRect] = [CGRect(x: 0, y: 0, width: 1512, height: 982)]) -> CGRect? {
            appContextWindow(pid: 10, records: rows, displays: displays)
        }
        expect(find([record()]) == window, "Normal visible window must be accepted")
        expect(find([record(pid: 99)]) == nil, "Unrelated app windows must be excluded")
        expect(find([record(layer: -2147483628)]) == nil, "Finder desktop cannot wake HelpOS")
        expect(find([record(layer: 25)]) == nil, "Menu or floating layers cannot count as a normal window")
        expect(find([record(onscreen: false)]) == nil, "Minimized or hidden windows must be excluded")
        expect(find([record(alpha: 0)]) == nil, "Transparent windows must be excluded")
        expect(find([record(alpha: .nan)]) == nil, "Invalid alpha must be excluded")
        expect(find([record(rect: .zero)]) == nil, "Empty bounds must be excluded")
        expect(find([record(rect: CGRect(x: 3000, y: 0, width: 800, height: 600))]) == nil, "Off-display bounds must be excluded")
        expect(find([record()], displays: []) == nil, "Unknown display geometry cannot imply visible")
        let negative = CGRect(x: -1000, y: -500, width: 800, height: 600)
        expect(find([record(rect: negative)], displays: [CGRect(x: -1512, y: -982, width: 1512, height: 982), display]) == negative, "Negative display coordinates remain global")
        let partial = CGRect(x: 1400, y: 100, width: 800, height: 600)
        expect(find([record(rect: partial)]) == partial, "Partially visible normal windows retain real bounds")
        var missing = record(); missing.removeValue(forKey: kCGWindowBounds as String)
        expect(find([missing]) == nil, "Missing bounds cannot be guessed")
        var missingAlpha = record(); missingAlpha.removeValue(forKey: kCGWindowAlpha as String)
        expect(find([missingAlpha]) == nil, "Unknown visibility cannot be assumed")
        expect(find([record(pid: 99), record()]) == window, "Selector finds the first matching normal window")

        func ids(_ visible: [CGWindowID], all: [CGWindowID]? = nil) -> AppContextWindowIDs {
            AppContextWindowIDs(visible: Set(visible), all: Set(all ?? visible))
        }
        var windows = AppWindowEpisodePolicy(baseline: safari, windows: ids([11]))
        expect(!windows.observe(safari, windows: ids([11])), "Startup with a visible window is silent")
        expect(!windows.observe(safari, windows: ids([11])), "Dismissing an offer without a window change cannot repeat it")
        expect(!windows.observe(safari, windows: nil), "Unreadable metadata cannot arm an empty-window transition")
        expect(!windows.observe(safari, windows: ids([11])), "The same window after a failed read remains the same visit")
        expect(!windows.observe(safari, windows: ids([], all: [11])), "Minimizing a window is not closing it")
        expect(!windows.observe(safari, windows: ids([11])), "Restoring the same minimized window cannot repeat help")
        expect(!windows.observe(safari, windows: ids([11, 12])), "Adding a window while an existing window persists cannot repeat help")
        expect(!windows.observe(safari, windows: ids([12])), "Closing one of multiple windows cannot rearm help")
        expect(!windows.observe(safari, windows: ids([12, 13])), "An overlapping window population remains one visit")
        expect(!windows.observe(safari, windows: ids([13])), "Successively closing older windows is not an all-window replacement")
        expect(!windows.observe(safari, windows: ids([])), "Closing the last window only arms a future appearance")
        expect(!windows.observe(safari, windows: ids([])), "Repeated empty samples must not emit")
        expect(windows.observe(safari, windows: ids([31])), "A window after confirmed absence creates one new episode")
        expect(!windows.observe(safari, windows: ids([31])), "The new episode must not repeat on the next poll")
        expect(windows.observe(safari, windows: ids([32])), "Disjoint window IDs catch fast close/reopen between samples")
        expect(!windows.observe(safari, windows: ids([32])), "A fast replacement emits only once")
        expect(!windows.observe(safari, windows: ids([], all: [33])), "A replacement that is not visible must wait")
        expect(windows.observe(safari, windows: ids([33])), "The replacement's first visible sample emits once")
        expect(!windows.observe(safari, windows: ids([], all: [33])), "Minimization after delivery preserves its window ID")
        expect(!windows.observe(safari, windows: ids([34], all: [33, 34])), "A new visible window while an older minimized window persists is not a new population")
        expect(!windows.observe(safari, windows: ids([33])), "Restoring the older window after closing the newer one must not repeat help")
        windows.activate(helpOS, regular: true)
        expect(!windows.observe(helpOS, windows: ids([])), "HelpOS focus cannot become Safari absence")
        windows.activate(safari, regular: true)
        expect(!windows.observe(safari, windows: ids([33])), "HelpOS focus bounce keeps the Safari baseline")
        windows.activate(other, regular: false)
        expect(!windows.observe(safari, windows: ids([33])), "Transient helper focus cannot rearm windows")
        expect(!windows.observe(finder, windows: ids([])), "A mismatching foreground sample must not alter Safari's baseline")
        expect(!windows.observe(safari, windows: ids([99], all: [])), "Inconsistent ID metadata is unknown, not an empty population")
        expect(!windows.observe(safari, windows: ids([33])), "Rejected metadata retains the last valid population")
        windows.activate(other, regular: true)
        windows.activate(safari, regular: true)
        expect(!windows.observe(safari, windows: ids([41])), "A real app return is already handled by activation; its window baseline is silent")
        windows.terminate(pid: 999)
        expect(!windows.observe(safari, windows: ids([41])), "Unrelated termination does not reset the window baseline")
        windows.terminate(pid: safari.pid)
        expect(!windows.observe(safari, windows: ids([42])), "A terminated identity cannot emit without a fresh activation")
        windows.activate(safari, regular: true)
        expect(!windows.observe(safari, windows: ids([42])), "Relaunch receives a silent window baseline alongside its activation episode")
        var emptyBaseline = AppWindowEpisodePolicy(baseline: safari, windows: ids([]))
        expect(emptyBaseline.observe(safari, windows: ids([51])), "Startup while the app has no window can detect a later actual opening")
        expect(!emptyBaseline.observe(safari, windows: ids([51])), "An initially empty app emits only for the first opening")
        var unknownBaseline = AppWindowEpisodePolicy(baseline: safari)
        expect(!unknownBaseline.observe(safari, windows: nil), "Startup read errors do not manufacture absence")
        expect(!unknownBaseline.observe(safari, windows: ids([61])), "The first known sample after a startup error is only a baseline")

        // Real Safari metadata retained these six hidden layer-zero IDs around
        // the one visible document. Never-visible helpers are not documents.
        let hiddenSafariIDs: [CGWindowID] = [16249, 16250, 16251, 16252, 17388, 17395]
        func safariWindows(_ visible: [CGWindowID], documents: [CGWindowID]? = nil) -> AppContextWindowIDs {
            ids(visible, all: hiddenSafariIDs + (documents ?? visible))
        }
        var retainedHelpers = AppWindowEpisodePolicy(baseline: safari, windows: safariWindows([17393]))
        expect(!retainedHelpers.observe(safari, windows: safariWindows([17393])), "Captured Safari document and hidden helpers form a silent baseline")
        expect(!retainedHelpers.observe(safari, windows: safariWindows([])), "Removing the document while hidden helpers persist waits for reopening")
        expect(!retainedHelpers.observe(safari, windows: safariWindows([])), "Persistent hidden helpers cannot repeatedly emit")
        expect(!retainedHelpers.observe(safari, windows: nil), "A read failure cannot discard a confirmed closed-document transition")
        expect(retainedHelpers.observe(safari, windows: safariWindows([18000])), "Hidden Safari helpers must not suppress a reopened document")
        expect(!retainedHelpers.observe(safari, windows: safariWindows([18000])), "The reopened document emits only once despite persistent helpers")
        expect(!retainedHelpers.observe(safari, windows: safariWindows([], documents: [18000])), "A known document that remains in all is minimized or hidden, not closed")
        expect(!retainedHelpers.observe(safari, windows: safariWindows([18000])), "Restoring a known document with hidden helpers cannot repeat help")
        expect(retainedHelpers.observe(safari, windows: safariWindows([18001])), "A fast document replacement is detected even when hidden IDs overlap")
        retainedHelpers.activate(helpOS, regular: true)
        retainedHelpers.activate(safari, regular: true)
        expect(!retainedHelpers.observe(safari, windows: safariWindows([18001])), "HelpOS focus does not reset a cohort containing hidden helpers")

        var hiddenBaseline = AppWindowEpisodePolicy(baseline: safari, windows: safariWindows([], documents: [18100]))
        expect(!hiddenBaseline.observe(safari, windows: safariWindows([], documents: [18100])), "Hidden-only startup cannot classify hidden IDs as documents or absence")
        expect(!hiddenBaseline.observe(safari, windows: safariWindows([18100])), "The first visible document after hidden-only startup seeds silently")
        expect(!hiddenBaseline.observe(safari, windows: safariWindows([])), "Closing the first observed document can arm despite startup helpers")
        expect(hiddenBaseline.observe(safari, windows: safariWindows([18101])), "Reopening after a visible baseline still works for hidden-only startup")

        var knownMinimized = AppWindowEpisodePolicy(baseline: safari, windows: safariWindows([18200]))
        expect(!knownMinimized.observe(safari, windows: safariWindows([18200, 18201])), "An additional visible document joins the same cohort")
        expect(!knownMinimized.observe(safari, windows: safariWindows([18200], documents: [18200, 18201])), "Minimizing the second known document preserves it in the cohort")
        expect(!knownMinimized.observe(safari, windows: safariWindows([], documents: [18201])), "Closing A while known minimized B remains must not arm help")
        expect(!knownMinimized.observe(safari, windows: safariWindows([18202], documents: [18201, 18202])), "A new visible C alongside known minimized B is not a fresh visit")
        expect(!knownMinimized.observe(safari, windows: safariWindows([18201])), "Restoring B after C closes cannot repeat help")
        expect(!knownMinimized.observe(safari, windows: safariWindows([])), "Only closing the final known document arms this cohort")
        expect(knownMinimized.observe(safari, windows: safariWindows([18203])), "A later document after the complete cohort closes gets new help")

        var acknowledgedCohort = AppWindowEpisodePolicy(baseline: safari, windows: safariWindows([18300, 18301]))
        acknowledgedCohort.acknowledgeVisibleWindow(safari, windows: safariWindows([18300], documents: [18300, 18301]))
        expect(!acknowledgedCohort.observe(safari, windows: safariWindows([18301])), "Readiness acknowledgment preserves a previously visible, now minimized sibling")
        expect(acknowledgedCohort.observe(safari, windows: safariWindows([18302])), "Readiness acknowledgment must not add never-visible helpers to the cohort")
        acknowledgedCohort.acknowledgeVisibleWindow(safari, windows: nil)
        expect(!acknowledgedCohort.observe(safari, windows: safariWindows([18303])), "Unknown readiness IDs reseed silently even with retained hidden helpers")
        expect(acknowledgedCohort.observe(safari, windows: safariWindows([18304])), "A fresh replacement after acknowledgment reseeding is still detected")

        var readinessWindows = AppWindowEpisodePolicy(baseline: safari, windows: ids([]))
        readinessWindows.acknowledgeVisibleWindow(safari, windows: ids([71]))
        expect(!readinessWindows.observe(safari, windows: ids([71])), "A normal activation readiness launch must not be duplicated by the next lifecycle poll")
        var unknownIDsAtLaunch = AppWindowEpisodePolicy(baseline: safari, windows: ids([]))
        unknownIDsAtLaunch.acknowledgeVisibleWindow(safari, windows: nil)
        expect(!unknownIDsAtLaunch.observe(safari, windows: ids([72])), "Known visible readiness also consumes initial appearance if its second metadata read failed")
        expect(unknownIDsAtLaunch.observe(safari, windows: ids([73])), "A later independent window replacement is still detected")
        var staleIDsAtLaunch = AppWindowEpisodePolicy(baseline: safari, windows: ids([74]))
        staleIDsAtLaunch.acknowledgeVisibleWindow(safari, windows: nil)
        expect(!staleIDsAtLaunch.observe(safari, windows: ids([75])), "A launch with unknown IDs cannot compare its next sample against older window IDs")
        expect(staleIDsAtLaunch.observe(safari, windows: ids([76])), "After reseeding launch IDs, a later replacement can emit normally")

        var lifecycle = AppActivationPolicy(baseline: safari)
        let reopened = lifecycle.windowAppeared(safari, timestamp: 400)!
        expect(reopened.application == safari && reopened.timestamp == 400, "A reopened window gets a fresh current-app episode")
        expect(lifecycle.nextCheck(reopened, frontmostPID: safari.pid, context: context(safari)) == .launch, "The reopened window uses normal readiness validation")
        let replacedPending = lifecycle.windowAppeared(safari, timestamp: 401)!
        expect(replacedPending.id != reopened.id, "Replacing a window with an in-flight launch invalidates that old episode")
        expect(!lifecycle.deliveryFinished(id: reopened.id, succeeded: true), "Old launch success cannot consume a replacement window's episode")
        expect(lifecycle.nextCheck(replacedPending, frontmostPID: safari.pid, context: context(safari)) == .launch, "The replacement gets its own bounded launch")
        expect(!lifecycle.deliveryFinished(id: reopened.id, succeeded: false), "Old launch failure cannot free the replacement's pending launch")
        expect(lifecycle.nextCheck(replacedPending, frontmostPID: safari.pid, context: context(safari)) == .ignore, "A pending replacement launch cannot run twice")
        expect(!lifecycle.deliveryFinished(id: replacedPending.id, succeeded: true), "A successful replacement is consumed")
        expect(lifecycle.activate(safari, regular: true, timestamp: 402) == nil, "Duplicate activation after window delivery does not emit again")
        expect(lifecycle.windowAppeared(finder, timestamp: 403) == nil, "Window polling cannot substitute another app for the current visit")

        var readinessRace = AppActivationPolicy(baseline: other)
        let initialVisit = readinessRace.activate(safari, regular: true, timestamp: 500)!
        for _ in 0..<9 { _ = readinessRace.nextCheck(initialVisit, frontmostPID: safari.pid, context: context(safari, window: nil)) }
        let firstAppearance = readinessRace.windowAppeared(safari, timestamp: 501)!
        expect(firstAppearance.id == initialVisit.id, "The first window reuses a still-unattempted activation visit")
        expect(readinessRace.nextCheck(firstAppearance, frontmostPID: safari.pid, context: context(safari)) == .launch, "The first appearance uses the remaining readiness check")
        expect(!readinessRace.deliveryFinished(id: firstAppearance.id, succeeded: false), "Lifecycle sampling must not reset the readiness budget")
        let afterExhaustion = readinessRace.windowAppeared(safari, timestamp: 502)!
        expect(afterExhaustion.id != firstAppearance.id, "A separately confirmed later window episode can recover an exhausted visit")

        func identified(_ id: CGWindowID, onscreen: Bool = true, alpha: Double = 1, rect: CGRect = window) -> [String: Any] {
            var row = record(onscreen: onscreen, alpha: alpha, rect: rect)
            row[kCGWindowNumber as String] = NSNumber(value: id)
            return row
        }
        func windowIDs(_ rows: [[String: Any]]?, displays: [CGRect] = [display]) -> AppContextWindowIDs? {
            appContextWindowIDs(pid: safari.pid, records: rows, displays: displays)
        }
        expect(windowIDs([identified(11)])?.visible == [11], "Visible metadata retains its real CG window ID")
        expect(windowIDs([identified(11, onscreen: false)])?.all == [11], "Minimized IDs survive offscreen metadata")
        expect(windowIDs([identified(11, onscreen: false)])?.visible.isEmpty == true, "Minimized windows are not visible launch candidates")
        expect(windowIDs([identified(11, alpha: 0)])?.all == [11], "Invisible but existing windows cannot be mistaken for closed windows")
        expect(windowIDs([identified(11, rect: CGRect(x: 3000, y: 0, width: 800, height: 600))])?.all == [11], "Off-display window identities stay in the population")
        expect(windowIDs([])?.all.isEmpty == true, "A successful empty CG read is positive absence evidence")
        expect(windowIDs(nil) == nil, "A failed CG read is unknown, not an empty population")
        expect(windowIDs([], displays: []) == nil, "Failed display metadata cannot establish absence")
        expect(windowIDs([record()]) == nil, "Missing CG IDs make population metadata unknown")
        expect(windowIDs([identified(11), identified(11)]) == nil, "Duplicate CG IDs are rejected as inconsistent metadata")
        expect(windowIDs([identified(0)]) == nil, "Zero CG ID cannot identify a real window")
        expect(windowIDs([identified(11, rect: .zero)])?.all.isEmpty == true, "Zero-sized cached helper windows do not retain a document population")
        expect(windowIDs([identified(11, rect: CGRect(x: 1, y: 1, width: 1, height: 1))])?.all.isEmpty == true, "One-pixel helper windows cannot suppress reopen detection")
        var malformedBounds = identified(11); malformedBounds.removeValue(forKey: kCGWindowBounds as String)
        expect(windowIDs([malformedBounds]) == nil, "Malformed bounds are unknown rather than proof of closure")
        expect(windowIDs([identified(11, rect: CGRect(x: 150, y: 120, width: 900, height: 620))])?.all == [11], "Moving or resizing keeps the same identity")
        func windowContext(firstPID: pid_t? = 10, lastPID: pid_t? = 10, lastBundle: String = "com.apple.Safari", rows: [[String: Any]]? = []) -> AppWindowContextSnapshot? {
            appWindowContext(firstBundleID: safari.bundleID, firstPID: firstPID, lastBundleID: lastBundle, lastPID: lastPID,
                             records: rows, displays: [display], timestamp: 600)
        }
        expect(windowContext(rows: [identified(11)])?.windows.visible == [11], "A stable foreground snapshot preserves window metadata")
        expect(windowContext(lastPID: 20) == nil, "A foreground PID change during CG enumeration is unknown")
        expect(windowContext(lastBundle: "com.apple.finder") == nil, "A foreground bundle change during CG enumeration is unknown")
        expect(windowContext(lastPID: nil) == nil, "Lost foreground identity cannot become no-window evidence")
        expect(windowContext(rows: nil) == nil, "The integrated snapshot preserves a failed CG read as unknown")
        print("\(checks) app watcher episode and CG metadata checks passed")
    }
}
