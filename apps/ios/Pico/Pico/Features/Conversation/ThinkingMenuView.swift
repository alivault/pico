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
      Label(Self.label(for: model.sessionState.thinkingLevel), picoSystemImage: "brain")
        .font(.caption)
    }
    .disabled(model.composerThinkingLevels.isEmpty)
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
