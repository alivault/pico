import SwiftUI

struct ProviderAuthSectionView: View {
  @Bindable var model: AppModel
  @Binding var apiKeyProvider: AuthProviderOption?

  var body: some View {
    if !model.isConnected {
      Section("Provider Authentication") {
        Text("Connect to a Pico server to load provider authentication.")
          .foregroundStyle(.secondary)
      }
    } else {
      Section {
        LabeledContent(
          "Available Models",
          value: String(model.sessionState.availableModels.count)
        )

        Button("Refresh Providers", systemImage: "arrow.clockwise") {
          Task {
            await model.refreshAuthProviders()
          }
        }
        .disabled(model.isLoadingAuthProviders)

        if model.isLoadingAuthProviders {
          ProgressView("Loading providers…")
        }
      } header: {
        Text("Provider Authentication")
      } footer: {
        Text("Models appear after a provider is authenticated on the Pico server.")
      }

      if let providers = model.authProviders {
        if !providers.loggedInProviders.isEmpty {
          Section("Logged In") {
            ForEach(providers.loggedInProviders) { provider in
              AuthProviderRowView(
                provider: provider,
                actionTitle: "Log Out",
                isWorking: model.authMutationProviderId == provider.id
              ) {
                Task {
                  await model.logoutProvider(provider)
                }
              }
            }
          }
        }

        if !providers.apiKeyProviders.isEmpty {
          Section("API Keys") {
            ForEach(providers.apiKeyProviders) { provider in
              AuthProviderRowView(
                provider: provider,
                actionTitle: provider.configured ? "Update Key" : "Set Key",
                isWorking: model.authMutationProviderId == provider.id
              ) {
                apiKeyProvider = provider
              }
            }
          }
        }

        if !providers.oauthProviders.isEmpty {
          Section {
            ForEach(providers.oauthProviders) { provider in
              AuthProviderRowView(
                provider: provider,
                actionTitle: provider.configured ? "Reconnect" : "Log In",
                isWorking: model.authMutationProviderId == provider.id
              ) {
                Task {
                  await model.loginProviderOAuth(provider: provider)
                }
              }
            }
          } header: {
            Text("Subscriptions / OAuth")
          } footer: {
            Text("OAuth may ask you to open a login page and paste a redirect URL back into Pico.")
          }
        }
      }
    }
  }
}

#Preview {
  @Previewable @State var apiKeyProvider: AuthProviderOption?

  Form {
    ProviderAuthSectionView(
      model: AppModel(),
      apiKeyProvider: $apiKeyProvider
    )
  }
}
