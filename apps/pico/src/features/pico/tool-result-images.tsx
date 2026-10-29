import * as React from "react"

import type { ConversationImage } from "@/lib/pico"
import { machineApiUrl } from "@/lib/pico/machine"
import { useMachineId } from "@/lib/pico/machine-context"
import { ImageLightbox } from "@/features/pico/image-lightbox"

/** The `src` of a conversation image on the machine of the conversation. */
export function useConversationImageSrc() {
  const machineId = useMachineId()
  return React.useCallback(
    (image: ConversationImage) => machineApiUrl(machineId, image.url),
    [machineId]
  )
}

/** Images from tool results, shown below the tool card header. */
export const ToolResultImages = React.memo(function ToolResultImages({
  images,
}: {
  images: ConversationImage[]
}) {
  const imageSrc = useConversationImageSrc()
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null)
  const selected = selectedIndex === null ? null : images[selectedIndex]

  if (images.length === 0) return null

  return (
    <div className="flex flex-wrap gap-3 pt-2">
      {images.map((image, index) => (
        <button
          key={`${image.url}:${index}`}
          type="button"
          className="max-w-full cursor-zoom-in overflow-hidden rounded-lg border bg-background/80 p-0 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setSelectedIndex(index)}
        >
          <img
            src={imageSrc(image)}
            alt="Tool result"
            loading="lazy"
            decoding="async"
            className="block max-h-64 max-w-full object-contain"
          />
          <span className="sr-only">Open image</span>
        </button>
      ))}
      {selected ? (
        <ImageLightbox
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedIndex(null)
          }}
          imageSrc={imageSrc(selected)}
          imageAlt="Tool result"
          index={selectedIndex ?? 0}
          count={images.length}
          onIndexChange={setSelectedIndex}
          title="Tool result image"
          description="Expanded preview of an image from a tool result."
        />
      ) : null}
    </div>
  )
})
