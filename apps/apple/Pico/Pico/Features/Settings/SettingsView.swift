import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  #if os(macOS)
    @Bindable var serverController: PicoServerController

    init(model: AppModel, serverController: PicoServerController) {
      self.model = model
      self.serverController = serverController
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
              serverController: serverController
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
    @Bindable var serverController: PicoServerController

    var body: some View {
      ScrollView {
        Form {
          Section("Server") {
            LabeledContent("Address", value: model.serverURLText)
            LabeledContent("Status", value: model.connectionStatus.label)

            Button("Disconnect", role: .destructive) {
              model.disconnect()
            }
          }

          PiPerformanceSettingsSection(model: model)

          Section("Local Server") {
            if serverController.isManagementAvailable {
              LabeledContent("Status", value: serverController.statusText)
              LabeledContent(
                "Managed by",
                value: serverController.isExternalServer
                  ? "Another process"
                  : serverController.ownsServer ? "Pico" : "Pico (attached)"
              )
              Toggle(
                "Launch Pico at login",
                isOn: Binding(
                  get: { serverController.launchAtLogin },
                  set: { serverController.setLaunchAtLogin($0) }
                )
              )
              Text(
                "Closing the window keeps Pico and its server running in the menu bar. Quit Pico to stop the server after active work finishes."
              )
              .foregroundStyle(.secondary)

              if serverController.launchAtLoginRequiresApproval {
                Button(
                  "Open Login Item Settings",
                  action: serverController.openLoginItemSettings
                )
              }
            } else {
              Text("This build connects to an existing Pico server.")
                .foregroundStyle(.secondary)
            }

            if let errorMessage = serverController.errorMessage {
              Text(errorMessage)
                .foregroundStyle(.red)
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
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 720)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .top)
      }
      .scrollContentBackground(.visible)
      .task {
        serverController.refreshLaunchAtLoginStatus()
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

#if os(macOS)
  #Preview {
    SettingsView(
      model: AppModel(),
      serverController: PicoServerController(allowsManagement: false)
    )
  }
#else
  #Preview {
    NavigationStack {
      SettingsView(model: AppModel())
    }
  }
#endif
