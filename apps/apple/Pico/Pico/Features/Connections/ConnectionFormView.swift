import SwiftUI

struct ConnectionFormView: View {
  @Bindable var model: AppModel

  var body: some View {
    VStack(spacing: 12) {
      TextField("Pico server host", text: $model.serverURLText)
        .picoTextInputAutocapitalization(.never)
        .picoURLInputTraits()
        .autocorrectionDisabled()
        .padding(14)
        .background(.regularMaterial, in: .rect(cornerRadius: 14))
        .onSubmit(connect)

      Button(action: connect) {
        Text("Connect")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(model.connectionStatus == .connecting)

      #if os(macOS) && PICO_DOGFOOD
        HStack(spacing: 8) {
          Button("Stable · 3141") {
            connect(to: "http://localhost:3141")
          }
          Button("Development · 4142") {
            connect(to: "http://localhost:4142")
          }
        }
        .buttonStyle(.bordered)
        .disabled(model.connectionStatus == .connecting)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Pico dogfood server profiles")
      #endif
    }
  }

  private func connect() {
    Task {
      await model.connect()
    }
  }

  #if os(macOS) && PICO_DOGFOOD
    private func connect(to serverURL: String) {
      model.serverURLText = serverURL
      connect()
    }
  #endif
}

#Preview {
  ConnectionFormView(model: AppModel())
}
