import AppKit
import Darwin
import OSLog

struct WatchedApplication: Equatable {
    let bundleID: String
    let pid: pid_t
}

struct AppActivationEpisode {
    let application: WatchedApplication
    let id: String
    let timestamp: Double
}

enum AppActivationCheck { case wait, launch, ignore }

// Window metadata supplies only new-window episodes within the same app visit.
// Track windows seen on screen, retaining them while they exist in `all` so
// minimization does not create another offer. Never-visible helper windows do
// not keep a closed document cohort alive. Unknown reads preserve the baseline.
struct AppWindowEpisodePolicy {
    private var application: WatchedApplication?
    private var observedWindowIDs: Set<CGWindowID>?
    private var awaitingVisibleWindow = false

    init(baseline: WatchedApplication?, windows: AppContextWindowIDs? = nil) {
        application = baseline
        observedWindowIDs = windows?.visible
        awaitingVisibleWindow = windows?.all.isEmpty == true
    }

    mutating func activate(_ candidate: WatchedApplication?, regular: Bool) {
        guard regular, let candidate, candidate.bundleID != helpOSBundleID else { return }
        if application != candidate {
            application = candidate; observedWindowIDs = nil; awaitingVisibleWindow = false
        }
    }

    mutating func terminate(pid: pid_t) {
        if application?.pid == pid { application = nil; observedWindowIDs = nil; awaitingVisibleWindow = false }
    }

    mutating func acknowledgeVisibleWindow(_ candidate: WatchedApplication, windows: AppContextWindowIDs?) {
        guard application == candidate else { return }
        // The existing activation readiness check has already found a window.
        // A later lifecycle poll must not offer it a second time.
        awaitingVisibleWindow = false
        if let windows, !windows.visible.isEmpty, windows.visible.isSubset(of: windows.all) {
            observedWindowIDs = (observedWindowIDs ?? []).intersection(windows.all).union(windows.visible)
        } else { observedWindowIDs = nil } // Seed unknown launch IDs silently on the next good sample.
    }

    mutating func observe(_ candidate: WatchedApplication, windows: AppContextWindowIDs?) -> Bool {
        guard application == candidate, appHelpBundleIDs.contains(candidate.bundleID), let windows,
              windows.visible.isSubset(of: windows.all) else { return false }
        guard let previous = observedWindowIDs else {
            observedWindowIDs = windows.visible; awaitingVisibleWindow = windows.all.isEmpty
            return false // A new visit's first sample is a silent baseline.
        }
        // Previously visible windows remain tracked even when minimized. A
        // document replacement can be disjoint despite shared hidden helpers.
        let surviving = previous.intersection(windows.all)
        if windows.all.isEmpty || (!previous.isEmpty && surviving.isEmpty) {
            awaitingVisibleWindow = true
        }
        observedWindowIDs = surviving.union(windows.visible)
        guard awaitingVisibleWindow, !windows.visible.isEmpty else { return false }
        awaitingVisibleWindow = false
        return true
    }
}

// In-memory episode state contains identifiers only and never records app usage.
struct AppActivationPolicy {
    private var previous: WatchedApplication?
    private var episode: AppActivationEpisode?
    private var delivered = false
    private var readinessChecks = 0
    private var launchAttempts = 0
    private var launchPending = false

    init(baseline: WatchedApplication?) { previous = baseline }

    private mutating func beginEpisode(_ application: WatchedApplication, timestamp: Double) {
        delivered = false
        readinessChecks = 0; launchAttempts = 0; launchPending = false
        episode = appHelpBundleIDs.contains(application.bundleID)
            ? AppActivationEpisode(application: application, id: UUID().uuidString, timestamp: timestamp) : nil
    }

    mutating func activate(_ application: WatchedApplication?, regular: Bool, timestamp: Double) -> AppActivationEpisode? {
        guard regular, let application, application.bundleID != helpOSBundleID else { return nil }
        if previous != application {
            previous = application
            beginEpisode(application, timestamp: timestamp)
        }
        return delivered ? nil : episode
    }

    mutating func windowAppeared(_ application: WatchedApplication, timestamp: Double) -> AppActivationEpisode? {
        guard previous == application, appHelpBundleIDs.contains(application.bundleID) else { return nil }
        // Window readiness and lifecycle sampling may see the same first
        // window. Reuse the still-unattempted visit and its remaining budget.
        if let episode, !delivered, launchAttempts == 0, readinessChecks < 10 { return episode }
        beginEpisode(application, timestamp: timestamp)
        return episode
    }

