import SwiftUI

struct NewSessionCreateButtonBar: View {
  var path: String?
  var isCreating: Bool
  var canStart: Bool = true
  var action: () -> Void

  var body: some View {
    VStack(spacing: 8) {
      if let path {
        Text("Session will start in \(DirectoryPathFormatter.folderName(path))")
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Button(action: action) {
        HStack {
          if isCreating {
            ProgressView()
          }
          Text("Start Session")
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(path == nil || isCreating || !canStart)
    }
    .padding()
    .background(.bar)
  }
}

#Preview {
  NewSessionCreateButtonBar(
    path: "/Users/alice/project",
    isCreating: false,
    action: {}
  )
}
