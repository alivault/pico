import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var apiKeyProvider: AuthProviderOption?
  @State private var presentedUiRequest: UiRequest?
  #if os(macOS)
    @State private var selectedMacSection: MacSettingsSection = .server
  #endif

  var body: some View {
    Group {
      #if os(macOS)
        NavigationSplitView {
          List(MacSettingsSection.allCases, selection: $selectedMacSection) {
            section in
            Label(section.title, systemImage: section.systemImage)
              .tag(section)
          }
          .listStyle(.sidebar)
          .toolbar(removing: .sidebarToggle)
          .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 240)
        } detail: {
          switch selectedMacSection {
          case .server:
            MacServerSettingsTab(model: model)
          case .providers:
            MacProviderSettingsTab(
              model: model,
              apiKeyProvider: $apiKeyProvider
            )
          }
        }
        .navigationSplitViewStyle(.balanced)
      #else
        SettingsFormContent(
          model: model,
          apiKeyProvider: $apiKeyProvider
        )
      #endif
    }
    .navigationTitle("Settings")
    .toolbar {
      #if os(iOS)
        ToolbarItem(placement: .picoLeading) {
          Button(action: dismiss.callAsFunction) {
            PicoIcon(systemName: "xmark")
          }
          .accessibilityLabel("Close")
        }
      #endif
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

#if os(macOS)
  private enum MacSettingsSection: String, CaseIterable, Hashable, Identifiable {
    case server
    case providers

    var id: String { rawValue }

    var title: String {
      switch self {
      case .server: "Server"
      case .providers: "Providers"
      }
    }

    var systemImage: String {
      switch self {
      case .server: "server.rack"
      case .providers: "key"
      }
    }
  }

  private struct MacServerSettingsTab: View {
    @Bindable var model: AppModel

    var body: some View {
      ScrollView {
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
              LabeledContent(
                "Contract",
                value: String(manifest.apiContractVersion)
              )
            }
          }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 720)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .top)
      }
      .scrollContentBackground(.visible)
    }
  }

  private struct MacProviderSettingsTab: View {
    @Bindable var model: AppModel
    @Binding var apiKeyProvider: AuthProviderOption?

    var body: some View {
      ScrollView {
        Form {
          ProviderAuthSectionView(
            model: model,
            apiKeyProvider: $apiKeyProvider
          )
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 720)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .top)
      }
      .scrollContentBackground(.visible)
    }
  }
#endif

private struct SettingsFormContent: View {
  @Bindable var model: AppModel
  @Binding var apiKeyProvider: AuthProviderOption?

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
  }
}

#Preview {
  NavigationStack {
    SettingsView(model: AppModel())
  }
}
