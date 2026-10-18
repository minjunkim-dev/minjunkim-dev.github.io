// swift-tools-version: 6.0
// Code for the article "imageio-downsampling-memory-stability". It uses UIKit, so test it on an iOS Simulator.
import PackageDescription

let package = Package(
    name: "Thumbnail",
    platforms: [.iOS(.v16)],
    targets: [
        .target(name: "Thumbnail"),
        .testTarget(
            name: "ThumbnailTests",
            dependencies: ["Thumbnail"],
            exclude: ["Fixtures/make-fixture.swift"],
            resources: [.copy("Fixtures/landscape-fixture.jpg")]
        ),
    ]
)
