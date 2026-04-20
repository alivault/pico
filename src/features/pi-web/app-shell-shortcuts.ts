export type ShortcutItem = {
  label: string
  description?: string
  keys: string
}

export type ShortcutSection = {
  title: string
  description?: string
  items: Array<ShortcutItem>
}

export const APP_SHELL_SHORTCUT_SECTIONS: Array<ShortcutSection> = [
  {
    title: "Global",
    items: [
      {
        label: "Open keyboard shortcuts",
        keys: "Ctrl+/",
      },
      {
        label: "Open command palette",
        keys: "Ctrl+P",
      },
      {
        label: "Create a new session",
        keys: "Ctrl+N",
      },
      {
        label: "Search sessions",
        keys: "Ctrl+S",
      },
      {
        label: "Rename the current session",
        keys: "Ctrl+E",
      },
      {
        label: "Fork the current session",
        keys: "Ctrl+F",
      },
      {
        label: "Compact the current session context",
        keys: "Ctrl+C",
      },
      {
        label: "Delete the current session",
        keys: "Ctrl+X",
      },
      {
        label: "Add a directory",
        keys: "Ctrl+D",
      },
      {
        label: "Open settings",
        keys: "Ctrl+,",
      },
      {
        label: "Focus the model picker",
        keys: "Ctrl+M",
      },
      {
        label: "Toggle thinking blocks",
        keys: "Ctrl+T",
      },
    ],
  },
  {
    title: "Lists & pickers",
    description:
      "Works in the session list, command palette, and the add-directory and fork dialogs.",
    items: [
      {
        label: "Move selection",
        keys: "↑ / ↓",
      },
      {
        label: "Select multiple sidebar sessions",
        description: "Works in the sidebar session list with the mouse.",
        keys: "Cmd/Ctrl+Click or Shift+Click",
      },
      {
        label: "Delete selected sidebar sessions",
        description: "When sidebar session rows are selected or focused.",
        keys: "Backspace / Delete",
      },
      {
        label: "Run the first command palette result",
        keys: "Enter",
      },
    ],
  },
  {
    title: "Composer",
    items: [
      {
        label: "Send or steer the current prompt",
        keys: "Enter",
      },
      {
        label: "Insert a newline",
        keys: "Shift+Enter",
      },
      {
        label: "Queue a follow-up while streaming",
        keys: "Use the Queue follow-up button",
      },
      {
        label: "Attach images",
        keys: "Use Add images",
      },
    ],
  },
  {
    title: "General",
    items: [
      {
        label: "Close the active dialog",
        keys: "Esc",
      },
    ],
  },
]
