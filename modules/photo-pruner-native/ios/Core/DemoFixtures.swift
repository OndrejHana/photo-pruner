import Foundation

enum DemoFixtures {
  // Bump when generated content changes. Preserve older folders because users
  // can review, edit, or add their own files through Files.
  static let version = 2

  static func directory(in documents: URL) -> URL {
    documents.appendingPathComponent("Sample shoot v\(version)", isDirectory: true)
  }

  static func prepare(in documents: URL, jpeg: (Int) throws -> Data) throws -> URL {
    let directory = Self.directory(in: documents)
    let files = FileManager.default
    try files.createDirectory(at: directory, withIntermediateDirectories: true)
    for number in 1...3 {
      let target = directory.appendingPathComponent(String(format: "DSC_%04d.JPG", number))
      if !files.fileExists(atPath: target.path) {
        try jpeg(number).write(to: target, options: .atomic)
      }
    }
    // Invalid RAW data tests grouping and graceful failure, not camera RAW decoding.
    for name in ["DSC_0001.NEF", "DSC_0002.NEF", "DSC_0004.NEF"] {
      let target = directory.appendingPathComponent(name)
      if !files.fileExists(atPath: target.path) {
        try Data("Synthetic pairing fixture. Not a decodable camera RAW file.\n".utf8).write(to: target, options: .atomic)
      }
    }
    return directory
  }
}
