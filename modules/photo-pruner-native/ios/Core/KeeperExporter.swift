import Foundation
import CryptoKit
import Darwin

final class ExportCancellation {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func check() throws {
    lock.lock(); let value = cancelled; lock.unlock()
    if value { throw prunerError("Export cancelled.") }
  }
}

struct ExportProgress {
  let copied: Int
  let total: Int
  let bytes: Int64
  let totalBytes: Int64
  let phase: String
  var dictionary: [String: Any] {
    ["copied": copied, "total": total, "bytes": bytes, "totalBytes": totalBytes, "phase": phase]
  }
}

struct ExportResult {
  let directory: URL
  let count: Int
  let bytes: Int64
  var dictionary: [String: Any] { ["name": directory.lastPathComponent, "uri": directory.absoluteString, "count": count, "bytes": bytes] }
}

enum KeeperExporter {
  static func export(snapshot: LibrarySnapshot, names: [String], parent: URL,
                     cancellation: ExportCancellation = ExportCancellation(),
                     progress: (ExportProgress) -> Void = { _ in }) throws -> ExportResult {
    let files = try snapshot.selected(names, rawOnly: true)
    guard !files.isEmpty else { throw prunerError("Keep at least one RAW photo before exporting.") }
    let total = try files.reduce(Int64(0)) { accumulated, file in
      let (sum, overflow) = accumulated.addingReportingOverflow(file.fingerprint.size)
      guard !overflow, sum <= 9_007_199_254_740_991 else { throw prunerError("The export is too large.") }
      return sum
    }
    try cancellation.check()
    for file in files { try file.checkUnchanged() }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd HHmmss"
    let name = "Keepers \(formatter.string(from: Date())) \(UUID().uuidString.prefix(8))"
    let staging = parent.appendingPathComponent("Incomplete " + name, isDirectory: true)
    let destination = parent.appendingPathComponent(name, isDirectory: true)
    // mkdir fails if the path exists, so cleanup can only touch a directory we own.
    guard mkdir(staging.path, 0o700) == 0 else { throw prunerError("Cannot create a keepers folder in this location.") }
    do {
      var completed: Int64 = 0
      for (index, file) in files.enumerated() {
        try cancellation.check()
        let output = staging.appendingPathComponent(file.name)
        try copyVerified(file, to: output, cancellation: cancellation) { bytes, phase in
          progress(ExportProgress(copied: index, total: files.count, bytes: completed + bytes, totalBytes: total, phase: phase))
        }
        completed += file.fingerprint.size
        progress(ExportProgress(copied: index + 1, total: files.count, bytes: completed, totalBytes: total, phase: "copying"))
      }
      try cancellation.check()
      // A same-parent rename publishes the complete folder. No partial output is called Keepers.
      var coordinationError: NSError?
      var publishError: Error?
      NSFileCoordinator().coordinate(writingItemAt: staging, options: .forMoving, writingItemAt: destination, options: [], error: &coordinationError) { from, to in
        do {
          try cancellation.check()
          try FileManager.default.moveItem(at: from, to: to)
        } catch { publishError = error }
      }
      if let error = coordinationError { throw error }
      if let error = publishError { throw error }
      return ExportResult(directory: destination, count: files.count, bytes: total)
    } catch {
      do { try FileManager.default.removeItem(at: staging) }
      catch let cleanupError {
        throw prunerError("\(error.localizedDescription) An unfinished folder remains: \(staging.lastPathComponent). Remove it in Files before retrying. \(cleanupError.localizedDescription)")
      }
      throw error
    }
  }

  private static func copyVerified(_ file: ScannedFile, to output: URL, cancellation: ExportCancellation,
                                   progress: (Int64, String) -> Void) throws {
    var coordinationError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: file.url, options: [], writingItemAt: output, options: [], error: &coordinationError) { source, destination in
      do {
        let descriptor = open(source.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw prunerError("Cannot open \(file.name). Rescan the folder.") }
        let input = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? input.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, try FileFingerprint(info) == file.fingerprint else {
          throw prunerError("\(file.name) changed since scanning. Rescan the folder.")
        }
        let outputDescriptor = open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard outputDescriptor >= 0 else { throw prunerError("Cannot create \(file.name) in the output folder.") }
        let writer = FileHandle(fileDescriptor: outputDescriptor, closeOnDealloc: true)
        defer { try? writer.close() }
        var hash = SHA256()
        var copied: Int64 = 0
        var lastProgress = Date.distantPast
        while true {
          try cancellation.check()
          guard let chunk = try input.read(upToCount: 1024 * 1024), !chunk.isEmpty else { break }
          try writer.write(contentsOf: chunk)
          hash.update(data: chunk)
          copied += Int64(chunk.count)
          if Date().timeIntervalSince(lastProgress) > 0.1 {
            progress(copied, "copying")
            lastProgress = Date()
          }
        }
        try writer.synchronize()
        try writer.close()
        guard copied == file.fingerprint.size, fstat(descriptor, &info) == 0,
              try FileFingerprint(info) == file.fingerprint else {
          throw prunerError("\(file.name) changed while copying. Rescan the folder.")
        }
        try file.checkUnchanged(at: source)
        progress(copied, "verifying")
        let expected = hash.finalize()
        let reader = try FileHandle(forReadingFrom: destination)
        defer { try? reader.close() }
        var actual = SHA256()
        while true {
          try cancellation.check()
          guard let chunk = try reader.read(upToCount: 1024 * 1024), !chunk.isEmpty else { break }
          actual.update(data: chunk)
        }
        guard actual.finalize() == expected else { throw prunerError("Verification failed for \(file.name).") }
      } catch { copyError = error }
    }
    if let error = coordinationError { throw error }
    if let error = copyError { throw error }
  }
}
