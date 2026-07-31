// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "PicoMenu",
  platforms: [.macOS(.v15)],
  products: [
    .executable(name: "PicoMenu", targets: ["PicoMenu"])
  ],
  targets: [
    .executableTarget(name: "PicoMenu")
  ]
)
