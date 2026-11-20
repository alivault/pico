import * as React from "react"

import { ImageLightbox } from "@/features/smith/image-lightbox"
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
 * show. It fits the panel; a click opens it in the lightbox, which can zoom.
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
  const [failed, setFailed] = React.useState(false)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const svg = isSvgFilePath(path)
  const name = path.split(/[/\\]/).pop() || path

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
      <div className="flex size-full items-center justify-center p-4">
        <button
          type="button"
          aria-label={`Open ${name} in a lightbox`}
          className={cn(
            "flex max-h-full max-w-full cursor-zoom-in items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            // An SVG scales without loss: show a small one larger.
            svg && "size-full max-h-128 max-w-128"
          )}
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={src}
            alt={path}
            draggable={false}
            className={cn(
              "block max-h-full max-w-full object-contain",
              svg && "size-full"
            )}
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } =
                event.currentTarget
              onSize?.(width && height ? { width, height } : undefined)
            }}
            onError={() => setFailed(true)}
          />
        </button>
      </div>
      {lightboxOpen ? (
        <ImageLightbox
          open={true}
          onOpenChange={setLightboxOpen}
          imageSrc={src}
          imageAlt={path}
          title={name}
          description={`Expanded preview of ${path}.`}
          // An SVG scales without loss: let it fill the lightbox.
          imageClassName={svg ? "size-full" : undefined}
        />
      ) : null}
    </div>
  )
}
