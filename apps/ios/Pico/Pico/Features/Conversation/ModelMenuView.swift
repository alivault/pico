import SwiftUI

struct ModelMenuView: View {
  @Bindable var model: AppModel

  var body: some View {
    Menu {
      if modelOptions.isEmpty {
        Text("No models")
      } else {
        ForEach(providerNames, id: \.self) { provider in
          Menu(provider) {
            ForEach(models(for: provider), id: \.stableIdentifier) { option in
              Button(action: { select(option) }) {
                if model.sessionState.model?.stableIdentifier == option.stableIdentifier {
                  Label(option.displayName, systemImage: "checkmark")
                } else {
                  Text(option.displayName)
                }
              }
            }
          }
        }
      }
    } label: {
      Label(model.sessionState.model?.displayName ?? "Model", systemImage: "cpu")
        .font(.caption)
    }
    .disabled(modelOptions.isEmpty)
  }

  private var modelOptions: [ModelOption] {
    let options: [ModelOption]
    if !model.sessionState.availableModels.isEmpty {
      options = model.sessionState.availableModels
    } else if let selectedModel = model.sessionState.model {
      options = [selectedModel]
    } else {
      options = []
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
    return modelOptions.compactMap { option in
      let provider = option.providerDisplayName
      guard !seen.contains(provider) else { return nil }
      seen.insert(provider)
      return provider
    }
  }

  private func models(for provider: String) -> [ModelOption] {
    modelOptions.filter { $0.providerDisplayName == provider }
  }

  private func select(_ option: ModelOption) {
    Task {
      await model.setModel(option)
    }
  }
}

#Preview {
  ModelMenuView(model: AppModel())
}
