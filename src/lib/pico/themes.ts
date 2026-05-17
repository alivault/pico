export const THEME_COLOR_MODES = ["auto", "light", "dark"] as const

export type ThemeColorMode = (typeof THEME_COLOR_MODES)[number]
export type ResolvedThemeMode = Exclude<ThemeColorMode, "auto">

type ThemeDefinitionConfig = {
  id: string
  label: string
  description: string
  keywords: ReadonlyArray<string>
  classes: Record<ResolvedThemeMode, string>
}

export const THEME_DEFINITIONS = [
  {
    id: "default",
    label: "Default",
    description: "Use Pico's default palette.",
    keywords: ["pico", "default"],
    classes: { light: "light", dark: "dark" },
  },
  {
    id: "flexoki",
    label: "Flexoki",
    description: "Use Flexoki's warm paper and inky dark palettes.",
    keywords: ["flexoki", "warm", "paper", "inky"],
    classes: { light: "flexoki-light", dark: "flexoki-dark" },
  },
  {
    id: "kanagawa",
    label: "Kanagawa",
    description: "Use Kanagawa Lotus in light mode and Wave in dark mode.",
    keywords: [
      "kanagawa",
      "wave",
      "lotus",
      "hokusai",
      "light",
      "dark",
      "vscode",
      "nvim",
    ],
    classes: { light: "kanagawa-lotus", dark: "kanagawa" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    description: "Use Catppuccin Latte in light mode and Mocha in dark mode.",
    keywords: ["catppuccin", "mocha", "latte", "pastel", "vscode"],
    classes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    description:
      "Use Catppuccin Latte in light mode and Macchiato in dark mode.",
    keywords: ["catppuccin", "macchiato", "latte", "pastel", "vscode"],
    classes: { light: "catppuccin-latte", dark: "catppuccin-macchiato" },
  },
  {
    id: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    description: "Use Catppuccin Latte in light mode and Frappé in dark mode.",
    keywords: ["catppuccin", "frappe", "frappé", "latte", "pastel", "vscode"],
    classes: { light: "catppuccin-latte", dark: "catppuccin-frappe" },
  },
  {
    id: "tokyonight",
    label: "Tokyo Night",
    description:
      "Use Tokyo Night's classic blue-black palette, with Day in light mode.",
    keywords: ["tokyo", "tokyonight", "night", "day", "folke", "nvim"],
    classes: { light: "tokyonight-day", dark: "tokyonight-night" },
  },
  {
    id: "tokyonight-storm",
    label: "Tokyo Night Storm",
    description:
      "Use Tokyo Night Storm's blue-gray dark palette, with Day in light mode.",
    keywords: ["tokyo", "tokyonight", "storm", "day", "folke", "nvim"],
    classes: { light: "tokyonight-day", dark: "tokyonight-storm" },
  },
  {
    id: "tokyonight-moon",
    label: "Tokyo Night Moon",
    description:
      "Use Tokyo Night Moon's softer dark palette, with Day in light mode.",
    keywords: ["tokyo", "tokyonight", "moon", "day", "folke", "nvim"],
    classes: { light: "tokyonight-day", dark: "tokyonight-moon" },
  },
] as const satisfies ReadonlyArray<ThemeDefinitionConfig>

type ThemeDefinition = (typeof THEME_DEFINITIONS)[number]

export type ThemeFamily = ThemeDefinition["id"]
export type AppliedThemeClass =
  ThemeDefinition["classes"][keyof ThemeDefinition["classes"]]

export const THEME_FAMILIES = THEME_DEFINITIONS.map(
  (theme) => theme.id
) as Array<ThemeFamily>

export const APPLIED_THEME_CLASSES = Array.from(
  new Set(
    THEME_DEFINITIONS.flatMap((theme) => [
      theme.classes.light,
      theme.classes.dark,
    ])
  )
) as Array<AppliedThemeClass>

function isThemeFamily(value: string): value is ThemeFamily {
  return THEME_FAMILIES.includes(value as ThemeFamily)
}

function getThemeDefinition(theme: ThemeFamily): ThemeDefinition {
  return (
    THEME_DEFINITIONS.find((definition) => definition.id === theme) ??
    THEME_DEFINITIONS[0]
  )
}

export function appliedThemeClassColorMode(
  themeClass: unknown
): ResolvedThemeMode | undefined {
  const normalized = typeof themeClass === "string" ? themeClass.trim() : ""
  if (!normalized) return undefined

  for (const definition of THEME_DEFINITIONS) {
    if (definition.classes.dark === normalized) return "dark"
    if (definition.classes.light === normalized) return "light"
  }

  return undefined
}

export function normalizeThemeFamily(value: unknown): ThemeFamily {
  const normalized = typeof value === "string" ? value.trim() : ""

  if (isThemeFamily(normalized)) return normalized

  for (const definition of THEME_DEFINITIONS) {
    if (
      definition.classes.light === normalized ||
      definition.classes.dark === normalized
    ) {
      return definition.id
    }
  }

  return "default"
}

export function normalizeThemeColorMode(value: unknown): ThemeColorMode {
  if (value === "auto" || value === "system") return "auto"
  if (value === "light" || value === "dark") return value

  return appliedThemeClassColorMode(value) ?? "auto"
}

function resolvedThemeMode(
  mode: ThemeColorMode,
  systemTheme?: string
): ResolvedThemeMode {
  if (mode === "auto") {
    return systemTheme === "dark" ? "dark" : "light"
  }

  return mode
}

export function appliedThemeClass(
  family: ThemeFamily,
  mode: ThemeColorMode,
  systemTheme?: string
): AppliedThemeClass {
  const resolvedMode = resolvedThemeMode(mode, systemTheme)
  const definition = getThemeDefinition(normalizeThemeFamily(family))

  return definition.classes[resolvedMode]
}

export function themeFamilyLabel(theme: ThemeFamily) {
  return getThemeDefinition(normalizeThemeFamily(theme)).label
}

export function themeFamilyDescription(theme: ThemeFamily) {
  return getThemeDefinition(normalizeThemeFamily(theme)).description
}

export function themeFamilyKeywords(theme: ThemeFamily) {
  const definition = getThemeDefinition(normalizeThemeFamily(theme))

  return [
    definition.id,
    definition.label,
    definition.description,
    ...definition.keywords,
  ]
}

export function themeColorModeLabel(
  mode: ThemeColorMode,
  systemTheme?: string
) {
  if (mode === "auto") {
    if (!systemTheme) return "Auto"

    return `Auto (${resolvedThemeMode(mode, systemTheme) === "light" ? "Light" : "Dark"})`
  }

  return mode === "light" ? "Light" : "Dark"
}
