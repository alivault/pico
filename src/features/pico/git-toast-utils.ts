import { toast } from "sonner"

import type { GitActionResponse } from "@/lib/pico/api"

function formatPushedCommitMessages(messages: Array<string> | undefined) {
  const commitMessages = Array.isArray(messages)
    ? messages.flatMap((message) => {
        const trimmedMessage = message.trim()
        return trimmedMessage ? [trimmedMessage] : []
      })
    : []

  if (commitMessages.length === 0) return undefined
  if (commitMessages.length === 1) return commitMessages[0]

  const visibleMessages = commitMessages.slice(0, 3)
  const remainingCount = commitMessages.length - visibleMessages.length
  const suffix = remainingCount > 0 ? ` + ${remainingCount} more` : ""

  return `${commitMessages.length} commits: ${visibleMessages.join(" · ")}${suffix}`
}

export function showGitPushSuccessToast({
  response,
  force = false,
}: {
  response: GitActionResponse
  force?: boolean
}) {
  if (!response.ok) return

  const description = formatPushedCommitMessages(response.pushedCommitMessages)
  const title = force ? "Force pushed changes" : "Pushed changes"

  if (description) {
    toast.success(title, { description })
  } else {
    toast.success(title)
  }
}
