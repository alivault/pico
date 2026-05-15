import * as React from "react"

import { cn } from "@/lib/utils"

type ParsedHighlightSpan = {
  type: "span"
  key: number
  className?: string
  style?: React.CSSProperties
  children: Array<ParsedHighlightChild>
}

type ParsedHighlightChild = string | ParsedHighlightSpan

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,
    (entity, encoded: string) => {
      switch (encoded.toLowerCase()) {
        case "amp":
          return "&"
        case "lt":
          return "<"
        case "gt":
          return ">"
        case "quot":
          return '"'
        case "apos":
        case "#39":
          return "'"
        default: {
          const codePoint = encoded.toLowerCase().startsWith("#x")
            ? Number.parseInt(encoded.slice(2), 16)
            : Number.parseInt(encoded.slice(1), 10)
          return Number.isFinite(codePoint)
            ? String.fromCodePoint(codePoint)
            : entity
        }
      }
    }
  )
}

function readQuotedAttribute(tag: string, name: string) {
  const pattern = new RegExp(`${name}="([^"]*)"`)
  return pattern.exec(tag)?.[1]
}

function normalizeHighlightClassName(value: string | undefined) {
  if (!value) return undefined

  const classNames = value
    .split(/\s+/)
    .filter((className) => /^sh__[A-Za-z0-9_-]+$/.test(className))

  return classNames.length > 0 ? classNames.join(" ") : undefined
}

function normalizeHighlightStyle(value: string | undefined) {
  if (!value) return undefined

  for (const declaration of value.split(";")) {
    const [rawProperty, ...rawValueParts] = declaration.split(":")
    const property = rawProperty?.trim().toLowerCase()
    const color = rawValueParts.join(":").trim()
    if (property !== "color") continue
    if (!/^var\(--sh-[A-Za-z0-9-]+\)$/.test(color)) continue

    return { color } satisfies React.CSSProperties
  }

  return undefined
}

function parseHighlightedHtml(html: string) {
  const root: ParsedHighlightSpan = {
    type: "span",
    key: 0,
    children: [],
  }
  const stack = [root]
  let key = 0

  for (const match of html.matchAll(/<span\b[^>]*>|<\/span>|[^<]+/g)) {
    const token = match[0]
    const parent = stack.at(-1) ?? root

    if (token.startsWith("<span")) {
      key += 1
      const span: ParsedHighlightSpan = {
        type: "span",
        key,
        className: normalizeHighlightClassName(
          readQuotedAttribute(token, "class")
        ),
        style: normalizeHighlightStyle(readQuotedAttribute(token, "style")),
        children: [],
      }
      parent.children.push(span)
      stack.push(span)
      continue
    }

    if (token === "</span>") {
      if (stack.length > 1) stack.pop()
      continue
    }

    parent.children.push(decodeHtmlEntities(token))
  }

  return root.children
}

function renderHighlightedChild(child: ParsedHighlightChild): React.ReactNode {
  if (typeof child === "string") return child

  return (
    <span key={child.key} className={child.className} style={child.style}>
      {child.children.map(renderHighlightedChild)}
    </span>
  )
}

type HighlightedCodeProps = {
  className?: string
  html: string
  language?: string
}

export function HighlightedCode({
  className,
  html,
  language,
}: HighlightedCodeProps) {
  return (
    <code className={cn(language && `language-${language}`, className)}>
      {parseHighlightedHtml(html).map(renderHighlightedChild)}
    </code>
  )
}
