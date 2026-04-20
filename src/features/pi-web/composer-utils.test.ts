import { describe, expect, it } from "vite-plus/test"

import type { SlashCommandDescriptor } from "@/features/pi-web/composer-utils"
import {
  applyCompletionItem,
  formatComposerSkillName,
  getFileReferenceCompletionQuery,
  getPathCompletionQuery,
  matchingSlashCommands,
  parseComposerSkillMessage,
  parseSlashCommandInput,
  serializeComposerDraft,
  slashCommandQueryMatch,
} from "@/features/pi-web/composer-utils"

describe("composer-utils", () => {
  it("round-trips skill drafts", () => {
    expect(
      parseComposerSkillMessage(
        serializeComposerDraft({ skillName: "frontend-developer", text: "fix a11y" })
      )
    ).toEqual({
      matched: true,
      skillName: "frontend-developer",
      text: "fix a11y",
    })
  })

  it("formats skill labels for pills", () => {
    expect(formatComposerSkillName("frontend-developer")).toBe(
      "Frontend Developer"
    )
    expect(formatComposerSkillName("sdk")).toBe("SDK")
  })

  it("parses slash commands and query-only state", () => {
    expect(parseSlashCommandInput(" /compact now ")).toEqual({
      rawValue: " /compact now ",
      trimmedStart: "/compact now ",
      name: "compact",
      args: "now",
      hasArguments: true,
    })

    expect(slashCommandQueryMatch("   /comp")).toEqual({
      leadingWhitespace: "   ",
    })
  })

  it("ranks builtin slash commands ahead of skills for the same query", () => {
    const commands: Array<SlashCommandDescriptor> = [
      { kind: "skill", name: "skill:compact-context", skillName: "compact-context" },
      { kind: "builtin", name: "compact", description: "Summarize the session" },
    ]

    expect(matchingSlashCommands(commands, "comp").map((command) => command.name)).toEqual([
      "compact",
      "skill:compact-context",
    ])
  })

  it("finds @ file reference completions including quoted references", () => {
    expect(
      getFileReferenceCompletionQuery({
        value: 'open @"src/feat',
        selectionStart: 15,
        selectionEnd: 15,
      })
    ).toMatchObject({
      kind: "file-reference",
      rawPrefix: "src/feat",
      isQuotedPrefix: true,
      start: 5,
    })

    expect(
      getFileReferenceCompletionQuery({
        value: "open @src/feat",
        selectionStart: 14,
        selectionEnd: 14,
      })
    ).toMatchObject({
      kind: "file-reference",
      rawPrefix: "src/feat",
      isQuotedPrefix: false,
      start: 5,
    })
  })

  it("finds path completions outside slash-command query mode", () => {
    expect(
      getPathCompletionQuery({
        value: "read src/features/pi-web",
        selectionStart: 24,
        selectionEnd: 24,
      })
    ).toMatchObject({
      kind: "path",
      prefix: "src/features/pi-web",
      start: 5,
    })

    expect(
      getPathCompletionQuery({
        value: "/comp",
        selectionStart: 5,
        selectionEnd: 5,
      })
    ).toBeNull()
  })

  it("applies completion items and preserves cursor placement", () => {
    const query = getFileReferenceCompletionQuery({
      value: "inspect @src/fe",
      selectionStart: 15,
      selectionEnd: 15,
    })

    expect(query).not.toBeNull()
    expect(
      applyCompletionItem({
        value: "inspect @src/fe",
        query: query!,
        item: {
          value: "@src/features/",
          label: "src/features/",
          isDirectory: true,
        },
      })
    ).toEqual({
      value: "inspect @src/features/",
      selectionStart: 22,
      selectionEnd: 22,
    })
  })
})
