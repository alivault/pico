import { defineWebSocketHandler } from "nitro/h3"

import { getPicoRuntime } from "@/server/pico-runtime"

export default defineWebSocketHandler({
  async upgrade(request) {
    return {
      context: await getPicoRuntime().createTerminalWebSocketContext(request),
    }
  },
  open(peer) {
    getPicoRuntime().openTerminalWebSocket(peer)
  },
  message(peer, message) {
    getPicoRuntime().handleTerminalWebSocketMessage(peer, message.text())
  },
  close(peer) {
    getPicoRuntime().closeTerminalWebSocket(peer)
  },
  error(peer) {
    getPicoRuntime().closeTerminalWebSocket(peer)
  },
})
