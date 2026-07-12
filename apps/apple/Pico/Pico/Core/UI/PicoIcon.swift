import LucideSwift
import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

enum PicoIconName: Sendable {
  case arrowDown
  case arrowLeftRight
  case arrowUp
  case arrowUpCircle
  case braces
  case branch
  case brain
  case camera
  case check
  case checkCircle
  case chevronDown
  case chevronLeft
  case chevronRight
  case circle
  case circlePlus
  case circleMinus
  case circleQuestion
  case circleX
  case clock
  case code
  case compass
  case copy
  case cpu
  case ellipsis
  case eye
  case eyeOff
  case file
  case fileCode
  case fileImage
  case fileSearch
  case fileText
  case folder
  case folderPlus
  case gauge
  case history
  case hourglass
  case image
  case images
  case info
  case message
  case messageText
  case panelLeft
  case pencil
  case plus
  case refresh
  case search
  case settings
  case sparkles
  case stop
  case summary
  case trash
  case triangleAlert
  case wandSparkles
  case wrench
  case x

  init(systemName: String) {
    switch systemName {
    case "arrow.branch", "arrow.triangle.branch":
      self = .branch
    case "arrow.clockwise", "arrow.triangle.2.circlepath":
      self = .refresh
    case "arrow.down":
      self = .arrowDown
    case "arrow.left.arrow.right":
      self = .arrowLeftRight
    case "arrow.up":
      self = .arrowUp
    case "arrow.up.circle":
      self = .arrowUpCircle
    case "brain":
      self = .brain
    case "camera":
      self = .camera
    case "checkmark":
      self = .check
    case "checkmark.circle", "checkmark.circle.fill":
      self = .checkCircle
    case "chevron.down":
      self = .chevronDown
    case "chevron.left":
      self = .chevronLeft
    case "chevron.right":
      self = .chevronRight
    case "chevron.left.forwardslash.chevron.right":
      self = .code
    case "circle", "circle.fill":
      self = .circle
    case "clock":
      self = .clock
    case "clock.arrow.circlepath":
      self = .history
    case "cpu":
      self = .cpu
    case "curlybraces":
      self = .braces
    case "doc":
      self = .file
    case "doc.on.doc":
      self = .copy
    case "doc.richtext":
      self = .fileText
    case "doc.text":
      self = .fileText
    case "doc.text.magnifyingglass":
      self = .fileSearch
    case "ellipsis":
      self = .ellipsis
    case "exclamationmark.triangle", "exclamationmark.triangle.fill":
      self = .triangleAlert
    case "eye":
      self = .eye
    case "eye.slash":
      self = .eyeOff
    case "folder":
      self = .folder
    case "folder.badge.plus":
      self = .folderPlus
    case "gauge.with.dots.needle.67percent":
      self = .gauge
    case "gearshape":
      self = .settings
    case "hourglass":
      self = .hourglass
    case "info.circle", "info.circle.fill":
      self = .info
    case "magnifyingglass":
      self = .search
    case "message":
      self = .message
    case "minus.circle":
      self = .circleMinus
    case "pencil":
      self = .pencil
    case "photo":
      self = .image
    case "photo.on.rectangle":
      self = .images
    case "plus":
      self = .plus
    case "plus.circle":
      self = .circlePlus
    case "safari":
      self = .compass
    case "sidebar.left":
      self = .panelLeft
    case "sparkles":
      self = .sparkles
    case "square.and.pencil":
      self = .pencil
    case "stop", "stop.fill":
      self = .stop
    case "summary":
      self = .summary
    case "swift":
      self = .fileCode
    case "text.bubble":
      self = .messageText
    case "trash":
      self = .trash
    case "wand.and.sparkles":
      self = .wandSparkles
    case "wrench", "wrench.and.screwdriver":
      self = .wrench
    case "xmark":
      self = .x
    case "xmark.circle.fill":
      self = .circleX
    default:
      self = .circleQuestion
    }
  }

  var lucideName: LucideIconName {
    switch self {
    case .arrowDown:
      .arrowDown
    case .arrowLeftRight:
      .arrowLeftRight
    case .arrowUp:
      .arrowUp
    case .arrowUpCircle:
      .circleArrowUp
    case .braces:
      .braces
    case .branch:
      .gitBranch
    case .brain:
      .brain
    case .camera:
      .camera
    case .check:
      .check
    case .checkCircle:
      .circleCheck
    case .chevronDown:
      .chevronDown
    case .chevronLeft:
      .chevronLeft
    case .chevronRight:
      .chevronRight
    case .circle:
      .circle
    case .circlePlus:
      .circlePlus
    case .circleMinus:
      .circleMinus
    case .circleQuestion:
      .circleQuestionMark
    case .circleX:
      .circleX
    case .clock:
      .clock
    case .code:
      .codeXml
    case .compass:
      .compass
    case .copy:
      .copy
    case .cpu:
      .cpu
    case .ellipsis:
      .ellipsis
    case .eye:
      .eye
    case .eyeOff:
      .eyeOff
    case .file:
      .file
    case .fileCode:
      .fileCode
    case .fileImage:
      .fileImage
    case .fileSearch:
      .fileSearch
    case .fileText:
      .fileText
    case .folder:
      .folder
    case .folderPlus:
      .folderPlus
    case .gauge:
      .gauge
    case .history:
      .history
    case .hourglass:
      .hourglass
    case .image:
      .image
    case .images:
      .images
    case .info:
      .info
    case .message:
      .messageSquare
    case .messageText:
      .messageSquareText
    case .panelLeft:
      .panelLeft
    case .pencil:
      .squarePen
    case .plus:
      .plus
    case .refresh:
      .refreshCw
    case .search:
      .search
    case .settings:
      .settings
    case .sparkles:
      .sparkles
    case .stop:
      .squareStop
    case .summary:
      .summary
    case .trash:
      .trash2
    case .triangleAlert:
      .triangleAlert
    case .wandSparkles:
      .wandSparkles
    case .wrench:
      .wrench
    case .x:
      .x
    }
  }