    mutating func terminate(pid: pid_t) {
        if previous?.pid == pid {
            previous = nil; episode = nil; delivered = false
            readinessChecks = 0; launchAttempts = 0; launchPending = false
        }
    }

    // Workspace notifications can arrive before foreground/window metadata.
    // Keep retries within this visit's budget, including duplicate notifications.
    mutating func nextCheck(_ candidate: AppActivationEpisode, frontmostPID: pid_t?, context: AppContextSnapshot) -> AppActivationCheck {
        guard isCurrent(candidate), !launchPending, readinessChecks < 10, launchAttempts < 3 else { return .ignore }
        readinessChecks += 1
        guard frontmostPID == candidate.application.pid,
              context.pid == candidate.application.pid,
              context.bundleID == candidate.application.bundleID,
              context.window != nil else { return readinessChecks < 10 ? .wait : .ignore }
        launchAttempts += 1; launchPending = true
        return .launch
    }

    // Launch success consumes the visit. Failure permits a bounded retry;
    // completion from an older visit cannot affect its replacement.
    mutating func deliveryFinished(id: String, succeeded: Bool) -> Bool {
        guard episode?.id == id, !delivered, launchPending else { return false }
        launchPending = false
        if succeeded { delivered = true; return false }
        return readinessChecks < 10 && launchAttempts < 3
    }

    func isCurrent(_ candidate: AppActivationEpisode) -> Bool {
        episode?.id == candidate.id && !delivered
    }
}

// launchd may supply a bundle-relative argv[0], which dyld can preserve.
// Ask the kernel for this process's executable, independently of both values.
func watcherExecutablePath() -> String? {
    // PROC_PIDPATHINFO_MAXSIZE is (4 * MAXPATHLEN) in sys/proc_info.h;
    // Swift cannot import that expression macro directly.
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = buffer.withUnsafeMutableBytes { bytes in
        proc_pidpath(getpid(), bytes.baseAddress, UInt32(bytes.count))
    }
    guard length > 0, Int(length) < buffer.count else { return nil }
    let path = String(cString: buffer)
    return path.hasPrefix("/") ? path : nil
}

func watcherParentApplication(executablePath: String, bundleIdentifier: (URL) -> String?,
                              reportFailure: (String) -> Void = { _ in }) -> URL? {
    guard executablePath.hasPrefix("/") else { reportFailure("executable_path_not_absolute"); return nil }
    let executable = URL(fileURLWithPath: executablePath).standardizedFileURL.resolvingSymlinksInPath()
    let parent = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    guard parent.pathExtension == "app" else { reportFailure("parent_not_app_bundle"); return nil }
    guard bundleIdentifier(parent) == helpOSBundleID else { reportFailure("parent_bundle_identity_mismatch"); return nil }
    guard parent.appendingPathComponent("Contents/MacOS/helpos-app-watcher").standardizedFileURL == executable else {
        reportFailure("helper_location_mismatch"); return nil
    }
    return parent
}

#if !APP_WATCHER_TEST
private final class AppWatcher {
    private let parentApp: URL
    private let workspace = NSWorkspace.shared
    private var policy: AppActivationPolicy
    private var windowPolicy: AppWindowEpisodePolicy
    private var tokens: [NSObjectProtocol] = []
    private var retry: DispatchWorkItem?
    private var windowTimer: Timer?

    init(parentApp: URL) {
        self.parentApp = parentApp
        let foreground = NSWorkspace.shared.frontmostApplication
        let baseline = foreground.flatMap { app -> WatchedApplication? in
            guard app.activationPolicy == .regular, let bundle = app.bundleIdentifier, bundle != helpOSBundleID else { return nil }
            return WatchedApplication(bundleID: bundle, pid: app.processIdentifier)
        }
        policy = AppActivationPolicy(baseline: baseline)
        let windowContext = currentAppWindowContext()
        let initialWindows = windowContext.flatMap { context in
            baseline == WatchedApplication(bundleID: context.bundleID, pid: context.pid) ? context.windows : nil
        }
        windowPolicy = AppWindowEpisodePolicy(baseline: baseline, windows: initialWindows)
    }

