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
        label: "Add a directory",
        keys: "Ctrl+D",
      },
      {
        label: "Open the session tree",
        description: "Press Escape twice when nothing else is open.",
        keys: "Esc, Esc",
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
      {
        label: "Toggle tool calls",
        keys: "Ctrl+O",
      },
      {
        label: "Cycle reasoning level",
        description: "Shift reverses the direction.",
        keys: "Ctrl+R / Ctrl+Shift+R",
      },
    ],
  },
  {
    title: "Sidebar & pickers",
    description:
      "Covers the sidebar, command palette, and the model, thinking, and skill pickers.",
    items: [
      {
        label: "Move selection",
        keys: "↑ / ↓",
      },
      {
        label: "Confirm the highlighted result",
        keys: "Enter",
      },
      {
        label: "Select multiple sidebar sessions",
        description: "Works in the sidebar session list with the mouse.",
        keys: "Ctrl+Click or Shift+Click",
      },
      {
        label: "Delete focused or selected sidebar sessions",
        description: "Backspace deletes only when multi-select is active.",
        keys: "Delete / Backspace",
      },
    ],
  },
  {
    title: "Composer",
    items: [
      {
        label: "Send or steer the current prompt",
        keys: "Ctrl+Enter / Cmd+Enter",
      },
      {
        label: "Queue a follow-up",
        description:
          "Works while streaming or when using steer/follow-up mode.",
        keys: "Alt+Ctrl+Enter",
      },
      {
        label: "Insert a newline",
        keys: "Shift+Enter",
      },
      {
        label: "Move slash, file, or path suggestions",
        keys: "↑ / ↓ or Ctrl+J / Ctrl+K",
      },
      {
        label: "Accept a slash, path, or file suggestion",
        description:
          "Tab accepts slash/path suggestions; Enter accepts the active completion.",
        keys: "Tab / Enter",
      },
      {
        label: "Clear the active skill pill when the prompt is empty",
        keys: "Backspace",
      },
    ],
  },
  {
    title: "Tree dialog",
    description:
      "When the session tree is open, Ctrl+/ shows tree-specific help instead of this dialog.",
    items: [
      {
        label: "Show tree shortcuts",
        keys: "Ctrl+/",
      },
      {
        label: "Move",
        keys: "↑ / ↓ or Ctrl+J / Ctrl+K",
      },
      {
        label: "Expand or collapse a branch",
        keys: "← / → or Ctrl+H / Ctrl+L",
      },
      {
        label: "Cycle filters",
        keys: "Ctrl+O / Ctrl+Shift+O",
      },
      {
        label: "Jump to a filter preset",
        keys: "Ctrl+Shift+D / T / U / L / A",
      },
      {
        label: "Toggle label timestamps",
        keys: "Shift+T",
      },
      {
        label: "Focus the label field",
        keys: "Shift+L",
      },
      {
        label: "Continue without summary",
        keys: "Enter",
      },
      {
        label: "Submit custom summary instructions",
        keys: "Ctrl+Enter",
      },
      {
        label: "Clear custom summary or close help/tree",
        keys: "Esc",
      },
    ],
  },
  {
    title: "General",
    items: [
      {
        label: "Close the active dialog or suggestion menu",
        keys: "Esc",
      },
    ],
  },
]
