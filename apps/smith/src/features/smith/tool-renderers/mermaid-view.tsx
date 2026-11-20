import * as React from "react"
import mermaid from "mermaid"

let counter = 0

/** A Mermaid diagram, drawn to SVG on the client. */
export default function MermaidView({ source }: { source: string }) {
  const [svg, setSvg] = React.useState("")
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    let cancelled = false
    const dark = document.documentElement.classList.contains("dark")
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    })
    counter += 1
    mermaid
      .render(`pico-mermaid-${counter}`, source)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg)
          setError("")
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [source])
  if (error)
    return (
      <pre className="text-xs whitespace-pre-wrap text-destructive">
        {error}
      </pre>
    )
  return (
    <div
      className="overflow-auto [&_svg]:mx-auto [&_svg]:max-w-full"
      // Mermaid output with securityLevel "strict" has no scripts.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
