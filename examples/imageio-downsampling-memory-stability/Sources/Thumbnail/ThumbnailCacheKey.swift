// Code shown in the article "imageio-downsampling-memory-stability".

// snippet:start cache-key
struct ThumbnailCacheKey: Hashable, Sendable {
    let resourceID: String
    let pixelWidth: Int
    let pixelHeight: Int
    let contentMode: ThumbnailDecoder.ContentMode
}
// snippet:end cache-key
