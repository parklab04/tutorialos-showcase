import AppKit
import ApplicationServices

func run() async {
    print(observationJSON(await observation(arguments: Array(CommandLine.arguments.dropFirst()))))
}
#if FACETIME_CALL_TEST
runFaceTimeCallTests()
#elseif TOKEN_MATCH_TEST
runOCRTests()
#elseif SAFARI_OBSERVER_TEST
runSafariTests()
#else
Task { await run(); exit(0) }
RunLoop.main.run()
#endif
