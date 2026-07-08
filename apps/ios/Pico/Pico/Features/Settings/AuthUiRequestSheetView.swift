import SwiftUI

struct AuthUiRequestSheetView: View {
  @Bindable var model: AppModel
  var request: UiRequest
  @Environment(\.openURL) private var openURL
  @State private var value = ""
  @State private var isResolving = false

  var body: some View {
    NavigationStack {
      Form {
        if let message = request.message, !message.isEmpty {
          Section {
            Text(message)
          }
        }

        switch request.method {
        case "auth":
          authSection
        case "auth_input", "input", "editor":
          inputSection
        case "auth_select", "select":
          selectionSection
        case "confirm":
          confirmSection
        default:
          unsupportedSection
        }
      }
      .navigationTitle(navigationTitle)
      .navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(true)
      .task(id: request.id) {
        value = request.prefill ?? ""
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(cancelTitle, role: .cancel, action: cancel)
            .disabled(isResolving)
        }
        if showsConfirmationAction {
          ToolbarItem(placement: .confirmationAction) {
            Button(confirmationTitle, action: submit)
              .disabled(!canSubmit || isResolving)
          }
        }
      }
    }
  }

  private var authSection: some View {
    Section {
      if let url = authURL {
        Button("Open Login Page", picoSystemImage: "safari") {
          openURL(url)
        }
      }

      if request.authManualAllowed == true {
        TextField("Paste redirect URL", text: $value, axis: .vertical)
          .lineLimit(2...5)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } else {
        Text("Complete the login in your browser, then return to Pico.")
          .foregroundStyle(.secondary)
      }
    } footer: {
      if request.authManualAllowed == true {
        Text("If the browser cannot return to the Pico server automatically, paste the final redirect URL here.")
      }
    }
  }

  private var inputSection: some View {
    Section {
      TextField(
        request.placeholder ?? "Response",
        text: $value,
        axis: .vertical
      )
      .lineLimit(inputLineLimit)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
    } footer: {
      if request.method == "editor" {
        Text("Pico is waiting for this response before it can continue.")
      }
    }
  }

  private var selectionSection: some View {
    Section {
      if request.options?.isEmpty != false {
        Text("No options were provided.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(request.options ?? [], id: \.value) { option in
          Button(option.label) {
            resolve(value: option.value)
          }
          .disabled(isResolving)
        }
      }
    }
  }

  private var confirmSection: some View {
    Section {
      Text("Pico is waiting for your confirmation before continuing.")
        .foregroundStyle(.secondary)
    }
  }

  private var unsupportedSection: some View {
    Section {
      Text("This Pico request is not supported by the iOS client yet. Cancel it to let Pico continue with the default response.")
        .foregroundStyle(.secondary)
    }
  }

  private var navigationTitle: String {
    if let title = request.title, !title.isEmpty {
      return title
    }

    switch request.method {
    case "auth", "auth_input", "auth_select":
      return "Provider Login"
    case "confirm":
      return "Confirm Request"
    case "select":
      return "Choose Option"
    case "input", "editor":
      return "Pico Request"
    default:
      return "Pico Request"
    }
  }

  private var cancelTitle: String {
    switch request.method {
    case "auth", "auth_input", "auth_select":
      return "Cancel Login"
    default:
      return "Cancel"
    }
  }

  private var confirmationTitle: String {
    switch request.method {
    case "confirm":
      return "Confirm"
    case "editor", "input":
      return "Submit"
    case "auth", "auth_input":
      return "Continue"
    default:
      return "Continue"
    }
  }

  private var showsConfirmationAction: Bool {
    switch request.method {
    case "auth":
      request.authManualAllowed == true
    case "auth_input", "input", "editor", "confirm":
      true
    default:
      false
    }
  }

  private var inputLineLimit: ClosedRange<Int> {
    request.method == "editor" ? 5...12 : 1...5
  }

  private var authURL: URL? {
    guard let authUrl = request.authUrl else { return nil }
    return URL(string: authUrl)
  }

  private var canSubmit: Bool {
    if request.method == "confirm" {
      return true
    }

    if request.method == "auth", request.authManualAllowed != true {
      return false
    }

    if request.allowEmpty == true {
      return true
    }

    return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func submit() {
    if request.method == "confirm" {
      resolve(confirmed: true)
    } else {
      resolve(value: value)
    }
  }

  private func cancel() {
    resolve(value: nil, cancelled: true)
  }

  private func resolve(
    value: String? = nil,
    confirmed: Bool? = nil,
    cancelled: Bool = false
  ) {
    guard !isResolving else { return }
    isResolving = true

    Task {
      _ = await model.resolveUiRequest(
        request,
        value: value,
        confirmed: confirmed,
        cancelled: cancelled
      )
      isResolving = false
    }
  }
}

#Preview {
  AuthUiRequestSheetView(
    model: AppModel(),
    request: UiRequest(
      id: "preview",
      type: "extension_ui_request",
      method: "confirm",
      title: "Run command?",
      message: "Pico wants to continue.",
      placeholder: nil,
      prefill: nil,
      authUrl: nil,
      authManualAllowed: nil,
      allowEmpty: nil,
      notifyType: nil,
      options: nil,
      timeout: nil
    )
  )
}
