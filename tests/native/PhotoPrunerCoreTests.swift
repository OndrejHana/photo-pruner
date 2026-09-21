import XCTest
import Foundation
import ImageIO
@testable import PhotoPrunerCore

final class PhotoPrunerCoreTests: XCTestCase {
  var root: URL!
  var source: URL!
  var output: URL!

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    source = root.appendingPathComponent("Source")
    output = root.appendingPathComponent("Output")
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

  @discardableResult func fixture(_ name: String, data: Data = Data(repeating: 42, count: 2_500_000)) throws -> URL {
    let url = source.appendingPathComponent(name)
    try data.write(to: url)
    return url
  }

  func testExportCopiesExactBytesAndNeverTouchesOriginals() throws {
    let first = try fixture("One.ORF")
    let second = try fixture("Two.ORF", data: Data("another raw".utf8))
    try fixture("One.JPG")
    let before = try Data(contentsOf: first)
    let snapshot = try LibrarySnapshot.scan(source)
    var reports: [ExportProgress] = []
    let result = try KeeperExporter.export(snapshot: snapshot, names: ["One.ORF", "Two.ORF"], parent: output) { reports.append($0) }
    XCTAssertEqual(result.count, 2)
    XCTAssertEqual(try Data(contentsOf: result.directory.appendingPathComponent("One.ORF")), before)
    XCTAssertEqual(try Data(contentsOf: result.directory.appendingPathComponent("Two.ORF")), try Data(contentsOf: second))
    XCTAssertEqual(try Data(contentsOf: first), before)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: result.directory.path).sorted(), ["One.ORF", "Two.ORF"])
    XCTAssertEqual(reports.last?.copied, 2)
    XCTAssertEqual(reports.last?.bytes, result.bytes)
    let again = try KeeperExporter.export(snapshot: snapshot, names: ["One.ORF"], parent: output)
    XCTAssertNotEqual(again.directory, result.directory)
    XCTAssertTrue(FileManager.default.fileExists(atPath: result.directory.path))
  }

  func testRejectsUnsafeNonRawAndEmptySelections() throws {
    try fixture("One.ORF")
    try fixture("One.JPG")
    let snapshot = try LibrarySnapshot.scan(source)
    for names in [[], ["One.JPG"], ["../One.ORF"], ["One.ORF", "One.ORF"], ["Missing.ORF"]] {
      XCTAssertThrowsError(try KeeperExporter.export(snapshot: snapshot, names: names, parent: output))
    }
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: output.path).isEmpty)
  }

  func testCancellationRemovesOnlyItsOwnStagingFolder() throws {
    try fixture("One.ORF")
    let existing = output.appendingPathComponent("Incomplete unrelated")
    try FileManager.default.createDirectory(at: existing, withIntermediateDirectories: false)
    let cancellation = ExportCancellation()
    XCTAssertThrowsError(try KeeperExporter.export(snapshot: LibrarySnapshot.scan(source), names: ["One.ORF"], parent: output, cancellation: cancellation) { _ in cancellation.cancel() })
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: output.path), [existing.lastPathComponent])
  }

  func testChangedSourceAbortsAndCleansEarlierCopies() throws {
    try fixture("One.ORF")
    let second = try fixture("Two.ORF")
    let snapshot = try LibrarySnapshot.scan(source)
    XCTAssertThrowsError(try KeeperExporter.export(snapshot: snapshot, names: ["One.ORF", "Two.ORF"], parent: output) { report in
      if report.copied == 1 { try! Data("changed".utf8).write(to: second) }
    })
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: output.path).isEmpty)
    XCTAssertEqual(try String(contentsOf: second, encoding: .utf8), "changed")
  }

  func testScanSkipsSymlinksAndRejectsReplacementAfterScan() throws {
    let original = try fixture("One.ORF")
    try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("Alias.ORF"), withDestinationURL: original)
    let snapshot = try LibrarySnapshot.scan(source)
    XCTAssertEqual(snapshot.files.count, 1)
    try FileManager.default.removeItem(at: original)
    try FileManager.default.createSymbolicLink(at: original, withDestinationURL: output)
    XCTAssertThrowsError(try KeeperExporter.export(snapshot: snapshot, names: ["One.ORF"], parent: output))
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: output.path).isEmpty)
  }

  func testRealOlympusPreviewsAreBoundedAndFallbackWorks() throws {
    guard let fixtures = ProcessInfo.processInfo.environment["ORF_FIXTURES"] else { throw XCTSkip("Set ORF_FIXTURES after downloading the licensed samples.") }
    let evidence = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("artifacts/native-evidence")
    try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
    let cacheDirectory = root.appendingPathComponent("cache")
    let cache = PreviewCache(directory: cacheDirectory, fileLimit: 1)
    try fixture("Broken.JPG", data: Data("invalid jpeg".utf8))
    for name in ["E-P3.ORF", "E-M1MarkII.ORF"] {
      try FileManager.default.copyItem(at: URL(fileURLWithPath: fixtures).appendingPathComponent(name), to: source.appendingPathComponent(name))
      let snapshot = try LibrarySnapshot.scan(source)
      let uri = try cache.preview(snapshot.selected(["Broken.JPG", name]))
      let url = try XCTUnwrap(URL(string: uri))
      let image = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
      let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any])
      let width = try XCTUnwrap(properties[kCGImagePropertyPixelWidth] as? Int)
      let height = try XCTUnwrap(properties[kCGImagePropertyPixelHeight] as? Int)
      XCTAssertGreaterThanOrEqual(max(width, height), 1200)
      XCTAssertLessThanOrEqual(max(width, height), 2400)
      XCTAssertEqual(try cache.preview(snapshot.selected([name])), uri)
      XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: cacheDirectory.path).count, 1)
      let target = evidence.appendingPathComponent(name + ".jpg")
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.copyItem(at: url, to: target)
      print("ORF evidence: \(name) -> \(width)x\(height) JPEG")
    }
  }
}
