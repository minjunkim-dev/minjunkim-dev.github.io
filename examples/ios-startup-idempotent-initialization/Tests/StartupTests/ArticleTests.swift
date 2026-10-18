@testable import Startup

// snippet:start concurrent-test
import Foundation
import Testing

actor CallCounter {
    private(set) var value = 0

    func increment() {
        value += 1
    }
}

@Test
func concurrentStartsShareOneBuild() async throws {
    let counter = CallCounter()
    let expected = AppServices(sessionID: "fixture-session")

    let coordinator = StartupCoordinator {
        await counter.increment()
        try await Task.sleep(for: .milliseconds(20))
        return expected
    }

    async let first = coordinator.start()
    async let second = coordinator.start()
    async let third = coordinator.start()

    let results = try await [first, second, third]

    #expect(results == [expected, expected, expected])
    #expect(await counter.value == 1)
}
// snippet:end concurrent-test

// snippet:start retry-test
actor AttemptPlan {
    private var attempt = 0

    func next() throws -> AppServices {
        attempt += 1
        if attempt == 1 {
            throw URLError(.timedOut)
        }
        return AppServices(sessionID: nil)
    }
}

@Test
func transientFailureReturnsToIdle() async throws {
    let plan = AttemptPlan()
    let coordinator = StartupCoordinator {
        try await plan.next()
    }

    await #expect(throws: URLError.self) {
        try await coordinator.start()
    }

    let services = try await coordinator.start()
    #expect(services == AppServices(sessionID: nil))
}
// snippet:end retry-test
