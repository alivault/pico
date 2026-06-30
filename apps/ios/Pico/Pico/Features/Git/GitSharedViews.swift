import SwiftUI
import UIKit

struct GitSectionCard<Content: View>: View {
  var title: String
  var subtitle: String?
  var systemImage: String?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        if let systemImage {
          Image(systemName: systemImage)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.headline)
          if let subtitle, !subtitle.isEmpty {
            Text(subtitle)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        Spacer(minLength: 0)
      }
      content
    }
    .padding(14)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(Color(uiColor: .separator).opacity(0.22), lineWidth: 1)
    }
  }
}

struct GitInlineNote: View {
  var title: String
  var systemImage: String = "info.circle"
  var isError = false

  var body: some View {
    Label(title, systemImage: systemImage)
      .font(.callout)
      .foregroundStyle(isError ? Color(uiColor: .systemRed) : .secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(
        (isError ? Color(uiColor: .systemRed) : Color.secondary)
          .opacity(0.08),
        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
      )
  }
}

struct GitStatusBadge: View {
  var status: String?

  var body: some View {
    let characters = GitFormatting.statusCharacters(status)
    HStack(spacing: 0) {
      Text(String(characters.index))
        .foregroundStyle(GitFormatting.statusColor(characters.index, column: .index))
      Text(String(characters.worktree))
        .foregroundStyle(GitFormatting.statusColor(characters.worktree, column: .worktree))
    }
    .font(.system(size: 12, weight: .semibold, design: .monospaced))
    .frame(width: 24, alignment: .leading)
    .accessibilityLabel(GitFormatting.statusDescription(status))
  }
}

struct GitLineCountBadge: View {
  var added: Int?
  var deleted: Int?

  var body: some View {
    let additions = max(0, added ?? 0)
    let deletions = max(0, deleted ?? 0)
    if additions > 0 || deletions > 0 {
      HStack(spacing: 6) {
        if additions > 0 {
          Text("+\(additions)")
            .foregroundStyle(Color(uiColor: .systemGreen))
        }
        if deletions > 0 {
          Text("-\(deletions)")
            .foregroundStyle(Color(uiColor: .systemRed))
        }
      }
      .font(.caption.monospacedDigit())
    }
  }
}

struct GitBranchChip: View {
  var title: String
  var isLoading: Bool

  var body: some View {
    HStack(spacing: 6) {
      if isLoading {
        ProgressView()
          .controlSize(.small)
      } else {
        Image(systemName: "arrow.triangle.branch")
          .font(.caption.weight(.semibold))
          .accessibilityHidden(true)
      }

      Text(title)
        .lineLimit(1)
        .truncationMode(.tail)

      Image(systemName: "chevron.down")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
    .font(.subheadline.weight(.semibold))
    .foregroundStyle(.primary)
    .padding(.horizontal, 10)
    .frame(height: 30)
    .contentShape(Capsule())
  }
}

struct GitFileIcon: View {
  var path: String
  var isDirectory: Bool = false

  var body: some View {
    Image(systemName: systemImage)
      .foregroundStyle(isDirectory ? Color(uiColor: .systemBlue) : .secondary)
      .accessibilityHidden(true)
  }

  private var systemImage: String {
    if isDirectory { return "folder" }
    let extensionName = path.split(separator: ".").last.map(String.init)?.lowercased() ?? ""
    switch extensionName {
    case "md", "markdown":
      return "doc.richtext"
    case "swift":
      return "swift"
    case "json", "jsonc":
      return "curlybraces"
    case "ts", "tsx", "js", "jsx":
      return "chevron.left.forwardslash.chevron.right"
    case "png", "jpg", "jpeg", "gif", "webp":
      return "photo"
    default:
      return "doc.text"
    }
  }
}

struct GitLoadingView: View {
  var title: String

  var body: some View {
    HStack(spacing: 10) {
      ProgressView()
      Text(title)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
  }
}

struct GitEmptyView: View {
  var title: String
  var systemImage: String
  var message: String

  var body: some View {
    ContentUnavailableView(title, systemImage: systemImage, description: Text(message))
      .frame(maxWidth: .infinity, minHeight: 180)
  }
}

struct GitCommentSheetView: View {
  var previewTitle: String
  var previewSubtitle: String?
  var previewSystemImage: String
  var primaryActionTitle: String
  var delete: (() -> Void)?
  var attach: (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @FocusState private var isCommentFocused: Bool
  @State private var comment: String

  init(
    previewTitle: String,
    previewSubtitle: String?,
    previewSystemImage: String = "doc.text",
    initialComment: String = "",
    primaryActionTitle: String = "Attach",
    delete: (() -> Void)? = nil,
    attach: @escaping (String) -> Void
  ) {
    self.previewTitle = previewTitle
    self.previewSubtitle = previewSubtitle
    self.previewSystemImage = previewSystemImage
    self.primaryActionTitle = primaryActionTitle
    self.delete = delete
    self.attach = attach
    _comment = State(initialValue: initialComment)
  }

  private var trimmedComment: String {
    comment.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    Form {
      Section("Commenting on") {
        HStack(spacing: 10) {
          Image(systemName: previewSystemImage)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 3) {
            Text(previewTitle)
              .font(.subheadline.weight(.semibold))
              .lineLimit(3)
            if let previewSubtitle, !previewSubtitle.isEmpty {
              Text(previewSubtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            }
          }
        }
        .padding(.vertical, 4)
      }

      Section("Comment") {
        TextField("Add your comment…", text: $comment, axis: .vertical)
          .focused($isCommentFocused)
          .lineLimit(5...10)
          .textInputAutocapitalization(.sentences)
      }

      if let delete {
        Section {
          Button("Delete Comment", systemImage: "trash", role: .destructive) {
            delete()
            dismiss()
          }
        }
      }
    }
    .navigationTitle("Comment")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button(primaryActionTitle) {
          attach(trimmedComment)
          dismiss()
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(Color.accentColor)
        .foregroundStyle(.white)
        .disabled(trimmedComment.isEmpty)
      }
    }
    .task {
      isCommentFocused = true
    }
  }
}
