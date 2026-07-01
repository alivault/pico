import SwiftUI

struct ConversationHeaderView: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(model.sessionState.displayTitle)
            .font(.headline)
            .lineLimit(1)
          if let cwd = model.sessionState.cwd, !cwd.isEmpty {
            Text(cwd)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }

        Spacer()

        if model.sessionState.streaming {
          Label("Working", systemImage: "sparkles")
            .font(.caption)
            .foregroundStyle(.green)
        }
      }

      HStack(spacing: 12) {
        ModelMenuView(model: model)
        ThinkingMenuView(model: model)
        if model.hasRealCurrentSession,
           let percent = model.sessionState.contextUsage?.displayPercent {
          Label(percent, systemImage: "gauge.with.dots.needle.67percent")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(.horizontal)
    .padding(.vertical, 10)
  }
}

#Preview {
  ConversationHeaderView(model: AppModel())
}
