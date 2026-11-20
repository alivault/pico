/**
 * Logical key names for agents, as the bytes a terminal sends for them.
 */
const KEYS: Record<string, string> = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  "shift+tab": "\u001b[Z",
  esc: "\u001b",
  escape: "\u001b",
  backspace: "\u007f",
  delete: "\u001b[3~",
  space: " ",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
  home: "\u001b[H",
  end: "\u001b[F",
  pageup: "\u001b[5~",
  pagedown: "\u001b[6~",
  insert: "\u001b[2~",
  f1: "\u001bOP",
  f2: "\u001bOQ",
  f3: "\u001bOR",
  f4: "\u001bOS",
  f5: "\u001b[15~",
  f6: "\u001b[17~",
  f7: "\u001b[18~",
  f8: "\u001b[19~",
  f9: "\u001b[20~",
  f10: "\u001b[21~",
  f11: "\u001b[23~",
  f12: "\u001b[24~",
}

/** The bytes for one key name, or undefined for an unknown name. */
export function keyBytes(name: string): string | undefined {
  const key = name.trim().toLowerCase().replace(/\s+/g, "")
  if (KEYS[key] !== undefined) return KEYS[key]
  // ctrl+a … ctrl+z, and a few punctuation keys.
  const ctrl = /^(?:ctrl|control|c)[+-](.)$/.exec(key)
  if (ctrl) {
    const char = ctrl[1]!
    if (/[a-z]/.test(char)) return String.fromCharCode(char.charCodeAt(0) - 96)
    const special: Record<string, string> = {
      "[": "\u001b",
      "\\": "\u001c",
      "]": "\u001d",
      "@": "\u0000",
      " ": "\u0000",
    }
    return special[char]
  }
  const alt = /^(?:alt|meta|m)[+-](.+)$/.exec(key)
  if (alt) {
    const rest = alt[1]!.length === 1 ? alt[1]! : keyBytes(alt[1]!)
    return rest === undefined ? undefined : `\u001b${rest}`
  }
  return undefined
}

export const KEY_NAMES =
  "enter, tab, shift+tab, esc, backspace, delete, space, up, down, left, right, home, end, pageup, pagedown, f1-f12, ctrl+<letter>, alt+<key>"
