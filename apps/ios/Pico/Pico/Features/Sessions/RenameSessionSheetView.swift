import SwiftUI

struct RenameSessionSheetView: View {
  @Bindable var model: AppModel
  var initialName: String
  var path: String?
  var canGenerateName: Bool
  var onSave: (String) async -> Bool

  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var isGenerating = false
  @State private var isSaving = false
  @State private var generatedName = false

  init(
    model: AppModel,
    initialName: String,
    path: String?,
    canGenerateName: Bool,
    onSave: @escaping (String) async -> Bool
  ) {
    self.model = model
    self.initialName = initialName
    self.path = path
    self.canGenerateName = canGenerateName
    self.onSave = onSave
    _name = State(initialValue: initialName)
  }

  var body: some View {
    Form {
      Section {
        TextField("Session name", text: $name, axis: .vertical)
          .lineLimit(1...3)

        Button {
          generateName()
        } label: {
          if isGenerating {
            Label("Generating…", picoSystemImage: "wand.and.sparkles")
          } else {
            Label("Generate Name", picoSystemImage: "wand.and.sparkles")
          }
        }
        .disabled(generateDisabled)
      } header: {
        Text("Name")
      } footer: {
        if canGenerateName {
          Text("Generate a name from the first user message.")
        } else {
          Text("A generated or saved session name already exists.")
        }
      }
    }
    .navigationTitle("Rename Session")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Cancel") { dismiss() }
          .disabled(isSaving)
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          saveName()
        } label: {
          if isSaving {
            ProgressView()
              .controlSize(.small)
              .tint(.white)
          } else {
            Text("Rename")
              .foregroundStyle(.white)
          }
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(Color.accentColor)
        .foregroundStyle(.white)
        .disabled(saveDisabled)
      }
    }
  }

  private var trimmedName: String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var generateDisabled: Bool {
    isGenerating || isSaving || !canGenerateName || generatedName
  }

  private var saveDisabled: Bool {
    isSaving || trimmedName.isEmpty
  }

  private func generateName() {
    guard !generateDisabled else { return }

    isGenerating = true
    Task {
      do {
        let response = try await model.generateSessionName(path: path)
        name = response.name
        generatedName = true
      } catch {
        model.alert = AppAlert(
          title: "Could not generate session name",
          message: Self.message(for: error)
        )
      }
      isGenerating = false
    }
  }

  private func saveName() {
    let value = trimmedName
    guard !value.isEmpty else { return }

    isSaving = true
    Task {
      let ok = await onSave(value)
      isSaving = false
      if ok {
        dismiss()
      }
    }
  }

  private static func message(for error: Error) -> String {
    if let localizedError = error as? LocalizedError,
       let description = localizedError.errorDescription {
      return description
    }
    return error.localizedDescription
  }
}
