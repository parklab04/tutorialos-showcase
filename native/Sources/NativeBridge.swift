import Foundation
import Darwin

// Koffi must call helpos_observe.async so the Electron/AppKit main thread stays
// available for ScreenCaptureKit. Timed-out tasks retain their own result box.
private final class ObservationResult: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    let ready = DispatchSemaphore(value: 0)
    func finish(_ text: String) {
        lock.lock(); value = text; lock.unlock()
        ready.signal()
    }
    func read() -> String? {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}

// A stalled OS API cannot accumulate unbounded detached observation tasks.
private let observationSlots = DispatchSemaphore(value: 2)

@_cdecl("helpos_observe")
public func helposObserve(_ commandPointer: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let commandPointer else { return strdup("{\"error\":\"missing_command\"}") }
    let command = String(cString: commandPointer)
    let arguments = command.split(separator: " ").map(String.init)
    guard arguments == ["--probe"] || arguments == ["--facetime-call"] || arguments == ["--app-context"] ||
          (arguments.count == 2 && arguments[0] == "--observe" && allowedBundles.contains(arguments[1])) else {
        return strdup("{\"error\":\"unsupported_command\"}")
    }
    guard !Thread.isMainThread else { return strdup("{\"error\":\"observer_requires_worker\"}") }
    guard observationSlots.wait(timeout: .now()) == .success else { return strdup("{\"error\":\"observer_busy\"}") }
    let result = ObservationResult()
    let task = Task.detached {
        defer { observationSlots.signal() }
        result.finish(observationJSON(await observation(arguments: arguments)))
    }
    guard result.ready.wait(timeout: .now() + 5) == .success, let text = result.read() else {
        task.cancel()
        return strdup("{\"error\":\"observer_timeout\"}")
    }
    return strdup(text)
}

@_cdecl("helpos_free")
public func helposFree(_ pointer: UnsafeMutableRawPointer?) {
    free(pointer)
}
