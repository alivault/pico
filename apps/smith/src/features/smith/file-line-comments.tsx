/**
 * Comments on lines of project files. They wait in the composer, like diff
 * comments, and the next prompt sends them. The app shell owns the list and
 * gives it to the file viewer through this context.
 */
import * as React from "react"

import type { ComposerFileLineComment } from "@/features/pico/app-shell-composer-state"

export type NewFileLineComment = Omit<ComposerFileLineComment, "id" | "kind">

export type FileLineCommentsValue = {
  comments: Array<ComposerFileLineComment>
  add: (comment: NewFileLineComment) => void
  remove: (id: string) => void
}

const FileLineCommentsContext =
  React.createContext<FileLineCommentsValue | null>(null)

export const FileLineCommentsProvider = FileLineCommentsContext.Provider

/** The file comments of the shell, or null where comments are not offered. */
export function useFileLineComments() {
  return React.useContext(FileLineCommentsContext)
}
