import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from "@pierre/trees"

const PROJECT_FILE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet("complete")
const projectFileIconResolver = createFileTreeIconResolver({
  set: "complete",
  colored: true,
})

export function ProjectFileIconSprite() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none block h-0 w-0 overflow-hidden"
      dangerouslySetInnerHTML={{ __html: PROJECT_FILE_ICON_SPRITE_SHEET }}
    />
  )
}

export function ProjectFileTypeIcon({ path }: { path: string }) {
  const icon = projectFileIconResolver.resolveIcon("file-tree-icon-file", path)
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={icon.token}
      focusable="false"
      style={color ? { color } : undefined}
      viewBox={icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`}
      width={icon.width ?? 16}
      height={icon.height ?? 16}
    >
      <use href={`#${icon.name.replace(/^#/, "")}`} />
    </svg>
  )
}
