import Foundation
import ImageIO
import UniformTypeIdentifiers

final class PreviewCache {
  private let directory: URL
  private let byteLimit: Int
  private let fileLimit: Int
  private var initialized = false

  init(directory: URL, byteLimit: Int = 256 * 1024 * 1024, fileLimit: Int = 160) {
    self.directory = directory
    self.byteLimit = byteLimit
    self.fileLimit = fileLimit
  }

  func preview(_ candidates: [ScannedFile]) throws -> String {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    if !initialized { try prune(); initialized = true }
    var lastError: Error = prunerError("No preview is available for this item.")
    for file in candidates {
      do { return try render(file).absoluteString }
      catch { lastError = error }
    }
    throw prunerError("No readable preview. \(lastError.localizedDescription)")
  }

  private func render(_ file: ScannedFile) throws -> URL {
    try file.checkUnchanged()
    let key = hexDigest(Data((file.url.path + ":" + file.fingerprint.cacheKey).utf8))
    let target = directory.appendingPathComponent(key + ".jpg")
    if FileManager.default.fileExists(atPath: target.path) {
      try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: target.path)
      return target
    }
    let temporary = directory.appendingPathComponent(UUID().uuidString + ".tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try coordinatedRead(file.url) { url in
      try file.checkUnchanged(at: url)
      guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
        throw prunerError("\(file.name) is not supported by this iPad.")
      }
      let options: [CFString: Any] = [kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 2400, kCGImageSourceShouldCacheImmediately: true]
      // Prefer the embedded preview; tiny EXIF thumbnails need a larger render.
      var thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
      if thumbnail == nil || max(thumbnail!.width, thumbnail!.height) < 1200 {
        var renderOptions = options
        renderOptions[kCGImageSourceCreateThumbnailFromImageAlways] = true
        thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, renderOptions as CFDictionary) ?? thumbnail
      }
      guard let image = thumbnail,
            let destination = CGImageDestinationCreateWithURL(temporary as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
        throw prunerError("\(file.name) has no decodable preview.")
      }
      CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw prunerError("Could not save the preview cache.") }
      try file.checkUnchanged(at: url)
    }
    try FileManager.default.moveItem(at: temporary, to: target)
    try prune(protecting: target)
    return target
  }

  private func prune(protecting: URL? = nil) throws {
    let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
    var cached: [(url: URL, size: Int, date: Date)] = []
    for entry in entries {
      if entry.pathExtension == "tmp" { try? FileManager.default.removeItem(at: entry); continue }
      let values = try entry.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      cached.append((entry, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast))
    }
    var bytes = cached.reduce(0) { $0 + $1.size }
    var count = cached.count
    for entry in cached.sorted(by: { $0.date < $1.date }) where entry.url != protecting {
      if bytes <= byteLimit && count <= fileLimit { break }
      try FileManager.default.removeItem(at: entry.url)
      bytes -= entry.size
      count -= 1
    }
  }
}
