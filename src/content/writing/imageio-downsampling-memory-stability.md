---
title: "ImageIO로 큰 이미지 줄이기: 표시 크기와 동시 디코딩 수 관리"
description: "화면 크기에 맞춰 이미지를 다운샘플링하는 Swift 예제. fit/fill 크기 계산, 캐시 키, 반복 스크롤의 메모리 확인 항목을 정리한다."
publishedAt: 2026-07-09
updatedAt: 2026-10-18
tags:
  - Swift
  - iOS
  - ImageIO
  - Performance
draft: false
featured: false
---

고해상도 이미지를 다루는 화면이 가끔 종료되면 보통 파일 용량부터 본다. 하지만 압축된 JPEG·HEIF 파일 크기만 봐서는 화면에 펼친 비트맵이 메모리를 얼마나 쓰는지 알 수 없다. 디코딩한 이미지는 대략 **픽셀 너비 × 픽셀 높이 × 픽셀당 바이트**만큼 메모리를 쓴다. 여기에 색 공간 변환, 중간 버퍼, 리사이즈 결과, 캐시가 겹칠 수 있다.

작은 썸네일만 필요한 화면에서 원본을 디코딩한 뒤 줄이면 메모리를 필요 이상으로 쓴다. 여기서는 표시할 크기를 먼저 정하고 ImageIO로 그 크기에 가까운 썸네일을 만든다.

이 글은 공개 API로 다시 만든 설명용 예제다. 실서비스 코드나 성능 측정 결과가 아니다. 다운샘플링 함수와, 메모리 사용량을 확인할 테스트 항목을 정리한다.

## 파일 크기와 디코딩 크기를 분리해서 생각하기

다음 코드는 입력 파일 전체를 `Data`로 읽는다.

```swift
let data = try Data(contentsOf: url)
let image = UIImage(data: data)
let thumbnail = image?.preparingThumbnail(of: targetSize)
```

이 경로에서는 압축 데이터와 디코딩된 원본, 축소 결과가 한 시점에 함께 살아 있을 수 있다. `Data(contentsOf:)`가 입력 전체를 메모리에 올리고, `preparingThumbnail(of:)`는 호출한 자리에서 동기로 디코딩한다. `UIImage`를 그대로 그리는 경로라면 디코딩이 그리기 시점으로 미뤄져, 문제가 드러나는 위치도 호출 지점에서 멀어진다.

ImageIO를 쓰면 다음 두 단계를 분리할 수 있다.

1. 이미지 소스를 만들 때 원본 캐시를 끈다.
2. 목표 픽셀 크기를 지정해 썸네일만 디코딩한다.

## 표시 크기의 point를 pixel로 바꾸기

UIKit의 레이아웃은 point 단위이고 ImageIO의 `kCGImageSourceThumbnailMaxPixelSize`는 pixel 단위다. 따라서 표시 크기와 화면 scale을 함께 전달해야 한다.

```swift
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
```

각 옵션의 역할은 다음과 같다.

- `kCGImageSourceShouldCache: false`: 디코딩한 원본 이미지를 캐시에 두지 않는다.
- `kCGImageSourceCreateThumbnailFromImageAlways: true`: 내장 썸네일 유무와 관계없이 지정 크기의 결과를 만든다.
- `kCGImageSourceCreateThumbnailWithTransform: true`: EXIF 방향 정보를 썸네일에 반영한다.
- `kCGImageSourceShouldCacheImmediately: true`: 썸네일 디코딩을 함수 안에서 끝낸다. 그래서 그리기 시점의 비용을 예측하기 쉽다.
- `kCGImageSourceThumbnailMaxPixelSize`: 원본 종횡비와 fit/fill 정책으로 계산한 긴 변의 최대 픽셀 수를 제한한다.

