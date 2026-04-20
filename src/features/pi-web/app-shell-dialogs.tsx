import { FolderTreeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { APP_SHELL_SHORTCUT_SECTIONS } from "@/features/pi-web/app-shell-shortcuts"
import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type { FlatTreeNode, ThemeMode } from "@/lib/pi-web"
import type { ExtensionUiEvent } from "@/lib/pi-web-api"

type ForkMessage = {
  entryId: string
  text: string
}

type AppShellDialogsProps = {
  addDirectoryOpen: boolean
  onAddDirectoryOpenChange: (open: boolean) => void
  directoryInput: string
  onDirectoryInputChange: (value: string) => void
  onAddDirectory: () => void
  renameOpen: boolean
  onRenameOpenChange: (open: boolean) => void
  renameValue: string
  onRenameValueChange: (value: string) => void
  onRenameSession: () => void
  deleteOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
  onDeleteSession: () => void
  forkOpen: boolean
  onForkOpenChange: (open: boolean) => void
  forkLoading: boolean
  forkMessages: Array<ForkMessage> | null
  onForkFromMessage: (entryId: string) => void
  treeOpen: boolean
  onTreeOpenChange: (open: boolean) => void
  treeLoading: boolean
  treeQuery: string
  onTreeQueryChange: (value: string) => void
  flatTree: Array<FlatTreeNode>
  selectedTreeNodeId: string | null
  onSelectedTreeNodeIdChange: (value: string | null) => void
  selectedTreeNodeLabel: string
  onSelectedTreeNodeLabelChange: (value: string) => void
  onNavigateTreeNode: (targetId: string) => void
  onSaveTreeLabel: () => void
  statusOpen: boolean
  onStatusOpenChange: (open: boolean) => void
  statuses: Record<string, string>
  shortcutsOpen: boolean
  onShortcutsOpenChange: (open: boolean) => void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  currentTheme: ThemeMode
  currentThemeLabel: string
  onThemeChange: (value: ThemeMode) => void
  sessionDoneSoundEnabled: boolean
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  sessionDoneDesktopNotificationsEnabled: boolean
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  desktopNotificationPermission: DesktopNotificationPermission
  pendingUiRequest: ExtensionUiEvent | null
  pendingUiValue: string
  onPendingUiValueChange: (value: string) => void
  onResolveUiRequest: (body: Record<string, unknown>) => void
}

const THEME_OPTIONS: Array<ThemeMode> = ["system", "light", "dark"]

function desktopNotificationPermissionLabel(
  permission: DesktopNotificationPermission
) {
  if (permission === "unsupported") {
    return "Desktop notifications are unavailable in this browser."
  }

  if (permission === "granted") {
    return "Desktop notifications are enabled for this origin."
  }

  if (permission === "denied") {
    return "Desktop notifications are blocked in this browser."
  }

  return "Desktop notifications will ask for browser permission when enabled."
}

export function AppShellDialogs({
  addDirectoryOpen,
  onAddDirectoryOpenChange,
  directoryInput,
  onDirectoryInputChange,
  onAddDirectory,
  renameOpen,
  onRenameOpenChange,
  renameValue,
  onRenameValueChange,
  onRenameSession,
  deleteOpen,
  onDeleteOpenChange,
  onDeleteSession,
  forkOpen,
  onForkOpenChange,
  forkLoading,
  forkMessages,
  onForkFromMessage,
  treeOpen,
  onTreeOpenChange,
  treeLoading,
  treeQuery,
  onTreeQueryChange,
  flatTree,
  selectedTreeNodeId,
  onSelectedTreeNodeIdChange,
  selectedTreeNodeLabel,
  onSelectedTreeNodeLabelChange,
  onNavigateTreeNode,
  onSaveTreeLabel,
  statusOpen,
  onStatusOpenChange,
  statuses,
  shortcutsOpen,
  onShortcutsOpenChange,
  settingsOpen,
  onSettingsOpenChange,
  currentTheme,
  currentThemeLabel,
  onThemeChange,
  sessionDoneSoundEnabled,
  onSessionDoneSoundEnabledChange,
  sessionDoneDesktopNotificationsEnabled,
  onSessionDoneDesktopNotificationsEnabledChange,
  desktopNotificationPermission,
  pendingUiRequest,
  pendingUiValue,
  onPendingUiValueChange,
  onResolveUiRequest,
}: AppShellDialogsProps) {
  const statusEntries = Object.entries(statuses).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0
  )

  return (
    <>
      <Dialog open={addDirectoryOpen} onOpenChange={onAddDirectoryOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add directory</DialogTitle>
            <DialogDescription>
              Add another project directory to the sidebar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={directoryInput}
            onChange={(event) => onDirectoryInputChange(event.target.value)}
            placeholder="~/code/project"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onAddDirectoryOpenChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={onAddDirectory}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={onRenameOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Update the display name shown in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            placeholder="Session name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onRenameOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onRenameSession}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              This deletes the session file from disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDeleteSession}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={forkOpen} onOpenChange={onForkOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fork session</DialogTitle>
            <DialogDescription>
              Start a new draft from one of the earlier user prompts.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-2">
              {forkLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner /> Loading fork points…
                </div>
              ) : forkMessages && forkMessages.length > 0 ? (
                forkMessages.map((message) => (
                  <button
                    key={message.entryId}
                    type="button"
                    className="w-full rounded-lg border px-3 py-2 text-left hover:bg-muted/50"
                    onClick={() => onForkFromMessage(message.entryId)}
                  >
                    <div className="line-clamp-3 text-sm">{message.text}</div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  No forkable prompts found.
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={treeOpen} onOpenChange={onTreeOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Session tree</DialogTitle>
            <DialogDescription>
              Navigate branches and edit labels from the native tree UI.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              <Input
                value={treeQuery}
                onChange={(event) => onTreeQueryChange(event.target.value)}
                placeholder="Filter tree"
              />
              <ScrollArea className="h-[55vh] rounded-lg border p-3">
                {treeLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Spinner /> Loading tree…
                  </div>
                ) : flatTree.length > 0 ? (
                  <div className="space-y-1">
                    {flatTree.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          onSelectedTreeNodeIdChange(node.id)
                          onSelectedTreeNodeLabelChange(node.label || "")
                        }}
                        className={[
                          "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50",
                          selectedTreeNodeId === node.id ? "bg-muted" : "",
                        ].join(" ")}
                        style={{ paddingLeft: `${node.depth * 16 + 12}px` }}
                      >
                        <FolderTreeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {node.label || node.role || node.type}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {node.text}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No tree entries found.
                  </div>
                )}
              </ScrollArea>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Selected entry</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedTreeNodeId || "Nothing selected"}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Label</div>
                <Input
                  value={selectedTreeNodeLabel}
                  onChange={(event) =>
                    onSelectedTreeNodeLabelChange(event.target.value)
                  }
                  placeholder="Optional label"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  disabled={!selectedTreeNodeId}
                  onClick={() =>
                    selectedTreeNodeId && onNavigateTreeNode(selectedTreeNodeId)
                  }
                >
                  Jump here
                </Button>
                <Button
                  variant="outline"
                  disabled={!selectedTreeNodeId}
                  onClick={onSaveTreeLabel}
                >
                  Save label
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={statusOpen} onOpenChange={onStatusOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Status</DialogTitle>
            <DialogDescription>
              Current runtime and extension status messages from the native Pi
              to Go session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {statusEntries.length > 0 ? (
              statusEntries.map(([key, value]) => (
                <div key={key} className="rounded-lg border p-3">
                  <div className="text-sm font-medium">{key}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {value}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No active status messages.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={onShortcutsOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcut coverage is being restored feature-by-feature as the
              native rewrite reaches parity with pi-web.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-6">
              {APP_SHELL_SHORTCUT_SECTIONS.map((section) => (
                <section key={section.title} className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">{section.title}</h3>
                    {section.description ? (
                      <p className="text-sm text-muted-foreground">
                        {section.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <div
                        key={`${section.title}:${item.label}`}
                        className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-medium">
                            {item.label}
                          </div>
                          {item.description ? (
                            <div className="text-sm text-muted-foreground">
                              {item.description}
                            </div>
                          ) : null}
                        </div>
                        <code className="rounded bg-muted px-2 py-1 text-xs font-medium">
                          {item.keys}
                        </code>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Theme, notifications, and session completion behavior for Pi to
              Go.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Theme</h3>
                <p className="text-sm text-muted-foreground">
                  Current theme: {currentThemeLabel}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {THEME_OPTIONS.map((themeOption) => (
                  <Button
                    key={themeOption}
                    variant={
                      currentTheme === themeOption ? "default" : "outline"
                    }
                    onClick={() => onThemeChange(themeOption)}
                  >
                    {themeOption[0]?.toUpperCase()}
                    {themeOption.slice(1)}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">
                  Session completion notifications
                </h3>
                <p className="text-sm text-muted-foreground">
                  These settings mirror the old pi-web notification controls.
                </p>
              </div>

              <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    Desktop notifications
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {desktopNotificationPermissionLabel(
                      desktopNotificationPermission
                    )}
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={sessionDoneDesktopNotificationsEnabled}
                  onChange={(event) =>
                    onSessionDoneDesktopNotificationsEnabledChange(
                      event.target.checked
                    )
                  }
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Completion sound</div>
                  <div className="text-sm text-muted-foreground">
                    Play a short confirmation sound when a session finishes.
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={sessionDoneSoundEnabled}
                  onChange={(event) =>
                    onSessionDoneSoundEnabledChange(event.target.checked)
                  }
                />
              </label>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingUiRequest)}
        onOpenChange={(open) => {
          if (!open && pendingUiRequest) {
            onResolveUiRequest({ cancelled: true })
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingUiRequest?.title || "Pi request"}</DialogTitle>
            {pendingUiRequest?.message && (
              <DialogDescription>{pendingUiRequest.message}</DialogDescription>
            )}
          </DialogHeader>
          {(pendingUiRequest?.method === "input" ||
            pendingUiRequest?.method === "editor") &&
            (pendingUiRequest.method === "editor" ? (
              <Textarea
                value={pendingUiValue}
                onChange={(event) => onPendingUiValueChange(event.target.value)}
                placeholder={pendingUiRequest.placeholder}
              />
            ) : (
              <Input
                value={pendingUiValue}
                onChange={(event) => onPendingUiValueChange(event.target.value)}
                placeholder={pendingUiRequest.placeholder}
              />
            ))}
          {pendingUiRequest?.method === "select" && (
            <div className="space-y-2">
              {pendingUiRequest.options?.map((option) => {
                const value = typeof option === "string" ? option : option.value
                const label =
                  typeof option === "string"
                    ? option
                    : option.label || option.value
                return (
                  <Button
                    key={value}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onResolveUiRequest({ value })}
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onResolveUiRequest({ cancelled: true })}
            >
              Cancel
            </Button>
            {pendingUiRequest?.method === "confirm" && (
              <Button onClick={() => onResolveUiRequest({ confirmed: true })}>
                Confirm
              </Button>
            )}
            {(pendingUiRequest?.method === "input" ||
              pendingUiRequest?.method === "editor") && (
              <Button
                onClick={() => onResolveUiRequest({ value: pendingUiValue })}
              >
                Submit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
