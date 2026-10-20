/**
 * The coding tools (read, write, edit, bash), with a shell prefix before every
 * bash command: pi's `shellCommandPrefix` setting, as pi's own CLI applies it.
 * A prefix such as `set -u` makes an unset variable an error, so a command like
 * `rm -rf "$DIR"/*` cannot run with `$DIR` empty. `shellPrefix` is read on each
 * call, so a change to the setting applies without a restart.
 */
import { defineExtension } from "@earendil-works/pi-durable"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ReadToolOptions,
} from "@earendil-works/pi-durable/tools"

export function createPicoCodingTools(options: {
  images?: ReadToolOptions["images"]
  shellPrefix: () => string | undefined
}) {
  return defineExtension({
    name: "coding-tools",
    tools: [
      createReadTool(options.images ? { images: options.images } : {}),
      createWriteTool(),
      createEditTool(),
      createBashTool({
        prepare: (execution) => {
          const prefix = options.shellPrefix()
          if (prefix) execution.command = `${prefix}\n${execution.command}`
        },
      }),
    ],
  })
}
