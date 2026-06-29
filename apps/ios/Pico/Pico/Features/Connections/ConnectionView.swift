import SwiftUI

struct ConnectionView: View {
  @Bindable var model: AppModel

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        ConnectionHeroView(status: model.connectionStatus)
        ConnectionFormView(model: model)
        Text(model.connectionDetail)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      .padding(24)
      .navigationTitle("Pico")
    }
  }
}

#Preview {
  ConnectionView(model: AppModel())
}
