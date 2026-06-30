import Foundation

struct ProjectFileTreeNode: Identifiable, Hashable, Sendable {
  var name: String
  var path: String
  var isDirectory: Bool
  var children: [ProjectFileTreeNode]
  var gitStatus: GitChangeFile?

  var id: String { isDirectory ? "dir:\(path)" : "file:\(path)" }

  var sortedChildren: [ProjectFileTreeNode] {
    children.sorted { left, right in
      if left.isDirectory != right.isDirectory {
        return left.isDirectory && !right.isDirectory
      }
      return left.name.localizedStandardCompare(right.name) == .orderedAscending
    }
  }
}

enum ProjectFileTreeBuilder {
  static func build(paths: [String], gitFiles: [GitChangeFile] = []) -> [ProjectFileTreeNode] {
    let root = MutableProjectFileTreeNode(name: "", path: "", isDirectory: true)
    let gitStatusByPath = Dictionary(uniqueKeysWithValues: gitFiles.map { ($0.path, $0) })

    for path in paths {
      let normalizedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      guard !normalizedPath.isEmpty else { continue }

      let parts = normalizedPath.split(separator: "/").map(String.init)
      var current = root
      for index in parts.indices {
        let name = parts[index]
        let childPath = parts[...index].joined(separator: "/")
        let isDirectory = index < parts.index(before: parts.endIndex)
        let child = current.children[childPath] ?? MutableProjectFileTreeNode(
          name: name,
          path: childPath,
          isDirectory: isDirectory
        )
        child.isDirectory = child.isDirectory || isDirectory
        if !isDirectory {
          child.gitStatus = gitStatusByPath[childPath]
        }
        current.children[childPath] = child
        current = child
      }
    }

    return root.children.values.map { $0.snapshot() }
      .sorted { left, right in
        if left.isDirectory != right.isDirectory {
          return left.isDirectory && !right.isDirectory
        }
        return left.name.localizedStandardCompare(right.name) == .orderedAscending
      }
  }
}

private final class MutableProjectFileTreeNode {
  var name: String
  var path: String
  var isDirectory: Bool
  var children: [String: MutableProjectFileTreeNode] = [:]
  var gitStatus: GitChangeFile?

  init(name: String, path: String, isDirectory: Bool) {
    self.name = name
    self.path = path
    self.isDirectory = isDirectory
  }

  func snapshot() -> ProjectFileTreeNode {
    ProjectFileTreeNode(
      name: name,
      path: path,
      isDirectory: isDirectory,
      children: children.values.map { $0.snapshot() },
      gitStatus: gitStatus
    )
  }
}
