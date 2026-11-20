import * as React from "react"

/**
 * The element that floating UI (dialogs, menus, popovers, tooltips) of a
 * subtree renders into. Without a provider, it renders into the body.
 *
 * Pico keeps a hidden app shell for each machine that the page opened. Each
 * shell gives its floating UI its own container, so that a menu that was
 * open when the shell hid does not stay on the screen.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export const PortalContainerProvider = PortalContainerContext

export function usePortalContainer() {
  return React.useContext(PortalContainerContext) ?? undefined
}
