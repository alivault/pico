import SwiftUI

struct GitCommitSheetView: View {
  @Bindable var model: AppModel
  var cwd: String
  var status: GitStatusSummary?
  var files: [GitChangeFile]
  var onComplete: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var message = ""
  @State private var includeUnstaged = true
  @State private var pushAfterCommit = false
  @State private var forcePush = false
  @State private var isGenerating = false
  @State private var isCommitting = false

  var body: some View {
    Form {
      Section {
        TextField("Commit message", text: $message, axis: .vertical)
          .lineLimit(3...8)

        Button {
          generateMessage()
        } label: {
          if isGenerating {
            Label("Generating…", systemImage: "wand.and.sparkles")
          } else {
            Label("Generate Message", systemImage: "wand.and.sparkles")
          }
        }
        .disabled(isGenerating || files.isEmpty)
      } header: {
        Text("Message")
      }

      Section {
        Toggle("Include unstaged changes", isOn: $includeUnstaged)
        Toggle("Push after commit", isOn: $pushAfterCommit)
        if pushAfterCommit {
          Toggle("Force push with lease", isOn: $forcePush)
        }
      }
    }
    .navigationTitle("Commit")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          commit()
        } label: {
          if isCommitting {
            ProgressView()
              .controlSize(.small)
              .tint(.white)
          } else {
            Text(pushAfterCommit ? "Commit + Push" : "Commit")
              .foregroundStyle(.white)
          }
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(Color.accentColor)
        .foregroundStyle(.white)
        .disabled(commitDisabled)
      }
    }
  }

  private var commitDisabled: Bool {
    isCommitting || files.isEmpty || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func generateMessage() {
    isGenerating = true
    Task {
      do {
        let response = try await model.generateGitCommitMessage(cwd: cwd)
        message = response.message
      } catch {
        model.alert = AppAlert(title: "Could not generate commit message", message: Self.message(for: error))
      }
      isGenerating = false
    }
  }

  private func commit() {
    let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedMessage.isEmpty else { return }
    isCommitting = true
    Task {
      let ok = await model.commitGitChanges(
        cwd: cwd,
        message: trimmedMessage,
        push: pushAfterCommit,
        forcePush: forcePush,
        includeUnstaged: includeUnstaged
      )
      isCommitting = false
      if ok {
        onComplete()
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
