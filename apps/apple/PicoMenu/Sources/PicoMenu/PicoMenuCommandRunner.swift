import Foundation

actor PicoMenuCommandRunner {
  func run(executable: URL, arguments: [String]) -> Int32 {
    runCapturingOutput(executable: executable, arguments: arguments).status
  }

  func runCapturingOutput(
    executable: URL,
    arguments: [String]
  ) -> PicoMenuCommandResult {
    let standardOutput = Pipe()
    let standardError = Pipe()
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.standardOutput = standardOutput
    process.standardError = standardError
    do {
      try process.run()
      process.waitUntilExit()
      return PicoMenuCommandResult(
        status: process.terminationStatus,
        standardOutput: String(
          decoding: standardOutput.fileHandleForReading.readDataToEndOfFile(),
          as: UTF8.self
        ),
        standardError: String(
          decoding: standardError.fileHandleForReading.readDataToEndOfFile(),
          as: UTF8.self
        )
      )
    } catch {
      return PicoMenuCommandResult(
        status: -1,
        standardOutput: "",
        standardError: error.localizedDescription
      )
    }
  }
}
