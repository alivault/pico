import Foundation

struct GitCommitGraphPoint: Hashable, Sendable {
  var x: Int
  var y: Int
}

struct GitCommitGraphSegment: Hashable, Sendable {
  var colorIndex: Int
  var p1: GitCommitGraphPoint
  var p2: GitCommitGraphPoint
}

struct GitCommitGraphRowLayout: Hashable, Sendable {
  var colorIndex: Int
  var commitLane: Int
  var fullHash: String
  var incomingSegments: [GitCommitGraphSegment]
  var outgoingSegments: [GitCommitGraphSegment]
}

struct GitCommitGraphLayout: Hashable, Sendable {
  var rows: [GitCommitGraphRowLayout]
  var maxLaneCount: Int

  static func build(commits: [GitCommitGraphEntry]) -> GitCommitGraphLayout {
    guard !commits.isEmpty else {
      return GitCommitGraphLayout(rows: [], maxLaneCount: 1)
    }

    let commitLookup = Dictionary(
      uniqueKeysWithValues: commits.enumerated().compactMap { index, commit in
        commit.fullHash.isEmpty ? nil : (commit.fullHash, index)
      }
    )
    let nullVertex = GitCommitGraphVertex(id: GitCommitGraphConstants.nullVertexID)
    let vertices = commits.indices.map { GitCommitGraphVertex(id: $0) }
    var branches: [GitCommitGraphBranch] = []
    var availableColors: [Int] = []

    for (index, commit) in commits.enumerated() where !commit.fullHash.isEmpty {
      let vertex = vertices[index]
      for parentHash in commit.parents {
        if let parentIndex = commitLookup[parentHash] {
          vertex.addParent(vertices[parentIndex])
        } else {
          vertex.addParent(nullVertex)
        }
      }
    }

    func availableColor(startingAt startIndex: Int) -> Int {
      for index in availableColors.indices where startIndex > availableColors[index] {
        return index
      }

      availableColors.append(0)
      return availableColors.count - 1
    }

    func determinePath(startingAt startIndex: Int) {
      var index = startIndex
      var vertex = vertices[index]
      var parentVertex = vertex.nextParent()
      var lastPoint = vertex.isNotOnBranch ? vertex.nextPoint : vertex.point

      if let parentVertex,
         parentVertex.id != GitCommitGraphConstants.nullVertexID,
         vertex.isMerge,
         !vertex.isNotOnBranch,
         !parentVertex.isNotOnBranch,
         let parentBranch = parentVertex.branch {
        var processedParent = false

        index = startIndex + 1
        while index < vertices.count {
          let currentVertex = vertices[index]
          let pointToParent = currentVertex.pointConnecting(
            to: parentVertex,
            on: parentBranch
          )
          let currentPoint = pointToParent ?? currentVertex.nextPoint
          parentBranch.addLine(p1: lastPoint, p2: currentPoint)
          currentVertex.registerUnavailablePoint(
            x: currentPoint.x,
            connectsTo: parentVertex,
            on: parentBranch
          )
          lastPoint = currentPoint

          if pointToParent != nil {
            vertex.registerParentProcessed()
            processedParent = true
            break
          }

          index += 1
        }

        if !processedParent {
          vertex.registerParentProcessed()
        }
        return
      }

      let branch = GitCommitGraphBranch(colorIndex: availableColor(startingAt: startIndex))
      vertex.addToBranch(branch, x: lastPoint.x)
      vertex.registerUnavailablePoint(x: lastPoint.x, connectsTo: vertex, on: branch)

      index = startIndex + 1
      while index < vertices.count {
        let currentVertex = vertices[index]
        let currentPoint: GitCommitGraphPoint
        if parentVertex === currentVertex, !currentVertex.isNotOnBranch {
          currentPoint = currentVertex.point
        } else {
          currentPoint = currentVertex.nextPoint
        }

        branch.addLine(p1: lastPoint, p2: currentPoint)
        currentVertex.registerUnavailablePoint(
          x: currentPoint.x,
          connectsTo: parentVertex,
          on: branch
        )
        lastPoint = currentPoint

        if parentVertex === currentVertex {
          vertex.registerParentProcessed()
          let parentVertexOnBranch = !currentVertex.isNotOnBranch
          currentVertex.addToBranch(branch, x: currentPoint.x)
          vertex = currentVertex
          parentVertex = vertex.nextParent()
          if parentVertex == nil || parentVertexOnBranch {
            break
          }
        }

        index += 1
      }

      if index == vertices.count,
         let parentVertex,
         parentVertex.id == GitCommitGraphConstants.nullVertexID {
        vertex.registerParentProcessed()
      }

      branches.append(branch)
      availableColors[branch.colorIndex] = index
    }

    var index = 0
    while index < vertices.count {
      let vertex = vertices[index]
      let commit = commits[index]
      if !commit.fullHash.isEmpty,
         vertex.nextParent() != nil || vertex.isNotOnBranch {
        determinePath(startingAt: index)
      } else {
        index += 1
      }
    }

    let segments = branches.flatMap { branch in
      branch.lines.map { line in
        GitCommitGraphSegment(
          colorIndex: branch.colorIndex,
          p1: line.p1,
          p2: line.p2
        )
      }
    }
    var incomingSegments = Array(
      repeating: [GitCommitGraphSegment](),
      count: commits.count
    )
    var outgoingSegments = Array(
      repeating: [GitCommitGraphSegment](),
      count: commits.count
    )

    for segment in segments {
      if incomingSegments.indices.contains(segment.p2.y) {
        incomingSegments[segment.p2.y].append(segment)
      }
      if outgoingSegments.indices.contains(segment.p1.y) {
        outgoingSegments[segment.p1.y].append(segment)
      }
    }

    let rows = commits.enumerated().map { index, commit in
      let branch = vertices[index].branch
      return GitCommitGraphRowLayout(
        colorIndex: branch?.colorIndex ?? 0,
        commitLane: commit.fullHash.isEmpty || branch == nil ? -1 : vertices[index].point.x,
        fullHash: commit.fullHash,
        incomingSegments: incomingSegments[index],
        outgoingSegments: outgoingSegments[index]
      )
    }
    let maxLaneCount = max(1, vertices.map { $0.nextPoint.x }.max() ?? 1)

    return GitCommitGraphLayout(rows: rows, maxLaneCount: maxLaneCount)
  }
}

