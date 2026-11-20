import { ServerOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

/**
 * The view that covers the page while the Pico server does not answer
 * (see `lib/pico/server-connection.ts`). The app shells stay mounted below
 * it, so the page keeps its state and continues when the server is back.
 */
export function ServerUnreachableOverlay() {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[100] flex bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerOffIcon />
          </EmptyMedia>
          <EmptyTitle>Pico cannot reach its server</EmptyTitle>
          <EmptyDescription>
            The server is stopped or restarting. Pico tries again and continues
            when the server answers.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex flex-col items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-label="Trying to connect" />
            Trying to connect…
          </span>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
