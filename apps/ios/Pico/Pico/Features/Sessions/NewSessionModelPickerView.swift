import SwiftUI

struct NewSessionModelPickerView: View {
  var models: [ModelOption]
  @Binding var selectedModel: ModelOption?

  var body: some View {
    Menu {
      if pickerModels.isEmpty {
        Text("No models")
      } else {
        Button(action: { selectedModel = nil }) {
          if selectedModel == nil {
            Label("Default", systemImage: "checkmark")
          } else {
            Text("Default")
          }
        }

        ForEach(providerNames, id: \.self) { provider in
          Menu(provider) {
            ForEach(models(for: provider), id: \.stableIdentifier) { model in
              Button(action: { selectedModel = model }) {
                if selectedModel?.stableIdentifier == model.stableIdentifier {
                  Label(model.displayName, systemImage: "checkmark")
                } else {
                  Text(model.displayName)
                }
              }
            }
          }
        }
      }
    } label: {
      LabeledContent("Model") {
        Text(selectedModel?.pickerTitle ?? "Default")
      }
    }
    .disabled(pickerModels.isEmpty)
  }

  private var pickerModels: [ModelOption] {
    var options = models
    if let selectedModel,
       !options.contains(where: { $0.stableIdentifier == selectedModel.stableIdentifier }) {
      options.append(selectedModel)
    }

    return options.sorted { left, right in
      let providerCompare = left.providerDisplayName.localizedStandardCompare(
        right.providerDisplayName
      )
      if providerCompare != .orderedSame {
        return providerCompare == .orderedAscending
      }

      return left.displayName.localizedStandardCompare(right.displayName) == .orderedAscending
    }
  }

  private var providerNames: [String] {
    var seen = Set<String>()
    return pickerModels.compactMap { model in
      let provider = model.providerDisplayName
      guard !seen.contains(provider) else { return nil }
      seen.insert(provider)
      return provider
    }
  }

  private func models(for provider: String) -> [ModelOption] {
    pickerModels.filter { $0.providerDisplayName == provider }
  }
}

#Preview {
  @Previewable @State var selectedModel: ModelOption? = ModelOption(
    id: "claude-sonnet-4",
    provider: "anthropic",
    name: "Claude Sonnet 4",
    reasoning: true
  )

  List {
    NewSessionModelPickerView(
      models: [selectedModel].compactMap { $0 },
      selectedModel: $selectedModel
    )
  }
}