private enum GitCommitGraphConstants {
  static let nullVertexID = -1
}

private struct GitCommitGraphLine: Hashable {
  var p1: GitCommitGraphPoint
  var p2: GitCommitGraphPoint
}

private struct GitCommitGraphConnection {
  var connectsTo: GitCommitGraphVertex?
  var onBranch: GitCommitGraphBranch
}

private final class GitCommitGraphBranch {
  let colorIndex: Int
  private(set) var lines: [GitCommitGraphLine] = []

  init(colorIndex: Int) {
    self.colorIndex = colorIndex
  }

  func addLine(p1: GitCommitGraphPoint, p2: GitCommitGraphPoint) {
    lines.append(GitCommitGraphLine(p1: p1, p2: p2))
  }
}

private final class GitCommitGraphVertex {
  let id: Int
  private var connections: [GitCommitGraphConnection?] = []
  private var nextParentIndex = 0
  private var nextX = 0
  private var onBranch: GitCommitGraphBranch?
  private var parents: [GitCommitGraphVertex] = []
  private var x = 0

  init(id: Int) {
    self.id = id
  }

  var branch: GitCommitGraphBranch? {
    onBranch
  }

  var isMerge: Bool {
    parents.count > 1
  }

  var isNotOnBranch: Bool {
    onBranch == nil
  }

  var point: GitCommitGraphPoint {
    GitCommitGraphPoint(x: x, y: id)
  }

  var nextPoint: GitCommitGraphPoint {
    GitCommitGraphPoint(x: nextX, y: id)
  }

  func addParent(_ vertex: GitCommitGraphVertex) {
    parents.append(vertex)
  }

  func nextParent() -> GitCommitGraphVertex? {
    parents.indices.contains(nextParentIndex) ? parents[nextParentIndex] : nil
  }

  func registerParentProcessed() {
    nextParentIndex += 1
  }

  func addToBranch(_ branch: GitCommitGraphBranch, x: Int) {
    guard onBranch == nil else { return }

    onBranch = branch
    self.x = x
  }

  func pointConnecting(
    to vertex: GitCommitGraphVertex?,
    on branch: GitCommitGraphBranch
  ) -> GitCommitGraphPoint? {
    for index in connections.indices {
      guard let connection = connections[index],
            connection.onBranch === branch,
            Self.sameVertex(connection.connectsTo, vertex) else {
        continue
      }

      return GitCommitGraphPoint(x: index, y: id)
    }

    return nil
  }

  func registerUnavailablePoint(
    x: Int,
    connectsTo vertex: GitCommitGraphVertex?,
    on branch: GitCommitGraphBranch
  ) {
    guard x == nextX else { return }

    nextX = x + 1
    while connections.count <= x {
      connections.append(nil)
    }
    connections[x] = GitCommitGraphConnection(connectsTo: vertex, onBranch: branch)
  }

  private static func sameVertex(
    _ lhs: GitCommitGraphVertex?,
    _ rhs: GitCommitGraphVertex?
  ) -> Bool {
    switch (lhs, rhs) {
    case (nil, nil):
      true
    case let (lhs?, rhs?):
      lhs === rhs
    case (nil, _?), (_?, nil):
      false
    }
  }
}
