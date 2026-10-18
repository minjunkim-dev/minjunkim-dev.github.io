// Generates landscape-fixture.jpg (1600×900 gradient). Run: swift make-fixture.swift
// The image is generated here, so it carries no third-party license.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let width = 1600, height = 900
let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
)!
let gradient = CGGradient(
    colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
    colors: [CGColor(red: 0.1, green: 0.3, blue: 0.8, alpha: 1), CGColor(red: 0.9, green: 0.6, blue: 0.2, alpha: 1)] as CFArray,
    locations: [0, 1]
)!
context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])

let url = URL(fileURLWithPath: "landscape-fixture.jpg")
let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, [kCGImageDestinationLossyCompressionQuality: 0.6] as CFDictionary)
precondition(CGImageDestinationFinalize(destination))
