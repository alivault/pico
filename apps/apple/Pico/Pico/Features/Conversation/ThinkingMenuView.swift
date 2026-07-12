import SwiftUI

struct ThinkingMenuView: View {
  @Bindable var model: AppModel

  var body: some View {
    Menu {
      ForEach(model.composerThinkingLevels, id: \.self) { level in
        Button(action: { select(level) }) {
          if level == model.sessionState.thinkingLevel {
            Label(Self.label(for: level), picoSystemImage: "checkmark")
          } else {
            Text(Self.label(for: level))
          }
        }
      }
    } label: {
      HStack(spacing: 5) {
        Image(picoSystemName: "brain", pointSize: 18)
        Text(Self.label(for: model.sessionState.thinkingLevel))
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: 100)
      }
      .font(.caption)
    }
    .disabled(model.composerThinkingLevels.isEmpty)
    .fixedSize(horizontal: true, vertical: false)
    .help("Reasoning: \(Self.label(for: model.sessionState.thinkingLevel))")
  }

  private static func label(for level: String) -> String {
    switch level {
    case "off":
      "Off"
    case "minimal":
      "Minimal"
    case "low":
      "Low"
    case "medium":
      "Medium"
    case "high":
      "High"
    case "xhigh":
      "Extra High"
    case "pro":
      "Pro"
    default:
      level
    }
  }

  private func select(_ level: String) {
    Task {
      await model.setThinkingLevel(level)
    }
  }
}

#Preview {
  ThinkingMenuView(model: AppModel())
}
