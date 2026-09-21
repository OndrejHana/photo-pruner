import Foundation
import CryptoKit
import Darwin

func prunerError(_ message: String) -> NSError {
  NSError(domain: "PhotoPruner", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

func hexDigest(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

let rawExtensions: Set<String> = ["dng", "nef", "nrw", "cr2", "cr3", "crw", "arw", "sr2", "srf", "raf", "orf", "rw2", "pef", "rwl", "raw", "srw"]
let photoExtensions = rawExtensions.union(["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff"])

// Both inode and timestamps matter: replacing a same-size file must invalidate a scan.
struct FileFingerprint: Equatable {
  let size: Int64
  let inode: UInt64
  let device: Int32
  let seconds: Int
  let nanoseconds: Int

  init(_ info: stat) throws {
    guard info.st_mode & S_IFMT == S_IFREG, info.st_size >= 0,
          info.st_size <= 9_007_199_254_740_991 else {
      throw prunerError("Only regular photo files can be read.")
    }
    size = info.st_size
    inode = info.st_ino
    device = info.st_dev
    seconds = info.st_mtimespec.tv_sec
    nanoseconds = info.st_mtimespec.tv_nsec
  }

  static func at(_ url: URL) throws -> FileFingerprint {
    var info = stat()
    guard lstat(url.path, &info) == 0 else { throw prunerError("Cannot read \(url.lastPathComponent). Rescan the folder.") }
    return try FileFingerprint(info)
  }

  var cacheKey: String { "\(device):\(inode):\(size):\(seconds):\(nanoseconds)" }
}

struct ScannedFile {
  let url: URL
  let fingerprint: FileFingerprint
  var name: String { url.lastPathComponent }

  func checkUnchanged(at coordinatedURL: URL? = nil) throws {
    guard try FileFingerprint.at(coordinatedURL ?? url) == fingerprint else {
      throw prunerError("\(name) changed since scanning. Rescan before continuing.")
    }
  }
}

struct LibrarySnapshot {
  let url: URL
  let id: String
  let revision = UUID().uuidString
  let files: [String: ScannedFile]
  let scanMs: Double

  static func scan(_ url: URL) throws -> LibrarySnapshot {
    let started = Date()
    let files: [String: ScannedFile] = try coordinatedRead(url) { directory in
      let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles])
      var result: [String: ScannedFile] = [:]
      for entry in entries where photoExtensions.contains(entry.pathExtension.lowercased()) {
        let properties = try entry.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true else { continue }
        result[entry.lastPathComponent] = ScannedFile(url: entry, fingerprint: try FileFingerprint.at(entry))
      }
      return result
    }
    return LibrarySnapshot(url: url, id: hexDigest(Data(url.standardizedFileURL.path.utf8)), files: files, scanMs: Date().timeIntervalSince(started) * 1000)
  }

  var dictionary: [String: Any] {
    ["id": id, "revision": revision, "name": url.lastPathComponent,
     "files": files.values.map { ["name": $0.name, "size": $0.fingerprint.size] as [String: Any] }, "scanMs": scanMs]
  }

  func selected(_ names: [String], rawOnly: Bool = false) throws -> [ScannedFile] {
    var seen = Set<String>()
    return try names.map { name in
      let key = name.precomposedStringWithCanonicalMapping.lowercased()
      guard name != ".", name != "..", !name.contains("/"), !name.contains("\\"), !name.contains("\0"),
            seen.insert(key).inserted, let file = files[name],
            !rawOnly || rawExtensions.contains(file.url.pathExtension.lowercased()) else {
        throw prunerError("Invalid or conflicting photo selection. Rescan the folder.")
      }
      return file
    }
  }
}

func coordinatedRead<T>(_ url: URL, _ operation: (URL) throws -> T) throws -> T {
  var coordinationError: NSError?
  var result: Result<T, Error>?
  NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { location in
    result = Result { try operation(location) }
  }
  if let error = coordinationError { throw error }
  guard let result = result else { throw prunerError("Could not access the selected folder.") }
  return try result.get()
}
