import SwiftUI

struct ConnectionStatusBadge: View {
  var status: ConnectionStatus

  var body: some View {
    Label(status.label, picoSystemImage: iconName)
      .font(.caption)
      .labelStyle(.titleAndIcon)
      .foregroundStyle(color)
  }

  private var iconName: String {
    switch status {
    case .connected:
      "circle.fill"
    case .connecting, .reconnecting:
      "arrow.triangle.2.circlepath"
    case .disconnected:
      "circle"
    case .failed:
      "exclamationmark.triangle.fill"
    }
  }

  private var color: Color {
    switch status {
    case .connected:
      .green
    case .connecting, .reconnecting:
      .orange
    case .disconnected:
      .secondary
    case .failed:
      .red
    }
  }
}

#Preview {
  ConnectionStatusBadge(status: .connected)
}
