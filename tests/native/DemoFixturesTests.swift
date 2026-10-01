import XCTest
import Foundation
@testable import PhotoPrunerCore

final class DemoFixturesTests: XCTestCase {
  var documents: URL!

  override func setUpWithError() throws {
    documents = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try FileManager.default.removeItem(at: documents)
  }

  func testUpgradeGeneratesCurrentSamplesAndPreservesLegacyFiles() throws {
    let legacy = documents.appendingPathComponent("Sample shoot", isDirectory: true)
    try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
    let oldJPEG = Data("Photo Pruner · preview fixture".utf8)
    for number in 1...3 {
      try oldJPEG.write(to: legacy.appendingPathComponent(String(format: "DSC_%04d.JPG", number)))
    }
    let userPhoto = Data("user-added RAW".utf8)
    try userPhoto.write(to: legacy.appendingPathComponent("My photo.ORF"))

    let keeperJPEG = Data("Keeper · preview fixture".utf8)
    var rendered: [Int] = []
    let current = try DemoFixtures.prepare(in: documents) { number in
      rendered.append(number)
      return keeperJPEG
    }

    XCTAssertNotEqual(current, legacy)
    XCTAssertEqual(rendered, [1, 2, 3])
    for number in 1...3 {
      let name = String(format: "DSC_%04d.JPG", number)
      XCTAssertEqual(try Data(contentsOf: current.appendingPathComponent(name)), keeperJPEG)
      XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent(name)), oldJPEG)
    }
    XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent("My photo.ORF")), userPhoto)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: current.path).sorted(), [
      "DSC_0001.JPG", "DSC_0001.NEF", "DSC_0002.JPG", "DSC_0002.NEF", "DSC_0003.JPG", "DSC_0004.NEF"
    ])
  }

  func testReopeningCurrentVersionPreservesFilesAndRepairsMissingFixtures() throws {
    let directory = try DemoFixtures.prepare(in: documents) { Data("Keeper sample \($0)".utf8) }
    let edited = directory.appendingPathComponent("DSC_0001.JPG")
    let userJPEG = Data("user-edited sample".utf8)
    try userJPEG.write(to: edited)
    let raw = directory.appendingPathComponent("DSC_0001.NEF")
    let userRAW = Data("user-replaced RAW".utf8)
    try userRAW.write(to: raw)

    let reopened = try DemoFixtures.prepare(in: documents) { _ in
      XCTFail("Opening the same version must reuse its JPEGs")
      return Data()
    }
    XCTAssertEqual(reopened, directory)
    XCTAssertEqual(try Data(contentsOf: edited), userJPEG)
    XCTAssertEqual(try Data(contentsOf: raw), userRAW)

    let missing = directory.appendingPathComponent("DSC_0002.JPG")
    try FileManager.default.removeItem(at: missing)
    var rendered: [Int] = []
    _ = try DemoFixtures.prepare(in: documents) { number in
      rendered.append(number)
      return Data("repaired sample".utf8)
    }
    XCTAssertEqual(rendered, [2])
    XCTAssertEqual(try Data(contentsOf: missing), Data("repaired sample".utf8))
    XCTAssertEqual(try Data(contentsOf: edited), userJPEG)
    XCTAssertEqual(try Data(contentsOf: raw), userRAW)
  }
}
