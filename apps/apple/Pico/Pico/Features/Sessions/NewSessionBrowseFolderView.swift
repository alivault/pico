import SwiftUI

struct NewSessionBrowseFolderView: View {
  @Bindable var model: AppModel
  var folderPath: String
  @Binding var showHiddenDirectories: Bool
  var chooseDirectory: (String) -> Void
  var useButtonTitle = "Use This Directory"
  @State private var directories: [CompletionItem] = []
  @State private var isLoading = false

  var body: some View {
    List {
      Section("Folders") {
        if isLoading && visibleDirectories.isEmpty {
          ProgressView("Loading folders…")
        }

        ForEach(visibleDirectories) { item in
          NavigationLink(value: item.value) {
            NewSessionDirectoryLabel(
              path: item.value,
              isSelected: false
            )
          }
        }

        if !isLoading && visibleDirectories.isEmpty {
          Text("No folders found")
            .foregroundStyle(.secondary)
        }
      }
    }
    .navigationTitle(DirectoryPathFormatter.folderName(folderPath))
    .picoNavigationTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        NewSessionOptionsMenu(showHiddenDirectories: $showHiddenDirectories)
      }
    }
    .safeAreaInset(edge: .bottom) {
      Button(action: useDirectory) {
        Label(useButtonTitle, picoSystemImage: "checkmark")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .padding()
      .background(.bar)
    }
    .task(id: folderPath) {
      await updateDirectories()
    }
  }

  private var visibleDirectories: [CompletionItem] {
    directories.filter { item in
      item.isDirectory && (showHiddenDirectories || !item.isHidden)
    }
  }

  private func updateDirectories() async {
    isLoading = true
    let directories = await model.listDirectoryEntries(prefix: folderPath)
    guard !Task.isCancelled else { return }
    self.directories = directories
    isLoading = false
  }

  private func useDirectory() {
    chooseDirectory(folderPath)
  }
}

#Preview {
  NavigationStack {
    NewSessionBrowseFolderView(
      model: AppModel(),
      folderPath: DirectoryPathFormatter.homePrefix,
      showHiddenDirectories: .constant(false),
      chooseDirectory: { _ in }
    )
  }
}
