import XCTest
@testable import ForceUpdateGate

final class VersionGateTests: XCTestCase {
    func testOlderVersionRequiresUpdate() {
        XCTAssertEqual(
            VersionGate.evaluate(current: "2.1.0", minimum: "2.1.1"),
            .requireUpdate
        )
    }

    func testEqualOrNewerVersionIsAllowed() {
        XCTAssertEqual(
            VersionGate.evaluate(current: "2.1.1", minimum: "2.1.1"),
            .allow
        )
        XCTAssertEqual(
            VersionGate.evaluate(current: "2.2.0", minimum: "2.1.1"),
            .allow
        )
    }

    func testMalformedInputFailsOpen() {
        XCTAssertEqual(
            VersionGate.evaluate(current: "unknown", minimum: "2.1.1"),
            .allow
        )
        XCTAssertEqual(
            VersionGate.evaluate(current: "2.1.0", minimum: "broken"),
            .allow
        )
    }
}
