import SwiftUI

struct ConnectionView: View {
  @Bindable var model: AppModel

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        ConnectionHeroView(status: model.connectionStatus)
        ConnectionFormView(model: model)
        if !model.connectionDetail.isEmpty {
          Text(model.connectionDetail)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
      }
      .frame(maxWidth: 520)
      .padding(24)
    }
  }
}

#Preview {
  ConnectionView(model: AppModel())
}
