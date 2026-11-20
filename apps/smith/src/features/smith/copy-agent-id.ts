import { copyTextToClipboard } from "@/features/pico/markdown-renderer"
import { toast } from "@/lib/pico/toast"

/** Copy an agent's ID (for example `s168777`), as agents use it in tools. */
export async function copyAgentId(agentId: string) {
  try {
    await copyTextToClipboard(agentId)
    toast.success(`Copied ${agentId}`)
  } catch {
    toast.error("Could not copy the agent ID")
  }
}
