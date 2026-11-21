/**
 * The keyboard of the pull requests in the GitHub tab. The keys work only
 * while the focus is in the tab and not in a text field, and they have no
 * modifier (Shift only for capitals), so they do not clash with the app
 * shortcuts: those use Control (macOS) or Alt (`keyboard-shortcuts.ts`).
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

export type PrKeyAction =
  | "next"
  | "previous"
  | "open"
  | "back"
  | "search"
  | "refresh"
  | "browser"
  | "comment"
  | "merge"
  | "assign"
  | "rerun"
  | "update"
  | "draft"
  | "close"
  | "labels"
  | "reviewers"
  | "filter-mine"
  | "filter-review"
  | "filter-open"
  | "help"

export const PR_SHORTCUTS: Array<{
  key: string
  label: string
  action: PrKeyAction
  /** The key in the list; absent for a key that only the list shows. */
  group: "Move" | "Pull request" | "List"
}> = [
  { key: "j", label: "Next pull request", action: "next", group: "Move" },
  {
    key: "k",
    label: "Previous pull request",
    action: "previous",
    group: "Move",
  },
  { key: "Enter", label: "Open", action: "open", group: "Move" },
  { key: "Escape", label: "Back", action: "back", group: "Move" },
  { key: "/", label: "Search", action: "search", group: "List" },
  { key: "r", label: "Refresh", action: "refresh", group: "List" },
  { key: "1", label: "Mine", action: "filter-mine", group: "List" },
  {
    key: "2",
    label: "Review requests",
    action: "filter-review",
    group: "List",
  },
  { key: "3", label: "All open", action: "filter-open", group: "List" },
  {
    key: "o",
    label: "Open on GitHub",
    action: "browser",
    group: "Pull request",
  },
  { key: "c", label: "Comment", action: "comment", group: "Pull request" },
  { key: "m", label: "Merge…", action: "merge", group: "Pull request" },
  {
    key: "a",
    label: "Assign or unassign me",
    action: "assign",
    group: "Pull request",
  },
  {
    key: "R",
    label: "Rerun failed checks",
    action: "rerun",
    group: "Pull request",
  },
  { key: "u", label: "Update branch", action: "update", group: "Pull request" },
  {
    key: "d",
    label: "Ready for review or draft",
    action: "draft",
    group: "Pull request",
  },
  {
    key: "x",
    label: "Close or reopen",
    action: "close",
    group: "Pull request",
  },
  { key: "l", label: "Labels…", action: "labels", group: "Pull request" },
  {
    key: "v",
    label: "Request reviewers…",
    action: "reviewers",
    group: "Pull request",
  },
  { key: "?", label: "Show these keys", action: "help", group: "List" },
]

const BY_KEY = new Map(PR_SHORTCUTS.map((item) => [item.key, item.action]))

function isTextTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag !== "INPUT") return false
  const type = (target as HTMLInputElement).type
  return !["button", "checkbox", "radio", "submit", "reset"].includes(type)
}

/**
 * The action of a key press in the tab, or null. `container` is the tab:
 * a key in a dialog or a menu (portals, out of the tab in the DOM) does
 * not count, though React sends it up through the tab.
 */
export function prKeyAction(
  event: React.KeyboardEvent,
  container: HTMLElement | null
): PrKeyAction | null {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return null
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (!container || !(event.target instanceof Node)) return null
  if (!container.contains(event.target)) return null
  if (isTextTarget(event.target)) return null
  // Enter on a button is a click of it, not "open".
  if (
    event.key === "Enter" &&
    event.target instanceof HTMLElement &&
    event.target.closest("button, a, [role=menuitem]") &&
    !event.target.closest("[data-pr-row]")
  )
    return null
  return BY_KEY.get(event.key) ?? null
}

export function PrShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const groups = ["Move", "List", "Pull request"] as const
  return (
    <Dialog open={open} focusPromptOnClose={false} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pull Request Keys</DialogTitle>
          <DialogDescription>
            They work when the focus is in the GitHub tab and not in a text
            field. The keys of a pull request act on the open one, or on the
            selected row.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {groups.map((group) => (
            <section key={group} className="grid gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">
                {group}
              </h3>
              {PR_SHORTCUTS.filter((item) => item.group === group).map(
                (item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span>{item.label}</span>
                    <Kbd>
                      {item.key === "Escape"
                        ? "Esc"
                        : item.key === "Enter"
                          ? "↩"
                          : item.key === "R"
                            ? "⇧R"
                            : item.key}
                    </Kbd>
                  </div>
                )
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
