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
                if selectedModel?.stableIdentifier == option.stableIdentifier {
                  Label(option.displayName, picoSystemImage: "checkmark")
                } else {
                  Text(option.displayName)
                }
              }
            }
          }
        }
      }
    } label: {
      HStack(spacing: 5) {
        Image(picoSystemName: "cpu", pointSize: 18)
        Text(selectedModel?.displayName ?? "Model")
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: 140)
      }
      .font(.caption)
    }
    .disabled(modelOptions.isEmpty)
    .fixedSize(horizontal: true, vertical: false)
    .help("Model: \(selectedModel?.displayName ?? "Default")")
  }

  private var selectedModel: ModelOption? {
    model.composerModel
  }

  private var modelOptions: [ModelOption] {
    var options = model.sessionState.availableModels
    if let selectedModel,
      !options.contains(where: { $0.stableIdentifier == selectedModel.stableIdentifier })
    {
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
      await model.selectComposerModel(option)
    }
  }
}

#Preview {
  ModelMenuView(model: AppModel())
}
