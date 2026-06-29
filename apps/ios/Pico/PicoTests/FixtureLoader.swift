import Foundation

final class FixtureLoader {
  static func data(named name: String) throws -> Data {
    let bundle = Bundle(for: FixtureLoader.self)
    guard let url = bundle.url(forResource: name, withExtension: "json") else {
      throw CocoaError(.fileNoSuchFile)
    }
    return try Data(contentsOf: url)
  }
}
