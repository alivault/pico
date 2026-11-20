import { useShellLayout } from "@/hooks/use-shell-layout"

// True when the app uses the compact (mobile) layout: the window is too narrow
// for the left sidebar and the center column side by side.
export function useIsMobile() {
  return useShellLayout((layout) => layout.compact)
}
