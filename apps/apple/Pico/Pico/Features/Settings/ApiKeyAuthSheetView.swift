import SwiftUI

struct ApiKeyAuthSheetView: View {
  @Bindable var model: AppModel
  var provider: AuthProviderOption
  @Environment(\.dismiss) private var dismiss
  @State private var apiKey = ""
  @State private var isSaving = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          LabeledContent("Provider", value: provider.name)
          SecureField("API key", text: $apiKey)
            .picoTextInputAutocapitalization(.never)
            .autocorrectionDisabled()
        } footer: {
          Text("The key is stored by the Pico server using the Pi SDK auth storage, not on this iPhone.")
        }
      }
      .navigationTitle(provider.configured ? "Update API Key" : "Add API Key")
      .picoNavigationTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: dismiss.callAsFunction)
            .disabled(isSaving)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save", action: save)
            .disabled(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
        }
      }
    }
  }

  private func save() {
    guard !isSaving else { return }
    isSaving = true

    Task {
      let saved = await model.saveProviderApiKey(
        provider: provider,
        key: apiKey
      )
      isSaving = false
      if saved {
        dismiss()
      }
    }
  }
}

#Preview {
  ApiKeyAuthSheetView(
    model: AppModel(),
    provider: AuthProviderOption(
      id: "anthropic",
      name: "Anthropic",
      authType: .apiKey,
      configured: false
    )
  )
}