    func start() {
        let center = workspace.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didLaunchApplicationNotification] {
            tokens.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
                // A background process launch is not a foreground app visit.
                if name == NSWorkspace.didLaunchApplicationNotification,
                   self?.workspace.frontmostApplication?.processIdentifier != app.processIdentifier { return }
                self?.activated(app)
            })
        }
        tokens.append(center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] notification in
            guard let self, let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self.policy.terminate(pid: app.processIdentifier)
            self.windowPolicy.terminate(pid: app.processIdentifier)
        })
        // Deliberately do not emit the initial foreground sample at registration.
        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.checkWindowLifecycle() }
        timer.tolerance = 0.1
        windowTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func activated(_ app: NSRunningApplication) {
        // HelpOS and transient helpers are part of the same visit. Their focus
        // must not cancel a pending window-readiness retry.
        guard app.activationPolicy == .regular, let bundleID = app.bundleIdentifier,
              bundleID != helpOSBundleID else { return }
        let identity = WatchedApplication(bundleID: bundleID, pid: app.processIdentifier)
        windowPolicy.activate(identity, regular: true)
        let episode = policy.activate(identity, regular: true, timestamp: Date().timeIntervalSince1970 * 1000)
        retry?.cancel(); retry = nil
        guard let episode else { return }
        scheduleCheck(episode, delay: 0)
    }

    private func checkWindowLifecycle() {
        guard let context = currentAppWindowContext() else { return }
        let identity = WatchedApplication(bundleID: context.bundleID, pid: context.pid)
        guard windowPolicy.observe(identity, windows: context.windows),
              let episode = policy.windowAppeared(identity, timestamp: context.timestamp) else { return }
        // The replacement UUID invalidates retries and completion callbacks from
        // a window that closed while its launch was still pending.
        retry?.cancel(); retry = nil
        scheduleCheck(episode, delay: 0)
    }

    private func scheduleCheck(_ episode: AppActivationEpisode, delay: TimeInterval = 0.2) {
        guard policy.isCurrent(episode) else { return }
        retry?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.waitForWindow(episode) }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func waitForWindow(_ episode: AppActivationEpisode) {
        guard policy.isCurrent(episode) else { return }
        let foregroundPID = workspace.frontmostApplication?.processIdentifier
        let context = currentAppContext()
        switch policy.nextCheck(episode, frontmostPID: foregroundPID, context: context) {
        case .ignore:
            return
        case .wait:
            scheduleCheck(episode)
        case .launch:
            let observedWindows = currentAppWindowContext().flatMap { context in
                context.bundleID == episode.application.bundleID && context.pid == episode.application.pid ? context.windows : nil
            }
            windowPolicy.acknowledgeVisibleWindow(episode.application, windows: observedWindows)
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            configuration.addsToRecentItems = false
            configuration.promptsUserIfNeeded = false
            configuration.allowsRunningApplicationSubstitution = false
            // Arguments are delivered only to a new instance. Electron forwards
            // them through its single-instance lock and exits the duplicate.
            configuration.createsNewApplicationInstance = true
            // Chromium reorders bare switches and positional arguments for an
            // existing instance. Bind each value to its switch before delivery.
            configuration.arguments = ["--background", "--app-help=\(episode.application.bundleID)",
                                       "--activation-id=\(episode.id)", "--activation-at=\(Int64(episode.timestamp))"]
            workspace.openApplication(at: parentApp, configuration: configuration) { [weak self] application, error in
                let succeeded = error == nil && application != nil
                // NSWorkspace's callback need not run on this policy's queue.
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    if self.policy.deliveryFinished(id: episode.id, succeeded: succeeded) {
                        self.scheduleCheck(episode)
                    }
                }
            }
        }
    }
}

@main
private enum AppWatcherMain {
    static func main() {
        let logger = Logger(subsystem: helpOSBundleID, category: "AppWatcher")
        let reportFailure: (String) -> Void = { reason in
            // Fixed configuration codes only: no app visits, titles, or paths.
            logger.error("Configuration failed: \(reason, privacy: .public)")
        }
        guard let executablePath = watcherExecutablePath() else {
            reportFailure("kernel_executable_path_unavailable"); exit(78)
        }
        guard let parent = watcherParentApplication(executablePath: executablePath,
              bundleIdentifier: { Bundle(url: $0)?.bundleIdentifier }, reportFailure: reportFailure) else { exit(78) }
        let watcher = AppWatcher(parentApp: parent)
        watcher.start()
        withExtendedLifetime(watcher) { RunLoop.main.run() }
    }
}
#endif
