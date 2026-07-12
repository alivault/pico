import Foundation

struct CodeFileLanguage: Hashable, Sendable {
  var shikiLanguage: String
  var displayName: String
}

enum CodeFileLanguageDetector {
  static func detect(path: String) -> CodeFileLanguage? {
    let rawName = path
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .split(separator: "/")
      .last
      .map(String.init) ?? path
    let name = rawName.lowercased()
    guard !name.isEmpty else { return nil }

    if let specialLanguage = specialLanguage(for: name) {
      return specialLanguage
    }

    guard let extensionName = fileExtension(for: name) else { return nil }
    return languagesByExtension[extensionName]
  }

  private static func fileExtension(for name: String) -> String? {
    let pieces = name.split(separator: ".", omittingEmptySubsequences: false)
    guard pieces.count > 1, let extensionName = pieces.last else {
      return nil
    }

    let value = String(extensionName)
    return value.isEmpty ? nil : value
  }

  private static func specialLanguage(for name: String) -> CodeFileLanguage? {
    if name == ".env" || name.hasPrefix(".env.") {
      return language("dotenv", "Dotenv")
    }

    if name == "dockerfile" ||
      name.hasPrefix("dockerfile.") ||
      name == "containerfile" ||
      name.hasPrefix("containerfile.") {
      return language("dockerfile", "Dockerfile")
    }

    if name == "makefile" ||
      name.hasPrefix("makefile.") ||
      name == "gnumakefile" {
      return language("make", "Makefile")
    }

    if name == "cmakelists.txt" {
      return language("cmake", "CMake")
    }

    return languagesByName[name]
  }

  private static func language(
    _ shikiLanguage: String,
    _ displayName: String
  ) -> CodeFileLanguage {
    CodeFileLanguage(shikiLanguage: shikiLanguage, displayName: displayName)
  }

  private static let languagesByName: [String: CodeFileLanguage] = [
    ".babelrc": language("jsonc", "JSONC"),
    ".eslintrc": language("jsonc", "JSONC"),
    ".gitignore": language("gitignore", "Git Ignore"),
    ".npmrc": language("ini", "INI"),
    ".prettierrc": language("jsonc", "JSONC"),
    ".stylelintrc": language("jsonc", "JSONC"),
    "brewfile": language("ruby", "Ruby"),
    "cartfile": language("ruby", "Ruby"),
    "gemfile": language("ruby", "Ruby"),
    "justfile": language("just", "Just"),
    "podfile": language("ruby", "Ruby"),
    "rakefile": language("ruby", "Ruby"),
  ]

  private static let languagesByExtension: [String: CodeFileLanguage] = [
    "astro": language("astro", "Astro"),
    "bash": language("bash", "Bash"),
    "bat": language("bat", "Batch"),
    "c": language("c", "C"),
    "cc": language("cpp", "C++"),
    "cjs": language("javascript", "JavaScript"),
    "clj": language("clojure", "Clojure"),
    "cljs": language("clojure", "Clojure"),
    "cmake": language("cmake", "CMake"),
    "cmd": language("bat", "Batch"),
    "cpp": language("cpp", "C++"),
    "cs": language("csharp", "C#"),
    "css": language("css", "CSS"),
    "cts": language("typescript", "TypeScript"),
    "cxx": language("cpp", "C++"),
    "dart": language("dart", "Dart"),
    "diff": language("diff", "Diff"),
    "dockerfile": language("dockerfile", "Dockerfile"),
    "ejs": language("ejs", "EJS"),
    "erl": language("erlang", "Erlang"),
    "ex": language("elixir", "Elixir"),
    "exs": language("elixir", "Elixir"),
    "fish": language("fish", "Fish"),
    "fs": language("fsharp", "F#"),
    "fsx": language("fsharp", "F#"),
    "go": language("go", "Go"),
    "graphql": language("graphql", "GraphQL"),
    "gql": language("graphql", "GraphQL"),
    "groovy": language("groovy", "Groovy"),
    "h": language("c", "C"),
    "hbs": language("handlebars", "Handlebars"),
    "hpp": language("cpp", "C++"),
    "hrl": language("erlang", "Erlang"),
    "hs": language("haskell", "Haskell"),
    "htm": language("html", "HTML"),
    "html": language("html", "HTML"),
    "java": language("java", "Java"),
    "js": language("javascript", "JavaScript"),
    "json": language("json", "JSON"),
    "json5": language("json5", "JSON5"),
    "jsonc": language("jsonc", "JSONC"),
    "jsx": language("jsx", "JSX"),
    "kt": language("kotlin", "Kotlin"),
    "kts": language("kotlin", "Kotlin"),
    "less": language("less", "Less"),
    "lua": language("lua", "Lua"),
    "m": language("objective-c", "Objective-C"),
    "markdown": language("markdown", "Markdown"),
    "md": language("markdown", "Markdown"),
    "mdx": language("mdx", "MDX"),
    "mjs": language("javascript", "JavaScript"),
    "mm": language("objective-c", "Objective-C++"),
    "mts": language("typescript", "TypeScript"),
    "php": language("php", "PHP"),
    "pl": language("perl", "Perl"),
    "pm": language("perl", "Perl"),
    "prisma": language("prisma", "Prisma"),
    "ps1": language("powershell", "PowerShell"),
    "py": language("python", "Python"),
    "r": language("r", "R"),
    "rb": language("ruby", "Ruby"),
    "rs": language("rust", "Rust"),
    "sass": language("sass", "Sass"),
    "scala": language("scala", "Scala"),
    "scss": language("scss", "SCSS"),
    "sh": language("bash", "Shell"),
    "sql": language("sql", "SQL"),
    "svelte": language("svelte", "Svelte"),
    "svg": language("xml", "SVG"),
    "swift": language("swift", "Swift"),
    "toml": language("toml", "TOML"),
    "ts": language("typescript", "TypeScript"),
    "tsx": language("tsx", "TSX"),
    "vue": language("vue", "Vue"),
    "xml": language("xml", "XML"),
    "yaml": language("yaml", "YAML"),
    "yml": language("yaml", "YAML"),
    "zig": language("zig", "Zig"),
    "zsh": language("zsh", "Zsh"),
  ]
}
