import ExpoModulesCore
import UniformTypeIdentifiers
import ImageIO
import CryptoKit
import UIKit

private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  let finish: (URL?) -> Void
  init(finish: @escaping (URL?) -> Void) { self.finish = finish }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls.first) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
}

public class PhotoPrunerNativeModule: Module {
  private let worker = DispatchQueue(label: "photo-pruner.files", qos: .userInitiated)
  private var pickerDelegate: FolderPickerDelegate?
  private var folder: URL?
  private var hasScope = false
  private var fileURLs: [String: URL] = [:]
  private let defaults = UserDefaults.standard
  private let extensions: Set<String> = ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff", "dng", "nef", "nrw", "cr2", "cr3", "crw", "arw", "sr2", "srf", "raf", "orf", "rw2", "pef", "rwl", "raw", "srw"]

  public func definition() -> ModuleDefinition {
    Name("PhotoPrunerNative")

    AsyncFunction("openFolder") { (promise: Promise) in
      guard self.pickerDelegate == nil else { promise.reject("PICKER_BUSY", "A folder picker is already open."); return }
      guard let controller = self.appContext?.utilities?.currentViewController() else {
        promise.reject("NO_CONTROLLER", "Cannot present the folder picker."); return
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      picker.allowsMultipleSelection = false
      picker.directoryURL = self.demoURL()
      let delegate = FolderPickerDelegate { [weak self] url in
        guard let self = self else { return }
        self.pickerDelegate = nil
        guard let url = url else { promise.resolve(nil as String?); return }
        self.worker.async {
          do { promise.resolve(try self.activate(url)) } catch { promise.reject(error) }
        }
      }
      self.pickerDelegate = delegate
      picker.delegate = delegate
      controller.present(picker, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("restoreFolder") { () -> [String: Any]? in
      guard let data = self.defaults.data(forKey: "photo-pruner.folder-bookmark") else { return nil }
      var stale = false
      let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      return try self.activate(url)
    }.runOnQueue(worker)

    AsyncFunction("refreshFolder") { () -> [String: Any] in
      guard let url = self.folder else { throw self.failure("Choose a folder first.") }
      return try self.scan(url)
    }.runOnQueue(worker)

    AsyncFunction("preview") { (name: String) -> String in
      guard let url = self.fileURLs[name] else { throw self.failure("The selected file is no longer in this folder.") }
      let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
      let key = self.digest(url.path + String(values.fileSize ?? 0) + String(values.contentModificationDate?.timeIntervalSince1970 ?? 0))
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("previews", isDirectory: true)
      try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
      let target = cache.appendingPathComponent(key + ".jpg")
      if FileManager.default.fileExists(atPath: target.path) { return target.absoluteString }
      var coordinationError: NSError?
      var readError: Error?
      NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
        do {
          guard let source = CGImageSourceCreateWithURL(coordinated as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2400, kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
                let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
          else { throw self.failure("No preview available for \(name). Try its JPEG companion or a supported RAW format.") }
          CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
          guard CGImageDestinationFinalize(destination) else { throw self.failure("Could not cache the image preview.") }
        } catch { readError = error }
      }
      if let error = coordinationError { throw error }
      if let error = readError { throw error }
      return target.absoluteString
    }.runOnQueue(worker)

    AsyncFunction("loadReview") { (folderID: String) -> String? in
      let url = try self.reviewURL(folderID)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try String(contentsOf: url, encoding: .utf8)
    }.runOnQueue(worker)

    AsyncFunction("saveReview") { (folderID: String, json: String) in
      guard let data = json.data(using: .utf8), (try JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw self.failure("Invalid review data.") }
      try data.write(to: self.reviewURL(folderID), options: .atomic)
    }.runOnQueue(worker)

    AsyncFunction("createDemoFolder") { (promise: Promise) in
      do {
        let url = try self.createDemo()
        self.worker.async {
          do { promise.resolve(try self.activate(url)) } catch { promise.reject(error) }
        }
      } catch { promise.reject(error) }
    }.runOnQueue(.main)

    View(PhotoPrunerNativeView.self) {
      Events("onCommand")
      Prop("enabled") { (view: PhotoPrunerNativeView, enabled: Bool) in view.enabled = enabled }
    }
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "PhotoPruner", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func activate(_ url: URL) throws -> [String: Any] {
    let newScope = url.startAccessingSecurityScopedResource()
    do {
      let result = try scan(url)
      let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      defaults.set(bookmark, forKey: "photo-pruner.folder-bookmark")
      if hasScope { folder?.stopAccessingSecurityScopedResource() }
      folder = url
      hasScope = newScope
      return result
    } catch {
      if newScope { url.stopAccessingSecurityScopedResource() }
      throw error
    }
  }

  private func scan(_ url: URL) throws -> [String: Any] {
    let started = Date()
    var coordinationError: NSError?
    var readError: Error?
    var entries: [[String: Any]] = []
    var nextURLs: [String: URL] = [:]
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
      do {
        let urls = try FileManager.default.contentsOfDirectory(at: coordinated, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey], options: [.skipsHiddenFiles])
        for file in urls where self.extensions.contains(file.pathExtension.lowercased()) {
          let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
          guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
          nextURLs[file.lastPathComponent] = file
          entries.append(["name": file.lastPathComponent, "size": values.fileSize ?? 0])
        }
      } catch { readError = error }
    }
    if let error = coordinationError { throw error }
    if let error = readError { throw error }
    fileURLs = nextURLs
    return ["id": digest(url.standardizedFileURL.path), "name": url.lastPathComponent, "files": entries, "scanMs": Date().timeIntervalSince(started) * 1000]
  }

  private func reviewURL(_ id: String) throws -> URL {
    guard id.count == 64, id.allSatisfy({ $0.isHexDigit }) else { throw failure("Invalid folder identifier.") }
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("reviews", isDirectory: true)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base.appendingPathComponent(id + ".json")
  }
  private func demoURL() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Sample shoot", isDirectory: true)
  }

  private func createDemo() throws -> URL {
    let directory = demoURL()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let colors: [UIColor] = [.systemTeal, .systemOrange, .systemIndigo]
    for number in 1...3 {
      let file = directory.appendingPathComponent(String(format: "DSC_%04d.JPG", number))
      if FileManager.default.fileExists(atPath: file.path) { continue }
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      let image = UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 1067), format: format).image { context in
        UIColor(white: 0.07, alpha: 1).setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1600, height: 1067))
        colors[number - 1].setFill()
        UIBezierPath(ovalIn: CGRect(x: CGFloat(250 + number * 70), y: 90, width: 750, height: 750)).fill()
        ("SAMPLE 0\(number)" as NSString).draw(at: CGPoint(x: 90, y: 850), withAttributes: [.font: UIFont.monospacedSystemFont(ofSize: 84, weight: .bold), .foregroundColor: UIColor.white])
        ("Photo Pruner · preview fixture" as NSString).draw(at: CGPoint(x: 96, y: 970), withAttributes: [.font: UIFont.systemFont(ofSize: 30), .foregroundColor: UIColor.lightGray])
      }
      guard let data = image.jpegData(compressionQuality: 0.9) else { throw failure("Could not create sample images.") }
      try data.write(to: file, options: .atomic)
    }
    // Invalid RAW data tests grouping and graceful failure, not camera RAW decoding.
    for name in ["DSC_0001.NEF", "DSC_0002.NEF", "DSC_0004.NEF"] {
      let target = directory.appendingPathComponent(name)
      if !FileManager.default.fileExists(atPath: target.path) {
        try Data("Synthetic pairing fixture. Not a decodable camera RAW file.\n".utf8).write(to: target, options: .atomic)
      }
    }
    return directory
  }
}
