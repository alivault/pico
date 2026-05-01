import * as React from "react"
import { HotkeysProvider } from "@tanstack/react-hotkeys"
import { ThemeProvider } from "next-themes"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { THEME_STORAGE_KEY } from "@/lib/phi"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <HotkeysProvider
      defaultOptions={{
        hotkey: {
          preventDefault: false,
          stopPropagation: false,
          ignoreInputs: false,
        },
      }}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey={THEME_STORAGE_KEY}
      >
        <TooltipProvider delay={150}>
          {children}
          <Toaster
            richColors
            position="top-right"
            offset={{ top: "calc(2.75rem + 0.75rem)" }}
            mobileOffset={{ top: "calc(2.75rem + 0.75rem)" }}
          />
        </TooltipProvider>
      </ThemeProvider>
    </HotkeysProvider>
  )
}
