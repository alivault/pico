import SwiftUI

struct GitCommitGraphColumnView: View {
  var row: GitCommitGraphRowLayout
  var maxLaneCount: Int
  var isUnpushed: Bool

  var body: some View {
    GeometryReader { _ in
      Canvas(opaque: false, rendersAsynchronously: true) { context, size in
        drawSegments(
          row.incomingSegments,
          direction: .incoming,
          in: size,
          context: &context
        )
        drawSegments(
          row.outgoingSegments,
          direction: .outgoing,
          in: size,
          context: &context
        )
        drawCommitDot(in: size, context: &context)
      }
    }
    .frame(width: Self.width(for: maxLaneCount))
    .accessibilityHidden(true)
  }

  static func width(for laneCount: Int) -> CGFloat {
    max(
      GitCommitGraphMetrics.minimumWidth,
      CGFloat(max(1, laneCount)) * GitCommitGraphMetrics.laneWidth +
        GitCommitGraphMetrics.offsetX +
        GitCommitGraphMetrics.trailingPadding
    )
  }

  private func drawSegments(
    _ segments: [GitCommitGraphSegment],
    direction: GitCommitGraphSegmentDirection,
    in size: CGSize,
    context: inout GraphicsContext
  ) {
    let strokeStyle = StrokeStyle(
      lineWidth: GitCommitGraphMetrics.lineWidth,
      lineCap: .round,
      lineJoin: .round
    )

    for segment in segments {
      context.stroke(
        path(for: segment, direction: direction, in: size),
        with: .color(color(for: segment.colorIndex)),
        style: strokeStyle
      )
    }
  }

  private func drawCommitDot(in size: CGSize, context: inout GraphicsContext) {
    guard row.commitLane >= 0 else { return }

    let center = CGPoint(
      x: laneX(row.commitLane),
      y: size.height / 2
    )
    let radius = GitCommitGraphMetrics.dotRadius
    let dotRect = CGRect(
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2
    )
    context.fill(
      Path(ellipseIn: dotRect),
      with: .color(color(for: row.colorIndex, active: isUnpushed))
    )
  }

  private func path(
    for segment: GitCommitGraphSegment,
    direction: GitCommitGraphSegmentDirection,
    in size: CGSize
  ) -> Path {
    let x1 = laneX(segment.p1.x)
    let x2 = laneX(segment.p2.x)
    let boundaryX = (x1 + x2) / 2
    let centerY = size.height / 2
    let curveDistance = min(18, size.height * 0.38)

    return Path { path in
      switch direction {
      case .incoming:
        path.move(to: CGPoint(x: boundaryX, y: 0))
        if abs(boundaryX - x2) < 0.5 {
          path.addLine(to: CGPoint(x: x2, y: centerY))
        } else {
          path.addCurve(
            to: CGPoint(x: x2, y: centerY),
            control1: CGPoint(x: boundaryX, y: curveDistance),
            control2: CGPoint(x: x2, y: centerY - curveDistance)
          )
        }
      case .outgoing:
        path.move(to: CGPoint(x: x1, y: centerY))
        if abs(x1 - boundaryX) < 0.5 {
          path.addLine(to: CGPoint(x: boundaryX, y: size.height))
        } else {
          path.addCurve(
            to: CGPoint(x: boundaryX, y: size.height),
            control1: CGPoint(x: x1, y: centerY + curveDistance),
            control2: CGPoint(x: boundaryX, y: size.height - curveDistance)
          )
        }
      }
    }
  }

  private func laneX(_ lane: Int) -> CGFloat {
    CGFloat(lane) * GitCommitGraphMetrics.laneWidth +
      GitCommitGraphMetrics.offsetX
  }

  private func color(for index: Int, active: Bool = false) -> Color {
    if active {
      return Color(uiColor: .systemOrange)
    }
    return GitCommitGraphMetrics.colors[index % GitCommitGraphMetrics.colors.count]
  }
}

private enum GitCommitGraphSegmentDirection {
  case incoming
  case outgoing
}

private enum GitCommitGraphMetrics {
  static let laneWidth: CGFloat = 14
  static let offsetX: CGFloat = 12
  static let trailingPadding: CGFloat = 6
  static let minimumWidth: CGFloat = 28
  static let lineWidth: CGFloat = 2
  static let dotRadius: CGFloat = 4

  static let colors: [Color] = [
    Color(red: 0.055, green: 0.647, blue: 0.914),
    Color(red: 0.859, green: 0.153, blue: 0.467),
    Color(red: 0.133, green: 0.773, blue: 0.369),
    Color(red: 0.961, green: 0.62, blue: 0.043),
    Color(red: 0.545, green: 0.361, blue: 0.965),
    Color(red: 0.078, green: 0.722, blue: 0.651),
  ]
}
