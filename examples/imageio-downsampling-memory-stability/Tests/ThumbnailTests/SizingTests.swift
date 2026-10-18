import XCTest
@testable import Thumbnail

/// Edge cases of the article's size calculation beyond the two tests shown in the article.
final class SizingTests: XCTestCase {
    private let source = CGSize(width: 4_000, height: 1_000)
    private let target = CGSize(width: 100, height: 100)

    func testFitAndFillPixelBudgets() throws {
        XCTAssertEqual(try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: 2, contentMode: .aspectFit), 200)
        XCTAssertEqual(try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: 2, contentMode: .aspectFill), 800)
    }

    func testFloatingPointErrorDoesNotAddAPixel() throws {
        // 1066 * (320 / 1066) is 320.00000000000006 in Double; the result must stay 320.
        let edge = try ThumbnailDecoder.maxPixelSize(
            sourcePixelSize: CGSize(width: 1_066, height: 100),
            targetPointSize: CGSize(width: 160, height: 90),
            scale: 2,
            contentMode: .aspectFit
        )
        XCTAssertEqual(edge, 320)
    }

    func testRejectsInvalidSizesScalesAndOverflow() {
        for bad: CGFloat in [0, -1, .infinity, .nan] {
            XCTAssertThrowsError(try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: CGSize(width: bad, height: 100), scale: 2, contentMode: .aspectFit))
            XCTAssertThrowsError(try ThumbnailDecoder.maxPixelSize(sourcePixelSize: CGSize(width: bad, height: 100), targetPointSize: target, scale: 2, contentMode: .aspectFill))
            XCTAssertThrowsError(try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: bad, contentMode: .aspectFit))
        }
        XCTAssertThrowsError(try ThumbnailDecoder.maxPixelSize(
            sourcePixelSize: CGSize(width: 1e30, height: 1e30),
            targetPointSize: CGSize(width: 1e30, height: 1e30),
            scale: 1,
            contentMode: .aspectFit
        ))
    }

    func testLimiterNeverRunsMoreThanItsLimit() async {
        let limiter = DecodeLimiter(limit: 2)
        let probe = ConcurrencyProbe()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    await limiter.acquire()
                    await probe.enter()
                    await Task.yield()
                    await probe.leave()
                    await limiter.release()
                }
            }
        }
        let peak = await probe.peak
        XCTAssertLessThanOrEqual(peak, 2)
    }

    func testCacheKeySeparatesSizeAndContentMode() {
        let small = ThumbnailCacheKey(resourceID: "a", pixelWidth: 320, pixelHeight: 180, contentMode: .aspectFit)
        let large = ThumbnailCacheKey(resourceID: "a", pixelWidth: 1_280, pixelHeight: 720, contentMode: .aspectFit)
        let fill = ThumbnailCacheKey(resourceID: "a", pixelWidth: 320, pixelHeight: 180, contentMode: .aspectFill)
        XCTAssertEqual(Set([small, large, fill]).count, 3)
    }
}

private actor ConcurrencyProbe {
    private var running = 0
    private(set) var peak = 0

    func enter() {
        running += 1
        peak = max(peak, running)
    }

    func leave() {
        running -= 1
    }
}
