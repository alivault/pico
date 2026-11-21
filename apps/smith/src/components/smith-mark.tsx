import type { SVGProps } from "react"

/**
 * The Smith mark, 20 × 11. It uses `currentColor`, so it follows the text
 * color of the theme. Keep the path the same as `scripts/icons.mjs`.
 */
export function SmithMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      width="20"
      height="11"
      viewBox="0 0 20 11"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.354.854A.5.5 0 0 1 7.707 0h11.086a.5.5 0 0 1 .353.854l-3 3a.5.5 0 0 0-.146.353v4.086a.5.5 0 0 1-.854.353zm5.292 9.292a.5.5 0 0 1-.353.854H1.207a.5.5 0 0 1-.353-.854l3-3A.5.5 0 0 0 4 6.793V2.707a.5.5 0 0 1 .854-.353z"
        fill="currentColor"
      />
    </svg>
  )
}
