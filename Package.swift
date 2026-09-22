// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PhotoPrunerCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  products: [.library(name: "PhotoPrunerCore", targets: ["PhotoPrunerCore"])],
  targets: [
    .target(name: "PhotoPrunerCore", path: "modules/photo-pruner-native/ios/Core"),
    .testTarget(name: "PhotoPrunerCoreTests", dependencies: ["PhotoPrunerCore"], path: "tests/native")
  ]
)
