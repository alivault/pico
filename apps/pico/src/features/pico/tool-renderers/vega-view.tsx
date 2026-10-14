import * as React from "react"
import embed from "vega-embed"

/** A Vega-Lite (or Vega) chart. */
export default function VegaView({ spec }: { spec: unknown }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    const element = ref.current
    if (!element || !spec || typeof spec !== "object") return
    let finalize: (() => void) | undefined
    let cancelled = false
    const dark = document.documentElement.classList.contains("dark")
    embed(element, spec as never, {
      actions: { export: true, source: false, compiled: false, editor: false },
      renderer: "svg",
      ...(dark ? { theme: "dark" as const } : {}),
    })
      .then((result) => {
        if (cancelled) result.finalize()
        else finalize = () => result.finalize()
        setError("")
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason))
      )
    return () => {
      cancelled = true
      finalize?.()
    }
  }, [spec])
  return (
    <div className="overflow-auto">
      {error ? (
        <pre className="text-xs whitespace-pre-wrap text-destructive">
          {error}
        </pre>
      ) : null}
      <div ref={ref} className="[&_.vega-embed]:w-full" />
    </div>
  )
}
