import SwiftUI

struct ConnectionHeroView: View {
  var status: ConnectionStatus

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: "sparkles.rectangle.stack")
        .font(.system(size: 56, weight: .semibold))
        .foregroundStyle(.tint)
        .accessibilityHidden(true)
      Text("Connect to Pico")
        .font(.largeTitle.bold())
      Text(status.label)
        .font(.headline)
        .foregroundStyle(.secondary)
    }
    .multilineTextAlignment(.center)
  }
}

#Preview {
  ConnectionHeroView(status: .disconnected)
}
