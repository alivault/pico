import SwiftUI

struct AuthProviderRowView: View {
  var provider: AuthProviderOption
  var actionTitle: String
  var isWorking: Bool
  var action: () -> Void

  var body: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 4) {
        Text(provider.name)
          .font(.body)
        Text(provider.statusLabel)
          .font(.footnote)
          .foregroundStyle(.secondary)
      }

      Spacer()

      if isWorking {
        ProgressView()
      } else {
        Button(actionTitle, action: action)
          .buttonStyle(.bordered)
      }
    }
    .padding(.vertical, 2)
  }
}

#Preview {
  List {
    AuthProviderRowView(
      provider: AuthProviderOption(
        id: "anthropic",
        name: "Anthropic",
        authType: .apiKey,
        configured: false
      ),
      actionTitle: "Set Key",
      isWorking: false,
      action: {}
    )
  }
}
