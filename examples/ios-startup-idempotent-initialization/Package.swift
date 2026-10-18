// swift-tools-version: 6.0
// Code for the article "ios-startup-idempotent-initialization".
import PackageDescription

let package = Package(
    name: "Startup",
    platforms: [.iOS(.v16), .macOS(.v13)],
    targets: [
        .target(name: "Startup"),
        .testTarget(name: "StartupTests", dependencies: ["Startup"]),
    ]
)