원본의 종횡비는 ImageIO가 유지한다. `aspectFit`은 이미지 전체가 표시 영역 안에 들어오는 축소율을, `aspectFill`은 표시 영역을 빈틈없이 덮는 축소율을 선택한다. 실제 자르기는 뷰나 별도 후처리에서 맡는다. 예제는 원본보다 크게 만들지 않으므로 원본이 표시 영역보다 작으면 화면에서 확대가 필요할 수 있다. EXIF 방향으로 가로·세로가 바뀌는 이미지도 회전 후 크기를 기준으로 계산한다.

## URL 기반 소스를 우선하기

파일 URL이 이미 있으면 `CGImageSourceCreateWithURL`을 쓴다. 네트워크로 받은 `Data`만 있다면 `CGImageSourceCreateWithData`를 써도 된다. 다만 다운로드 응답과 디코딩 버퍼가 함께 남는 기간을 관리해야 한다.

```swift
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
```

`Data` 입력도 지원하려면 위 디코더에서 소스 생성 이후의 썸네일 처리 부분을 별도 함수로 옮겨 공유할 수 있다. 그러면 URL과 `Data` 경로에 같은 크기 계산과 캐시 옵션을 적용할 수 있다.

다운로드 결과를 파일에 저장할 수 있다면 임시 파일 URL을 디코더에 넘겨도 된다.

## 리스트에서는 동시 디코딩 수도 제한하기

한 장의 크기를 줄여도 여러 셀이 동시에 디코딩하면 순간 메모리 사용량이 커진다. 그래서 동시에 디코딩하는 수에도 상한을 둔다.

```swift
actor DecodeLimiter {
    private let limit: Int
    private var running = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) {
        precondition(limit > 0)
        self.limit = limit
    }

    func acquire() async {
        if running < limit {
            running += 1
            return
        }

        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func release() {
        if waiters.isEmpty {
            precondition(running > 0, "release() without acquire()")
            running -= 1
        } else {
            waiters.removeFirst().resume()
        }
    }
}
```

`acquire()`와 `release()`는 반드시 짝을 맞춘다. `acquire()` 직후 `defer`로 `release()`를 예약하면 오류가 나도 짝이 맞는다. 이 예제는 최소 구현이다. 제품 코드라면 취소된 waiter 제거, 우선순위, 공정성도 정해야 한다. 쓰고 있는 이미지 로더가 동시성 제한과 취소를 이미 제공하면 제한기를 따로 만들지 않고 그 계층에 정책을 모은다.

리스트 셀이 재사용될 때는 이전 요청을 취소하고, 완료 시 현재 셀이 같은 이미지 식별자를 여전히 가리키는지 확인한다. 다운샘플링으로 메모리 비용은 줄지만, 결과가 엉뚱한 셀에 나타나는 순서 문제는 따로 막아야 한다.

## 캐시 키에 목표 크기 넣기

원본 URL만 캐시 키로 쓰면 작은 목록 썸네일과 큰 상세 이미지가 같은 항목을 두고 충돌한다. 그러면 어떤 크기를 먼저 요청했느냐에 따라 나중 요청의 화질과 메모리 비용이 정해진다.

```swift
struct ThumbnailCacheKey: Hashable, Sendable {
    let resourceID: String
    let pixelWidth: Int
    let pixelHeight: Int
    let contentMode: ThumbnailDecoder.ContentMode
}
```

반대로 크기가 조금만 달라도 별도 항목으로 저장하면 캐시를 재사용하기 어렵다. 화면에서 쓰는 이미지 크기를 몇 단계로 묶고, 그 값을 키에 쓴다. 캐시 비용은 압축 파일 크기가 아니라 디코딩한 이미지의 메모리 사용량으로 계산한다.

## 반복 처리에서는 임시 객체의 수명도 제한하기

여러 이미지를 순차 처리하는 가져오기 화면이나 업로드 준비 과정에서는 autorelease 객체가 루프가 끝날 때까지 남을 수 있다. 반복마다 동기 작업 경계를 나누면 피크가 덜 쌓인다.

