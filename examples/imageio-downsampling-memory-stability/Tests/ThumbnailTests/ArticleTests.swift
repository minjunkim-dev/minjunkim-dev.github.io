@testable import Thumbnail

// snippet:start tests
import XCTest

final class ThumbnailDecoderTests: XCTestCase {
    func testDecodedImageRespectsPixelBudget() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle.module.url(forResource: "landscape-fixture", withExtension: "jpg")
        )
        let pointSize = CGSize(width: 160, height: 90)
        let scale: CGFloat = 2

        let image = try ThumbnailDecoder.decode(
            from: fixtureURL,
            fitting: pointSize,
            scale: scale,
            contentMode: .aspectFit
        )
        let cgImage = try XCTUnwrap(image.cgImage)

        XCTAssertLessThanOrEqual(cgImage.width, 320)
        XCTAssertLessThanOrEqual(cgImage.height, 180)
    }

    func testAspectFillPreservesCropPixelBudget() throws {
        let maxPixelSize = try ThumbnailDecoder.maxPixelSize(
            sourcePixelSize: CGSize(width: 4_000, height: 1_000),
            targetPointSize: CGSize(width: 100, height: 100),
            scale: 2,
            contentMode: .aspectFill
        )

        XCTAssertEqual(maxPixelSize, 800)
    }
}
// snippet:end tests
