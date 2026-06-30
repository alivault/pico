import SwiftUI

struct GitBranchSheetView: View {
  @Bindable var model: AppModel
  var cwd: String
  var status: GitStatusSummary?
  var branches: [GitLocalBranch]
  var remoteBranches: [GitRemoteBranch]
  var onComplete: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var newBranchName = ""
  @State private var searchText = ""

  private var renderedBranches: [GitLocalBranch] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    let source = branches.isEmpty ? fallbackBranches : branches
    guard !query.isEmpty else { return source }
    return source.filter { branch in
      branch.name.localizedCaseInsensitiveContains(query) ||
        branch.subject?.localizedCaseInsensitiveContains(query) == true
    }
  }

  private var renderedRemoteBranches: [GitRemoteBranch] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return remoteBranches }
    return remoteBranches.filter { branch in
      branch.name.localizedCaseInsensitiveContains(query) ||
        branch.subject?.localizedCaseInsensitiveContains(query) == true
    }
  }

  private var localBranchNames: Set<String> {
    Set((branches.isEmpty ? fallbackBranches : branches).map(\.name))
  }

  private var fallbackBranches: [GitLocalBranch] {
    guard let status, let branchName = status.branch, !branchName.isEmpty else { return [] }
    return [
      GitLocalBranch(
        name: branchName,
        current: true,
        upstream: nil,
        ahead: status.ahead,
        behind: status.behind,
        upstreamGone: false,
        hash: status.revision,
        subject: nil,
        relativeDate: nil,
        committerDate: nil
      ),
    ]
  }

  var body: some View {
    List {
      Section {
        HStack {
          TextField("New branch name", text: $newBranchName)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          Button("Create") {
            createBranch()
          }
          .disabled(newBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      } header: {
        Text("Create Branch")
      }

      Section {
        if renderedBranches.isEmpty {
          ContentUnavailableView.search(text: searchText)
        } else {
          ForEach(renderedBranches) { branch in
            Button {
              checkout(branch.name, create: false)
            } label: {
              GitBranchRow(branch: branch)
            }
            .disabled(branch.current)
          }
        }
      } header: {
        Text("Local Branches")
      }

      if !renderedRemoteBranches.isEmpty {
        Section("Remote Branches") {
          ForEach(renderedRemoteBranches) { branch in
            let parts = GitFormatting.remoteBranchParts(branch.name)
            let localName = parts.branch.isEmpty ? branch.name : parts.branch
            let localExists = localBranchNames.contains(localName)
            Button {
              checkoutRemote(branch, localName: localName, localExists: localExists)
            } label: {
              HStack(spacing: 10) {
                Image(systemName: "arrow.branch")
                  .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 4) {
                  HStack(spacing: 0) {
                    if !parts.remote.isEmpty {
                      Text("\(parts.remote)/")
                        .foregroundStyle(.secondary)
                    }
                    Text(localName)
                  }
                  .font(.subheadline.weight(.semibold))
                  HStack(spacing: 8) {
                    if let hash = branch.hash, !hash.isEmpty {
                      Text(String(hash.prefix(8)))
                        .font(.caption.monospaced())
                    }
                    if let relativeDate = branch.relativeDate, !relativeDate.isEmpty {
                      Text(GitFormatting.compactRelativeDate(relativeDate))
                    }
                    Text(localExists ? "Switch" : "Track")
                      .foregroundStyle(localExists ? .secondary : Color(uiColor: .systemBlue))
                  }
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  if let subject = branch.subject, !subject.isEmpty {
                    Text(subject)
                      .font(.caption)
                      .foregroundStyle(.secondary)
                      .lineLimit(2)
                  }
                }
              }
            }
          }
        }
      }
    }
    .searchable(text: $searchText, prompt: "Search branches")
    .navigationTitle("Branches")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Done") { dismiss() }
      }
    }
  }

  private func createBranch() {
    let name = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    checkout(name, create: true)
  }

  private func checkout(_ name: String, create: Bool) {
    Task {
      let ok = await model.checkoutGitBranch(cwd: cwd, branchName: name, create: create)
      if ok {
        onComplete()
        dismiss()
      }
    }
  }

  private func checkoutRemote(
    _ branch: GitRemoteBranch,
    localName: String,
    localExists: Bool
  ) {
    Task {
      let ok = await model.checkoutGitBranch(
        cwd: cwd,
        branchName: localName,
        create: !localExists,
        startPoint: localExists ? nil : branch.name,
        track: !localExists
      )
      if ok {
        onComplete()
        dismiss()
      }
    }
  }
}

private struct GitBranchRow: View {
  var branch: GitLocalBranch

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: branch.current ? "checkmark" : "circle")
        .foregroundStyle(branch.current ? Color(uiColor: .systemGreen) : .secondary)
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text(branch.name)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
          let trackText = GitFormatting.localBranchTrackText(branch)
          if !trackText.isEmpty {
            Text(trackText)
              .font(.caption.monospacedDigit())
              .foregroundStyle(trackText == "synced" ? Color(uiColor: .systemGreen) : Color(uiColor: .systemOrange))
          }
        }
        if let upstream = branch.upstream, !upstream.isEmpty {
          Text(upstream)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        if let subject = branch.subject, !subject.isEmpty {
          Text(subject)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
    }
  }
}