```swift
for request in requests {
    try autoreleasepool {
        let image = try ThumbnailDecoder.decode(
            from: request.fileURL,
            fitting: request.targetSize,
            scale: request.scale,
            contentMode: request.contentMode
        )
        try persist(image, for: request.cacheKey)
    }
}
```

`autoreleasepool`은 보조 수단이다. 목표 크기 디코딩과 동시성 제한을 먼저 적용하고, 그다음 반복 작업에서 임시 객체가 사는 기간을 줄인다. 원본 디코딩 자체를 안전하게 만들어 주지는 않는다.

## 테스트: 결과 이미지 크기와 반복 처리의 메모리 확인하기

결과 이미지의 크기는 단위 테스트로 확인할 수 있지만, 스크롤 중 메모리 사용량은 따로 측정해야 한다. 두 항목을 나눠 확인한다.

### 1. fit 결과 크기와 fill에 필요한 픽셀 수 확인

```swift
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
```

fixture는 저장소에 넣어도 되는 공개 테스트 이미지를 쓰고, 라이선스와 생성 방법을 함께 적는다. 두 번째 테스트는 4:1 원본을 정사각형 fill 슬롯에 넣는 순수 계산이다. 짧은 축이 잘라 낼 영역을 덮는지 확인한다. 방향 메타데이터가 있는 세로 이미지 fixture도 추가해, 회전을 적용한 뒤의 폭과 높이가 예상과 같은지 확인한다.

### 2. 잘못된 입력과 경계 크기 확인

- 손상된 파일은 `.cannotCreateSource` 또는 `.cannotCreateThumbnail`로 종료되는가?
- NaN·무한대·0·음수 target이나 scale은 `.invalidTargetSize`로 거부되는가?
- NaN·무한대·0·음수 source 크기는 `.invalidSourceDimensions`로 거부되는가?
- 곱셈 결과가 무한대이거나 `Int` 범위를 넘으면 오류로 처리하는가?
- 매우 작은 target에서도 `maxPixelSize`가 유효한 값인가?
- 같은 URL의 서로 다른 target 또는 content mode가 다른 캐시 키를 사용하는가?

### 3. 반복 스크롤의 메모리 추세 확인

UI 테스트나 전용 디버그 화면에서 큰 fixture 집합을 반복해서 노출하고 다음을 본다.

- 스크롤이 여러 번 왕복해도 live decoded image 수가 계속 증가하지 않는가?
- 화면에서 사라진 셀의 요청이 취소되는가?
- memory warning 뒤 메모리 캐시가 비워지고 화면이 복구되는가?
- 한 번의 큰 피크보다 반복마다 기준선이 올라가는 누수가 있는가?

절대 수치 하나를 모든 기기의 합격선으로 두지 않는다. fixture·화면 동작·빌드 조건을 같게 맞추고 추세를 비교한다. Instruments의 Allocations와 VM Tracker, 메모리 그래프를 함께 보면 `UIImage`, `CGImage`, 압축 `Data`, 캐시 중 어디에 비용이 남는지 구분하기 쉽다.

## 정리

1. 뷰의 point 크기와 scale로 목표 픽셀 크기를 계산한다.
2. ImageIO가 원본 대신 목표 크기의 썸네일을 직접 디코딩한다.
3. 동시 디코딩 수와 캐시 비용에도 상한을 둔다.
4. 캐시 키에 단계로 묶은 목표 크기와 표시 정책을 넣는다.
5. 결과 이미지 크기 테스트와 반복 처리의 메모리 측정을 분리한다.

이 설정으로 이미지 크기와 동시 작업 수는 관리할 수 있다. 앱 전체의 메모리 상한까지 보장하지는 않는다. 중간 버퍼와 캐시를 포함한 실제 사용량은 같은 입력과 기기 조건에서 측정한다.
