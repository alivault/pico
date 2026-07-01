import Foundation
import Testing
@testable import Pico

struct GitFeatureTests {
  @Test func parsesCommitGraphMetadata() {
    let separator = "\u{1f}"
    let line = "* abc1234\t0123456789abcdef0123456789abcdef01234567\(separator)deadbeef cafe0000\(separator)Ali\(separator)2 hours ago\(separator)2026-06-30T18:00:00+00:00\(separator)Add Git tab\(separator)2 files changed, 10 insertions(+), 3 deletions(-)"

    let entry = GitFormatting.parseCommitGraphLine(line)

    #expect(entry.graph == "* ")
    #expect(entry.hash == "abc1234")
    #expect(entry.fullHash == "0123456789abcdef0123456789abcdef01234567")
    #expect(entry.parents == ["deadbeef", "cafe0000"])
    #expect(entry.author == "Ali")
    #expect(entry.subject == "Add Git tab")
    #expect(GitFormatting.commitStatCount(entry.stats, kind: .insertions) == 10)
    #expect(GitFormatting.commitStatCount(entry.stats, kind: .deletions) == 3)
  }

  @Test func abbreviatesParentFoldersForCompactDiffHeaders() {
    #expect(
      GitFormatting.abbreviatedParentPath("apps/ios/Pico/Pico.xcodeproj/project.pbxproj") ==
        "a/i/P/P/project.pbxproj"
    )
    #expect(GitFormatting.abbreviatedParentPath("README.md") == "README.md")
  }

  @Test func buildsProjectFileTreeWithGitStatus() {
    let file = GitChangeFile(
      status: " M",
      path: "Sources/App.swift",
      previousPath: nil,
      linesAdded: 2,
      linesDeleted: 1,
      sizeBytes: nil
    )

    let roots = ProjectFileTreeBuilder.build(
      paths: ["Sources/App.swift", "README.md"],
      gitFiles: [file]
    )

    let sources = roots.first { $0.path == "Sources" }
    let app = sources?.children.first { $0.path == "Sources/App.swift" }
    #expect(sources?.isDirectory == true)
    #expect(app?.gitStatus == file)
    #expect(roots.contains { $0.path == "README.md" })
  }

  @Test func detectsCodeFileLanguages() {
    #expect(CodeFileLanguageDetector.detect(path: "Sources/App.swift")?.shikiLanguage == "swift")
    #expect(CodeFileLanguageDetector.detect(path: "src/App.tsx")?.shikiLanguage == "tsx")
    #expect(CodeFileLanguageDetector.detect(path: "Dockerfile.dev")?.shikiLanguage == "dockerfile")
    #expect(CodeFileLanguageDetector.detect(path: "README.md")?.shikiLanguage == "markdown")
    #expect(CodeFileLanguageDetector.detect(path: "notes.txt") == nil)
  }

  @Test func parsesShikiHighlightedHTMLIntoSegments() {
    let html = "<span class=\"line\"><span style=\"color:var(--sh-token-keyword)\">let</span> value = &lt;tag attr=&quot;x&quot;&gt;</span>"

    let segments = ShikiHighlightedHTMLParser.parse(html)

    #expect(ShikiHighlightedHTMLParser.plainText(from: html) == "let value = <tag attr=\"x\">")
    #expect(segments.first?.text == "let")
    #expect(segments.first?.cssVariable == "--sh-token-keyword")
    #expect(segments.last?.text == " value = <tag attr=\"x\">")
  }

  @Test func parsesShikiHighlightedHTMLByLine() {
    let html = "<span class=\"line\"><span style=\"color:var(--sh-token-keyword)\">let</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:var(--sh-token-function)\">print</span>()</span>"

    let lines = ShikiHighlightedHTMLParser.parseLines(html)

    #expect(lines.count == 3)
    #expect(lines[0].first?.text == "let")
    #expect(lines[0].first?.cssVariable == "--sh-token-keyword")
    #expect(lines[1].isEmpty)
    #expect(lines[2].first?.text == "print")
    #expect(lines[2].first?.cssVariable == "--sh-token-function")
  }
}
