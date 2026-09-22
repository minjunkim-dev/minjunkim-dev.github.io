"""Run the article's pure size calculation with Swift; no UIKit/device required."""
from pathlib import Path
import subprocess

article = (Path(__file__).resolve().parents[1] / "src/content/writing/imageio-downsampling-memory-stability.md").read_text()
function = article.split("    static func maxPixelSize(", 1)[1].split("    private static func sourcePixelSize(", 1)[0]
source = '''import Foundation
struct ThumbnailDecoder {
    enum ContentMode { case aspectFit, aspectFill }
    enum DecodeError: Error { case invalidTargetSize, invalidSourceDimensions }
    static func maxPixelSize(''' + function + '''}
let source = CGSize(width: 4000, height: 1000)
let target = CGSize(width: 100, height: 100)
let fit = try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: 2, contentMode: .aspectFit)
let fill = try ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: 2, contentMode: .aspectFill)
precondition(fit == 200 && fill == 800)
for bad: CGFloat in [0, -1, .infinity, .nan] {
    precondition((try? ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: CGSize(width: bad, height: 100), scale: 2, contentMode: .aspectFit)) == nil)
    precondition((try? ThumbnailDecoder.maxPixelSize(sourcePixelSize: CGSize(width: bad, height: 100), targetPointSize: target, scale: 2, contentMode: .aspectFill)) == nil)
    precondition((try? ThumbnailDecoder.maxPixelSize(sourcePixelSize: source, targetPointSize: target, scale: bad, contentMode: .aspectFit)) == nil)
}
precondition((try? ThumbnailDecoder.maxPixelSize(sourcePixelSize: CGSize(width: 1e30, height: 1e30), targetPointSize: CGSize(width: 1e30, height: 1e30), scale: 1, contentMode: .aspectFit)) == nil)
print("Swift article sizing: fit/fill, invalid dimensions/scale, and Int overflow checks passed.")
'''
subprocess.run(["swift", "-"], input=source, text=True, check=True)
