import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var apiKeyProvider: AuthProviderOption?
  @State private var presentedUiRequest: UiRequest?

  var body: some View {
    SettingsFormContent(
      model: model,
      apiKeyProvider: $apiKeyProvider
    )
    .navigationTitle("Settings")
    .toolbar {
      ToolbarItem(placement: .picoLeading) {
        Button(action: dismiss.callAsFunction) {
          PicoIcon(systemName: "xmark")
        }
        .accessibilityLabel("Close")
      }
    }
    .task {
      async let auth: Void = model.refreshAuthProviders()
      async let performance: Void = model.refreshPiPerformanceSettings()
      _ = await (auth, performance)
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

private struct SettingsFormContent: View {
  @Bindable var model: AppModel
  @Binding var apiKeyProvider: AuthProviderOption?

  var body: some View {
    Form {
      Section("Server") {
        LabeledContent("Address", value: model.serverURLText)
        LabeledContent("Status", value: model.connectionStatus.label)

        Button("Disconnect", role: .destructive) {
          model.disconnect()
        }
      }

      if let manifest = model.manifest {
        Section("Manifest") {
          LabeledContent("Version", value: manifest.version)
          LabeledContent(
            "API contract",
            value: String(manifest.apiContractVersion)
          )
          LabeledContent(
            "Server protocol",
            value: String(manifest.serverProtocolVersion)
          )
        }
      }

      PiPerformanceSettingsSection(model: model)

      ProviderAuthSectionView(
        model: model,
        apiKeyProvider: $apiKeyProvider
      )
    }
  }
}

private struct PiPerformanceSettingsSection: View {
  @Bindable var model: AppModel

  var body: some View {
    if model.manifest?.capabilities.features.contains("pi-performance-settings") == true {
      Section("Pi Performance") {
        Picker(
          "Provider transport",
          selection: Binding(
            get: { model.piPerformanceSettings?.transport ?? .auto },
            set: { transport in
              Task {
                await model.setPiPerformanceSettings(
                  transport: transport,
                  cacheRetention: model.piPerformanceSettings?.cacheRetention ?? .standard
                )
              }
            }
          )
        ) {
          ForEach(PiTransport.allCases, id: \.self) { transport in
            Text(transport.label).tag(transport)
          }
        }

        Toggle(
          "Long prompt cache retention",
          isOn: Binding(
            get: { model.piPerformanceSettings?.cacheRetention == .long },
            set: { enabled in
              Task {
                await model.setPiPerformanceSettings(
                  transport: model.piPerformanceSettings?.transport ?? .auto,
                  cacheRetention: enabled ? .long : .standard
                )
              }
            }
          )
        )

        Text("Long retention can reuse provider prompt caches across longer pauses. Active sessions apply changes after restart.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .disabled(model.isUpdatingPiPerformance)
    }
  }
}

#Preview {
  NavigationStack {
    SettingsView(model: AppModel())
  }
}
