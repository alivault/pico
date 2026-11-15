import * as React from "react"

import { cn } from "@/lib/utils"

/** Images that the file viewer shows as images. */
const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

export function isImageFilePath(path: string) {
  const extension = path
    .split(/[?#]/)[0]
    ?.match(/\.([A-Za-z0-9]+)$/)?.[1]
    ?.toLowerCase()
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension)
}

export function isSvgFilePath(path: string) {
  return /\.svg$/i.test(path.split(/[?#]/)[0] ?? "")
}

/**
 * An image file of the project, on a checkerboard so that transparent parts
 * show. It fits the panel; a click shows it at its real size, and a second
 * click fits it again.
 */
export function ProjectFileImage({
  src,
  path,
  onSize,
}: {
  src: string
  path: string
  onSize?: (size: { width: number; height: number } | undefined) => void
}) {
  const [actualSize, setActualSize] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [fits, setFits] = React.useState(true)
  const svg = isSvgFilePath(path)

  React.useEffect(() => {
    setFailed(false)
    onSize?.(undefined)
  }, [src, onSize])

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        The browser cannot show this image.
      </div>
    )
  }

  return (
    <div
      className={cn(
        "h-full overflow-auto bg-[length:16px_16px] bg-[position:0_0,8px_8px]",
        "bg-[image:linear-gradient(45deg,color-mix(in_oklab,var(--muted)_60%,transparent)_25%,transparent_25%,transparent_75%,color-mix(in_oklab,var(--muted)_60%,transparent)_75%),linear-gradient(45deg,color-mix(in_oklab,var(--muted)_60%,transparent)_25%,transparent_25%,transparent_75%,color-mix(in_oklab,var(--muted)_60%,transparent)_75%)]"
      )}
    >
      <div
        className={cn(
          "flex min-h-full min-w-full items-center justify-center p-4",
          actualSize ? "w-max" : "h-full"
        )}
      >
        <img
          src={src}
          alt={path}
          draggable={false}
          className={cn(
            "block",
            actualSize ? "max-w-none" : "max-h-full max-w-full object-contain",
            // An SVG scales without loss: show a small one larger.
            svg && !actualSize && "size-full max-h-128 max-w-128",
            // Only an image that is larger than the panel can zoom.
            fits
              ? "cursor-default"
              : actualSize
                ? "cursor-zoom-out"
                : "cursor-zoom-in"
          )}
          onLoad={(event) => {
            const image = event.currentTarget
            const width = image.naturalWidth
            const height = image.naturalHeight
            onSize?.(width && height ? { width, height } : undefined)
            const frame = image.parentElement?.parentElement
            setFits(
              !frame ||
                (width <= frame.clientWidth - 32 &&
                  height <= frame.clientHeight - 32)
            )
          }}
          onError={() => setFailed(true)}
          onClick={() => {
            if (!fits) setActualSize((current) => !current)
          }}
        />
      </div>
    </div>
  )
}
