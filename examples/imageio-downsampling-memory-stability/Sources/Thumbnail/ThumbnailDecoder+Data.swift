// Code shown in the article "imageio-downsampling-memory-stability".

import Foundation
import ImageIO

extension ThumbnailDecoder {
    // snippet:start make-source
    static func makeSource(from data: Data) throws -> CGImageSource {
        let sourceOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false
        ]

        guard let source = CGImageSourceCreateWithData(
            data as CFData,
            sourceOptions as CFDictionary
        ) else {
            throw DecodeError.cannotCreateSource
        }

        return source
    }
    // snippet:end make-source
}
