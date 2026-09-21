import ExpoModulesCore
import UniformTypeIdentifiers
import UIKit

private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  let finish: (URL?) -> Void
  init(finish: @escaping (URL?) -> Void) { self.finish = finish }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls.first) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
}

public class PhotoPrunerNativeModule: Module {
  private let worker = DispatchQueue(label: "photo-pruner.files", qos: .userInitiated)
  private let reviewWorker = DispatchQueue(label: "photo-pruner.reviews", qos: .utility)
  private var pickerDelegate: FolderPickerDelegate?
  private var snapshot: LibrarySnapshot?
  private var hasScope = false
  private var exportCancellation: ExportCancellation?
  private let defaults = UserDefaults.standard
  private lazy var previews = PreviewCache(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("previews-v2", isDirectory: true))

  public func definition() -> ModuleDefinition {
    Name("PhotoPrunerNative")
    Constants(["apiVersion": 2])
    Events("onExportProgress")

    AsyncFunction("openFolder") { (promise: Promise) in
      guard self.exportCancellation == nil else { promise.reject("EXPORT_BUSY", "Wait for the export to finish."); return }
      self.pickFolder(promise: promise) { url in
        self.worker.async {
          do { promise.resolve(try self.activate(url)) } catch { promise.reject(error) }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("restoreFolder") { () -> [String: Any]? in
      guard let data = self.defaults.data(forKey: "photo-pruner.folder-bookmark") else { return nil }
      var stale = false
      let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      return try self.activate(url)
    }.runOnQueue(worker)

    AsyncFunction("refreshFolder") { () -> [String: Any] in
      guard let current = self.snapshot else { throw prunerError("Choose a folder first.") }
      let next = try LibrarySnapshot.scan(current.url)
      self.snapshot = next
      return next.dictionary
    }.runOnQueue(worker)

    // Kept for the previous JS bundle while the development client is upgraded.
    AsyncFunction("preview") { (name: String) -> String in
      guard let current = self.snapshot else { throw prunerError("Choose a folder first.") }
      return try self.previews.preview(current.selected([name]))
    }.runOnQueue(worker)

    AsyncFunction("previewCandidates") { (revision: String, names: [String]) -> String in
      let current = try self.currentSnapshot(revision)
      return try self.previews.preview(current.selected(names))
    }.runOnQueue(worker)

    AsyncFunction("exportKeepers") { (revision: String, names: [String], promise: Promise) in
      guard self.exportCancellation == nil, self.pickerDelegate == nil else {
        promise.reject("BUSY", "Another folder operation is running."); return
      }
      let cancellation = ExportCancellation()
      self.exportCancellation = cancellation
      self.pickFolder(promise: promise, cancelled: { self.exportCancellation = nil }) { parent in
        self.worker.async {
          let scope = parent.startAccessingSecurityScopedResource()
          defer { if scope { parent.stopAccessingSecurityScopedResource() } }
          let result = Result { () -> [String: Any] in
            let current = try self.currentSnapshot(revision)
            return try KeeperExporter.export(snapshot: current, names: names, parent: parent, cancellation: cancellation) { progress in
              self.sendEvent("onExportProgress", progress.dictionary)
            }.dictionary
          }
          DispatchQueue.main.async {
            self.exportCancellation = nil
            switch result {
            case .success(let value): promise.resolve(value)
            case .failure(let error): promise.reject(error)
            }
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("cancelExport") { self.exportCancellation?.cancel() }.runOnQueue(.main)

    AsyncFunction("loadReview") { (folderID: String) -> String? in
      let url = try self.reviewURL(folderID)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try String(contentsOf: url, encoding: .utf8)
    }.runOnQueue(reviewWorker)

    AsyncFunction("saveReview") { (folderID: String, json: String) in
      guard let data = json.data(using: .utf8), (try JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw prunerError("Invalid review data.") }
      try data.write(to: self.reviewURL(folderID), options: .atomic)
    }.runOnQueue(reviewWorker)

    AsyncFunction("createDemoFolder") { (promise: Promise) in
      guard self.exportCancellation == nil, self.pickerDelegate == nil else { promise.reject("BUSY", "Another folder operation is running."); return }
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

  private func pickFolder(promise: Promise, cancelled: @escaping () -> Void = {}, selected: @escaping (URL) -> Void) {
    guard pickerDelegate == nil, let controller = appContext?.utilities?.currentViewController() else {
      cancelled()
      promise.reject("PICKER_UNAVAILABLE", "Cannot present the folder picker.")
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
    picker.allowsMultipleSelection = false
    picker.directoryURL = demoURL().deletingLastPathComponent()
    let delegate = FolderPickerDelegate { [weak self] url in
      self?.pickerDelegate = nil
      if let url = url { selected(url) }
      else { cancelled(); promise.resolve(nil as String?) }
    }
    pickerDelegate = delegate
    picker.delegate = delegate
    controller.present(picker, animated: true)
  }

  private func currentSnapshot(_ revision: String) throws -> LibrarySnapshot {
    guard let current = snapshot, current.revision == revision else {
      throw prunerError("The folder changed. Rescan and try again.")
    }
    return current
  }

  private func activate(_ url: URL) throws -> [String: Any] {
    let newScope = url.startAccessingSecurityScopedResource()
    do {
      let next = try LibrarySnapshot.scan(url)
      let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      defaults.set(bookmark, forKey: "photo-pruner.folder-bookmark")
      if hasScope { snapshot?.url.stopAccessingSecurityScopedResource() }
      snapshot = next
      hasScope = newScope
      return next.dictionary
    } catch {
      if newScope { url.stopAccessingSecurityScopedResource() }
      throw error
    }
  }

  private func reviewURL(_ id: String) throws -> URL {
    guard id.count == 64, id.allSatisfy({ $0.isHexDigit }) else { throw prunerError("Invalid folder identifier.") }
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
      guard let data = image.jpegData(compressionQuality: 0.9) else { throw prunerError("Could not create sample images.") }
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
