import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
} from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

function sonnerThemeFromAppliedTheme(theme?: string): ToasterProps["theme"] {
  if (theme === "flexoki-dark") return "dark"
  if (theme === "flexoki-light") return "light"
  if (theme === "dark" || theme === "light" || theme === "system") {
    return theme
  }
  return "system"
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={sonnerThemeFromAppliedTheme(theme)}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Spinner className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg":
            "color-mix(in oklab, var(--success) 14%, var(--popover))",
          "--success-border":
            "color-mix(in oklab, var(--success) 35%, var(--border))",
          "--success-text": "var(--success)",
          "--info-bg":
            "color-mix(in oklab, var(--primary) 14%, var(--popover))",
          "--info-border":
            "color-mix(in oklab, var(--primary) 35%, var(--border))",
          "--info-text": "var(--primary)",
          "--warning-bg":
            "color-mix(in oklab, var(--warning) 14%, var(--popover))",
          "--warning-border":
            "color-mix(in oklab, var(--warning) 35%, var(--border))",
          "--warning-text": "var(--warning)",
          "--error-bg":
            "color-mix(in oklab, var(--danger) 14%, var(--popover))",
          "--error-border":
            "color-mix(in oklab, var(--danger) 35%, var(--border))",
          "--error-text": "var(--danger)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
