import SwiftUI

struct ConnectionHeroView: View {
  var status: ConnectionStatus

  var body: some View {
    VStack(spacing: 12) {
      Text("Pico")
        .font(.largeTitle.bold())
    }
    .multilineTextAlignment(.center)
  }
}

#Preview {
  ConnectionHeroView(status: .disconnected)
}
