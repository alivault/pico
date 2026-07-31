import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  #if os(macOS)
    @Bindable var serverService: PicoServerServiceController

    init(
      model: AppModel,
      serverService: PicoServerServiceController = PicoServerServiceController()
    ) {
      self.model = model
      self.serverService = serverService
    }
  #endif
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
            MacServerSettingsTab(
              model: model,
              serverService: serverService
            )
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
    @Bindable var serverService: PicoServerServiceController

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

          Section("Background Service") {
            Toggle(
              "Start Pico at login",
              isOn: $serverService.startAtLogin
            )
            .disabled(!serverService.isAvailable)

            LabeledContent("Server agent", value: serverService.serverStatus)
            LabeledContent("Menu bar app", value: serverService.menuStatus)

            if !serverService.isAvailable {
              Text("Background services require a signed distribution build.")
                .foregroundStyle(.secondary)
            }

            if serverService.requiresApproval {
              Button(
                "Open Login Item Settings",
                action: serverService.openLoginItemSettings
              )
            }

            if let errorMessage = serverService.errorMessage {
              Text(errorMessage)
                .foregroundStyle(.red)
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
      .task {
        serverService.refreshStatus()
      }
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

#if os(macOS)
  #Preview {
    SettingsView(
      model: AppModel(),
      serverService: PicoServerServiceController()
    )
  }
#else
  #Preview {
    NavigationStack {
      SettingsView(model: AppModel())
    }
  }
#endif
