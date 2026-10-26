/**
 * The `notify` extension: the agent sends a notification to the user's
 * devices (Web Push and ntfy, see `services/notify.ts`). Runs that finish and
 * questions that wait also notify, through the server's event handler.
 */
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

import { sessionIdOf, type HostBridge } from "./host.ts"
import { errorResult, textResult } from "./util.ts"

export function createNotifyExtension(host: HostBridge) {
  const tool = defineTool({
    name: "notify",
    deferred: true,
    description:
      "Send a short notification to the user's phone or desktop, for example when a long task is done or something needs attention. Do not use it for every step.",
    parameters: Type.Object({
      title: Type.String(),
      body: Type.String(),
      level: Type.Optional(
        Type.Union(
          ["info", "success", "warning", "error"].map((level) =>
            Type.Literal(level)
          )
        )
      ),
    }),
    replay: "safe",
    async execute(args, api, context) {
      const sent = await api.memo<number>("sent", context)
      if (sent !== undefined)
        return textResult(`Sent the notification to ${sent} device(s).`)
      const services = await host.ready(context.abortSignal)
      if (!services.notifier)
        return errorResult("Notifications are not available")
      const base = services.settings().publicUrl.replace(/\/+$/, "")
      const delivered = await services.notifier.send({
        title: args.title,
        body: args.body,
        url: `${base}/?session=${sessionIdOf(api.conversationId)}`,
        ...(args.level ? { level: args.level as "info" } : {}),
      })
      await api.memo("sent", delivered, context)
      return delivered > 0
        ? textResult(`Sent the notification to ${delivered} device(s).`)
        : textResult(
            "No device gets notifications yet. The user can turn them on in Pico's settings."
          )
    },
  })
  return defineExtension({ name: "notify", tools: [tool] })
}
