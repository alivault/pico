import Foundation

struct PicoMenuCommandResult: Sendable {
  var status: Int32
  var standardOutput: String
  var standardError: String
}
