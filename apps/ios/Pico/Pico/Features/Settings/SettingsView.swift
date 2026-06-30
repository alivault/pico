import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var apiKeyProvider: AuthProviderOption?
  @State private var presentedUiRequest: UiRequest?

  var body: some View {
    Form {
      Section("Server") {
        LabeledContent("URL", value: model.serverURLText)
        LabeledContent("Status", value: model.connectionStatus.label)

        Button("Disconnect", role: .destructive) {
          model.disconnect()
        }
      }

      if let manifest = model.manifest {
        Section("Manifest") {
          LabeledContent("Version", value: manifest.version)
          LabeledContent("Contract", value: String(manifest.apiContractVersion))
        }
      }

      ProviderAuthSectionView(
        model: model,
        apiKeyProvider: $apiKeyProvider
      )
    }
    .navigationTitle("Settings")
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button(action: dismiss.callAsFunction) {
          Image(systemName: "xmark")
        }
        .accessibilityLabel("Close")
      }
    }
    .task {
      await model.refreshAuthProviders()
    }
    .onChange(of: model.activeUiRequest) { _, request in
      presentedUiRequest = request
    }
    .sheet(item: $apiKeyProvider) { provider in
      ApiKeyAuthSheetView(model: model, provider: provider)
    }
    .sheet(item: $presentedUiRequest, onDismiss: model.clearActiveUiRequest) { request in
      AuthUiRequestSheetView(model: model, request: request)
    }
  }
}

#Preview {
  NavigationStack {
    SettingsView(model: AppModel())
  }
}
