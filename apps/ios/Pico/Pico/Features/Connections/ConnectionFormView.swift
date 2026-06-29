import SwiftUI

struct ConnectionFormView: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(spacing: 12) {
      TextField("Pico server URL", text: $model.serverURLText)
        .textInputAutocapitalization(.never)
        .keyboardType(.URL)
        .textContentType(.URL)
        .autocorrectionDisabled()
        .padding(14)
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
        .submitLabel(.go)
        .onSubmit(connect)

      Button("Connect", action: connect)
        .buttonStyle(.borderedProminent)
        .disabled(model.connectionStatus == .connecting)
    }
  }

  private func connect() {
    Task {
      await model.connect()
    }
  }
}

#Preview {
  ConnectionFormView(model: AppModel())
}
