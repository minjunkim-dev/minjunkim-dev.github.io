// swift-tools-version: 6.0
// Swift version of the article's gate decision: malformed versions fail open.
import PackageDescription

let package = Package(
    name: "ForceUpdateGate",
    platforms: [.iOS(.v16), .macOS(.v13)],
    targets: [
        .target(name: "ForceUpdateGate"),
        .testTarget(name: "ForceUpdateGateTests", dependencies: ["ForceUpdateGate"]),
    ]
)