  var lucideStyle: LucideIconStyle {
    .stroked
  }
}

struct PicoIcon: View {
  var icon: PicoIconName
  var size: CGFloat = 20
  var strokeWidth: CGFloat = 2

  nonisolated init(
    _ icon: PicoIconName,
    size: CGFloat = 20,
    strokeWidth: CGFloat = 2
  ) {
    self.icon = icon
    self.size = size
    self.strokeWidth = strokeWidth
  }

  nonisolated init(
    systemName: String,
    size: CGFloat = 20,
    strokeWidth: CGFloat = 2
  ) {
    self.init(
      PicoIconName(systemName: systemName),
      size: size,
      strokeWidth: strokeWidth
    )
  }

  var body: some View {
    LucideIcon(
      icon.lucideName,
      style: icon.lucideStyle,
      size: size,
      strokeWidth: strokeWidth,
      absoluteStrokeWidth: true
    )
    .accessibilityHidden(true)
  }
}

extension PicoIcon {
  @MainActor
  static func uiImage(
    systemName: String,
    pointSize: CGFloat = 20,
    strokeWidth: CGFloat = 2,
    color: UIColor = .white
  ) -> UIImage? {
    let renderer = ImageRenderer(
      content: PicoIcon(
        systemName: systemName,
        size: pointSize,
        strokeWidth: strokeWidth
      )
      .foregroundStyle(Color(uiColor: color))
      .frame(width: pointSize, height: pointSize)
    )
    renderer.scale = 3
    #if os(iOS)
      return renderer.uiImage
    #else
      return renderer.nsImage
    #endif
  }
}

extension Image {
  init(picoSystemName systemName: String, pointSize: CGFloat = 20) {
    let icon = PicoIconName(systemName: systemName)
    self.init(
      lucide: icon.lucideName,
      size: CGSize(width: pointSize, height: pointSize),
      strokeWidth: 2,
      style: icon.lucideStyle
    )
  }
}

extension Label where Title == Text, Icon == Image {
  init(
    _ titleKey: LocalizedStringKey,
    picoSystemImage systemName: String,
    size: CGFloat = 20
  ) {
    self.init(
      title: { Text(titleKey) },
      icon: { Image(picoSystemName: systemName, pointSize: size) }
    )
  }

  init<S: StringProtocol>(
    _ title: S,
    picoSystemImage systemName: String,
    size: CGFloat = 20
  ) {
    self.init(
      title: { Text(title) },
      icon: { Image(picoSystemName: systemName, pointSize: size) }
    )
  }
}

extension Button where Label == SwiftUI.Label<Text, Image> {
  init(
    _ titleKey: LocalizedStringKey,
    picoSystemImage systemName: String,
    role: ButtonRole? = nil,
    action: @escaping () -> Void
  ) {
    if let role {
      self.init(role: role, action: action) {
        SwiftUI.Label(titleKey, picoSystemImage: systemName)
      }
    } else {
      self.init(action: action) {
        SwiftUI.Label(titleKey, picoSystemImage: systemName)
      }
    }
  }

  init<S: StringProtocol>(
    _ title: S,
    picoSystemImage systemName: String,
    role: ButtonRole? = nil,
    action: @escaping () -> Void
  ) {
    if let role {
      self.init(role: role, action: action) {
        SwiftUI.Label(title, picoSystemImage: systemName)
      }
    } else {
      self.init(action: action) {
        SwiftUI.Label(title, picoSystemImage: systemName)
      }
    }
  }
}

extension ContentUnavailableView
where Label == SwiftUI.Label<Text, Image>, Description == Text, Actions == EmptyView {
  init(
    _ titleKey: LocalizedStringKey,
    picoSystemImage systemName: String,
    description: Text
  ) {
    self.init {
      SwiftUI.Label(titleKey, picoSystemImage: systemName, size: 42)
    } description: {
      description
    }
  }

  init<S: StringProtocol>(
    _ title: S,
    picoSystemImage systemName: String,
    description: Text
  ) {
    self.init {
      SwiftUI.Label(title, picoSystemImage: systemName, size: 42)
    } description: {
      description
    }
  }
}

extension ContentUnavailableView
where Label == SwiftUI.Label<Text, Image>, Description == EmptyView, Actions == EmptyView {
  init(
    _ titleKey: LocalizedStringKey,
    picoSystemImage systemName: String
  ) {
    self.init {
      SwiftUI.Label(titleKey, picoSystemImage: systemName, size: 42)
    }
  }

  init<S: StringProtocol>(
    _ title: S,
    picoSystemImage systemName: String
  ) {
    self.init {
      SwiftUI.Label(title, picoSystemImage: systemName, size: 42)
    }
  }
}

struct PicoSearchUnavailableView: View {
  var text: String

  var body: some View {
    ContentUnavailableView(
      "No Results",
      picoSystemImage: "magnifyingglass",
      description: searchDescription
    )
  }

  private var searchDescription: Text {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedText.isEmpty else {
      return Text("No matching results were found.")
    }
    return Text("No results for \"\(trimmedText)\".")
  }
}
