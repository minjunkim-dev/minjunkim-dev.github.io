// Code shown in the article "imageio-downsampling-memory-stability".

// snippet:start decoder
import ImageIO
import UIKit

struct ThumbnailDecoder {
    enum ContentMode: String, Hashable, Sendable {
        case aspectFit
        case aspectFill
    }

    enum DecodeError: Error {
        case invalidTargetSize
        case cannotCreateSource
        case invalidSourceDimensions
        case cannotCreateThumbnail
    }

    static func decode(
        from url: URL,
        fitting pointSize: CGSize,
        scale: CGFloat,
        contentMode: ContentMode
    ) throws -> UIImage {
        let sourceOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false
        ]

        guard let source = CGImageSourceCreateWithURL(
            url as CFURL,
            sourceOptions as CFDictionary
        ) else {
            throw DecodeError.cannotCreateSource
        }

        let sourcePixelSize = try sourcePixelSize(of: source)
        let maxPixelSize = try maxPixelSize(
            sourcePixelSize: sourcePixelSize,
            targetPointSize: pointSize,
            scale: scale,
            contentMode: contentMode
        )

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            thumbnailOptions as CFDictionary
        ) else {
            throw DecodeError.cannotCreateThumbnail
        }

        return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }

    static func maxPixelSize(
        sourcePixelSize: CGSize,
        targetPointSize: CGSize,
        scale: CGFloat,
        contentMode: ContentMode
    ) throws -> Int {
        guard targetPointSize.width.isFinite, targetPointSize.width > 0,
              targetPointSize.height.isFinite, targetPointSize.height > 0,
              scale.isFinite, scale > 0 else {
            throw DecodeError.invalidTargetSize
        }
        guard sourcePixelSize.width.isFinite, sourcePixelSize.width > 0,
              sourcePixelSize.height.isFinite, sourcePixelSize.height > 0 else {
            throw DecodeError.invalidSourceDimensions
        }

        let targetPixelSize = CGSize(
            width: targetPointSize.width * scale,
            height: targetPointSize.height * scale
        )
        guard targetPixelSize.width.isFinite, targetPixelSize.height.isFinite else {
            throw DecodeError.invalidTargetSize
        }
        let widthRatio = targetPixelSize.width / sourcePixelSize.width
        let heightRatio = targetPixelSize.height / sourcePixelSize.height
        let resizeRatio: CGFloat

        switch contentMode {
        case .aspectFit:
            resizeRatio = min(widthRatio, heightRatio)
        case .aspectFill:
            resizeRatio = max(widthRatio, heightRatio)
        }

        let downscaleRatio = min(resizeRatio, 1)
        let longestSourceEdge = max(
            sourcePixelSize.width,
            sourcePixelSize.height
        )
        // 부동소수점 오차(예: 320.00000000000006)로 1px 커지지 않게 아주 작은 값을 뺀다.
        let roundedEdge = ceil(longestSourceEdge * downscaleRatio - 0.000_001)
        guard let pixels = Int(exactly: roundedEdge) else {
            throw DecodeError.invalidTargetSize
        }
        return max(1, pixels)
    }

    private static func sourcePixelSize(
        of source: CGImageSource
    ) throws -> CGSize {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(
            source,
            0,
            nil
        ) as? [CFString: Any],
        let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
        let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
        width > 0,
        height > 0 else {
            throw DecodeError.invalidSourceDimensions
        }

        let orientation = (
            properties[kCGImagePropertyOrientation] as? NSNumber
        )?.intValue ?? 1
        let swapsAxes = [5, 6, 7, 8].contains(orientation)

        return CGSize(
            width: swapsAxes ? height : width,
            height: swapsAxes ? width : height
        )
    }
}
// snippet:end decoder
